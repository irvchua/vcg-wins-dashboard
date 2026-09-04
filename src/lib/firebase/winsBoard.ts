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
import type { ActivityEntry, ArchivedEntry, BoardEntry, BoardState, StageKey } from "../../types";
import { cleanFirestoreData, FirestoreConflictError as RecordConflictError, getFirebaseApp, isFirebaseAppConfigured } from "./auth";

export { RecordConflictError };

type PersistedBoardData = {
  announcement: string;
  archivedEntries: ArchivedEntry[];
  activities: ActivityEntry[];
  board: BoardState;
  hasLegacyBoard: boolean;
  updatedAt: string | null;
  wins: number;
  winsTarget: number;
};

type StoredRecord = BoardEntry & {
  archivedAt?: string;
  archivedFrom?: StageKey;
  isArchived: boolean;
  stage: StageKey;
};

export const firebaseBoardId = import.meta.env.VITE_FIREBASE_BOARD_ID;
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";
export const shouldSeedMissingFirebaseBoard =
  import.meta.env.VITE_FIREBASE_ALLOW_INITIAL_SEED === "true";

export const isFirebaseConfigured =
  !isDemoMode && isFirebaseAppConfigured && Boolean(firebaseBoardId);

function getBoardDocRef() {
  if (!isFirebaseConfigured) return null;
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
        announcement: typeof metadata.announcement === "string" ? metadata.announcement : "",
        activities: Array.isArray(metadata.activities) ? (metadata.activities as ActivityEntry[]) : [],
        archivedEntries: Array.isArray(metadata.archivedEntries) ? (metadata.archivedEntries as ArchivedEntry[]) : [],
        board: metadata.board as BoardState,
        hasLegacyBoard: true,
        updatedAt: (metadata.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null,
        wins: typeof metadata.wins === "number" ? metadata.wins : 0,
        winsTarget: typeof metadata.winsTarget === "number" ? metadata.winsTarget : 0,
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
    Object.values(board).forEach((entries) => entries.sort(
      (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
        || a.id - b.id
    ));

    onData({
      announcement: typeof metadata.announcement === "string" ? metadata.announcement : "",
      activities: Array.isArray(metadata.activities) ? (metadata.activities as ActivityEntry[]) : [],
      archivedEntries: archivedEntries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
      board,
      hasLegacyBoard: false,
      updatedAt: (metadata.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? null,
      wins: typeof metadata.wins === "number" ? metadata.wins : 0,
      winsTarget: typeof metadata.winsTarget === "number" ? metadata.winsTarget : 0,
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
  winsTarget: number,
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
      winsTarget,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

export async function saveAnnouncement(announcement: string) {
  const boardDocRef = getBoardDocRef();
  if (!boardDocRef) return false;

  await setDoc(boardDocRef, {
    announcement: announcement.trim(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
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
    entries.forEach((entry, position) => batch.set(doc(recordsRef, String(entry.id)), cleanFirestoreData({
      ...entry,
      position,
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

export async function saveRecordPositions(
  entries: Array<{ id: number; position: number; stage: StageKey; stageEnteredAt?: string; version: number }>,
  actor: string,
  updatedRecordId?: number
) {
  const app = getFirebaseApp();
  if (!app || !entries.length) return;

  const batch = writeBatch(getFirestore(app));
  entries.forEach(({ id, position, stage, stageEnteredAt, version }) => {
    const recordRef = getRecordDocRef(id);
    if (!recordRef) return;
    const shouldUpdateMetadata = id === updatedRecordId;
    batch.set(recordRef, cleanFirestoreData({
      position,
      stage,
      stageEnteredAt,
      version,
      updatedAt: shouldUpdateMetadata ? new Date().toISOString() : undefined,
      updatedBy: shouldUpdateMetadata ? actor : undefined,
    }), { merge: true });
  });
  await batch.commit();
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
