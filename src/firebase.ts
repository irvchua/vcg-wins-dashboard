import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import type { ActivityEntry, ArchivedEntry, BoardEntry, BoardState, StageKey } from "./types";

type PersistedBoardData = {
  archivedEntries: ArchivedEntry[];
  activities: ActivityEntry[];
  board: BoardState;
  hasLegacyBoard: boolean;
  updatedAt: string | null;
  wins: number;
};

type StoredRecord = BoardEntry & {
  archivedAt?: string;
  archivedFrom?: StageKey;
  isArchived: boolean;
  stage: StageKey;
};

export class RecordConflictError extends Error {
  constructor() {
    super("This record was changed by another editor.");
    this.name = "RecordConflictError";
  }
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseBoardId = import.meta.env.VITE_FIREBASE_BOARD_ID;
export const shouldSeedMissingFirebaseBoard =
  import.meta.env.VITE_FIREBASE_ALLOW_INITIAL_SEED === "true";
export const authorizedDomains = ["jcmchcorp.com", "veteranschoiceglobal.com"];

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean) && Boolean(firebaseBoardId);

function cleanFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cleanFirestoreData(item)) as T;
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanFirestoreData(item)])
    ) as T;
  }

  return value;
}

function getFirebaseApp() {
  if (!isFirebaseConfigured) return null;

  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

function getBoardDocRef() {
  const app = getFirebaseApp();
  if (!app) return null;

  const database = getFirestore(app);

  return doc(database, "winsBoards", firebaseBoardId);
}

function getRecordsCollectionRef() {
  const boardDocRef = getBoardDocRef();
  return boardDocRef ? collection(boardDocRef, "records") : null;
}

function getRecordDocRef(id: number) {
  const recordsRef = getRecordsCollectionRef();
  return recordsRef ? doc(recordsRef, String(id)) : null;
}

function getAuthInstance() {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user?.email) return null;

  return {
    id: user.uid,
    email: user.email,
    name: user.displayName ?? user.email,
  };
}

export function canUserEdit(user: AuthUser | null) {
  if (!isFirebaseConfigured) return true;
  if (!user) return false;

  const domain = user.email.trim().toLowerCase().split("@")[1] ?? "";
  return authorizedDomains.includes(domain);
}

export function subscribeToAuth(onChange: (user: AuthUser | null) => void) {
  const auth = getAuthInstance();
  if (!auth) {
    onChange(null);
    return null;
  }

  return onAuthStateChanged(auth, (user) => onChange(toAuthUser(user)));
}

export async function signInWithGoogle() {
  const auth = getAuthInstance();
  if (!auth) return null;

  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return toAuthUser(result.user);
}

export async function signOutUser() {
  const auth = getAuthInstance();
  if (!auth) return;

  await signOut(auth);
}

export function subscribeToBoard(
  onData: (data: PersistedBoardData | null) => void,
  onError: (error: Error) => void
) {
  const boardDocRef = getBoardDocRef();
  const recordsRef = getRecordsCollectionRef();
  if (!boardDocRef || !recordsRef) return null;

  let metadata: Record<string, unknown> | null = null;
  let records: StoredRecord[] | null = null;

  const emit = () => {
    if (!metadata || !records) return;

    if (!records.length && metadata.board) {
      onData({
        activities: Array.isArray(metadata.activities) ? (metadata.activities as ActivityEntry[]) : [],
        archivedEntries: Array.isArray(metadata.archivedEntries) ? (metadata.archivedEntries as ArchivedEntry[]) : [],
        board: metadata.board as BoardState,
        hasLegacyBoard: true,
        updatedAt: (metadata.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null,
        wins: typeof metadata.wins === "number" ? metadata.wins : 0,
      });
      return;
    }

    const board: BoardState = { appeals: [], claims526: [], reviewSignature: [], faxing: [], faxed: [] };
    const archivedEntries: ArchivedEntry[] = [];
    records.forEach((record) => {
      const { archivedAt, archivedFrom, isArchived, stage, ...entry } = record;
      if (isArchived) {
        archivedEntries.push({
          ...entry,
          archivedAt: archivedAt ?? new Date(0).toISOString(),
          archivedFrom: archivedFrom ?? stage,
        });
      } else {
        board[stage].push(entry);
      }
    });

    onData({
      activities: Array.isArray(metadata.activities) ? (metadata.activities as ActivityEntry[]) : [],
      archivedEntries: archivedEntries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
      board,
      hasLegacyBoard: false,
      updatedAt: (metadata.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null,
      wins: typeof metadata.wins === "number" ? metadata.wins : 0,
    });
  };

  const unsubscribeBoard = onSnapshot(boardDocRef, (snapshot) => {
    if (!snapshot.exists()) {
      onData(null);
      return;
    }
    metadata = snapshot.data();
    emit();
  }, onError);
  const unsubscribeRecords = onSnapshot(recordsRef, (snapshot) => {
    records = snapshot.docs.map((record) => record.data() as StoredRecord);
    emit();
  }, onError);

  return () => {
    unsubscribeBoard();
    unsubscribeRecords();
  };
}

export async function saveBoardData(
  wins: number,
  activities: ActivityEntry[]
) {
  const boardDocRef = getBoardDocRef();
  if (!boardDocRef) return false;

  await setDoc(
    boardDocRef,
    {
      activities: cleanFirestoreData(activities),
      schemaVersion: 2,
      wins,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

export async function migrateLegacyBoardRecords(board: BoardState, archivedEntries: ArchivedEntry[]) {
  const recordsRef = getRecordsCollectionRef();
  const boardDocRef = getBoardDocRef();
  if (!recordsRef || !boardDocRef) return false;
  const existing = await getDocs(recordsRef);
  if (!existing.empty) return false;

  const batch = writeBatch(getFirestore(getFirebaseApp()!));
  Object.entries(board).forEach(([stage, entries]) => {
    entries.forEach((entry) => batch.set(doc(recordsRef, String(entry.id)), cleanFirestoreData({
      ...entry,
      isArchived: false,
      stage,
      updatedAt: entry.updatedAt ?? new Date().toISOString(),
      version: entry.version ?? 1,
    })));
  });
  archivedEntries.forEach((entry) => batch.set(doc(recordsRef, String(entry.id)), cleanFirestoreData({
    ...entry,
    isArchived: true,
    stage: entry.archivedFrom,
    updatedAt: entry.updatedAt ?? entry.archivedAt,
    version: entry.version ?? 1,
  })));
  batch.set(boardDocRef, { schemaVersion: 2, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return true;
}

export async function createBoardRecord(stage: StageKey, entry: BoardEntry, actor: string) {
  const recordRef = getRecordDocRef(entry.id);
  if (!recordRef) return;
  await setDoc(recordRef, cleanFirestoreData({
    ...entry,
    isArchived: false,
    stage,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
    updatedBy: actor,
    version: 1,
  }));
}

export async function saveBoardRecord(
  stage: StageKey,
  entry: BoardEntry,
  expectedVersion: number,
  actor: string
) {
  const recordRef = getRecordDocRef(entry.id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return { ...entry, version: expectedVersion + 1 };

  const database = getFirestore(app);
  const updatedAt = new Date().toISOString();
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists() || (snapshot.data().version ?? 1) !== expectedVersion) {
      throw new RecordConflictError();
    }
    transaction.set(recordRef, cleanFirestoreData({
      ...entry,
      isArchived: false,
      stage,
      updatedAt,
      updatedBy: actor,
      version: expectedVersion + 1,
    }));
  });
  return { ...entry, updatedAt, updatedBy: actor, version: expectedVersion + 1 };
}

export async function updateRecordState(entry: BoardEntry, data: Partial<StoredRecord>, actor: string) {
  const recordRef = getRecordDocRef(entry.id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return;
  await runTransaction(getFirestore(app), async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists() || (snapshot.data().version ?? 1) !== (entry.version ?? 1)) {
      throw new RecordConflictError();
    }
    transaction.set(recordRef, cleanFirestoreData({
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
      version: (entry.version ?? 1) + 1,
    }), { merge: true });
  });
}
