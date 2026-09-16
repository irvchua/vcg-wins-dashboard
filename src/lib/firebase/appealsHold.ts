import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import type { AppealHoldEntry } from "../../types";
import { cleanFirestoreData, FirestoreConflictError as RecordConflictError, getFirebaseApp, isFirebaseAppConfigured } from "./auth";

export { RecordConflictError };

export const firebaseAppealsHoldBoardId = import.meta.env.VITE_FIREBASE_APPEALS_HOLD_BOARD_ID;
export const isAppealsHoldFirebaseConfigured = isFirebaseAppConfigured && Boolean(firebaseAppealsHoldBoardId);

function getBoardDocRef() {
  if (!isAppealsHoldFirebaseConfigured) return null;
  const app = getFirebaseApp();
  if (!app) return null;

  return doc(getFirestore(app), "appealsHoldBoards", firebaseAppealsHoldBoardId);
}

function getRecordsCollectionRef() {
  const boardDocRef = getBoardDocRef();
  return boardDocRef ? collection(boardDocRef, "records") : null;
}

function getRecordDocRef(id: number) {
  const recordsRef = getRecordsCollectionRef();
  return recordsRef ? doc(recordsRef, String(id)) : null;
}

export function subscribeToAppealRecords(
  onData: (entries: AppealHoldEntry[]) => void,
  onError: (error: Error) => void
) {
  const recordsRef = getRecordsCollectionRef();
  if (!recordsRef) return null;

  return onSnapshot(recordsRef, (snapshot) => {
    const entries = snapshot.docs
      .map((recordDoc) => recordDoc.data() as AppealHoldEntry)
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    onData(entries);
  }, onError);
}

export async function createAppealRecord(entry: AppealHoldEntry, actor: string) {
  const saved: AppealHoldEntry = { ...entry, updatedAt: new Date().toISOString(), updatedBy: actor, version: 1 };
  const recordRef = getRecordDocRef(entry.id);
  if (!recordRef) return saved;

  await setDoc(recordRef, cleanFirestoreData(saved));
  return saved;
}

export async function saveAppealRecord(entry: AppealHoldEntry, expectedVersion: number, actor: string) {
  const recordRef = getRecordDocRef(entry.id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return { ...entry, updatedBy: actor, version: expectedVersion + 1 };

  const database = getFirestore(app);
  const updatedAt = new Date().toISOString();
  const saved: AppealHoldEntry = { ...entry, updatedAt, updatedBy: actor, version: expectedVersion + 1 };
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists() || (snapshot.data().version ?? 1) !== expectedVersion) {
      throw new RecordConflictError();
    }
    transaction.set(recordRef, cleanFirestoreData(saved));
  });
  return saved;
}

export async function deleteAppealRecord(id: number, expectedVersion: number) {
  const recordRef = getRecordDocRef(id);
  const app = getFirebaseApp();
  if (!recordRef || !app) return;

  await runTransaction(getFirestore(app), async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists()) return;
    if ((snapshot.data().version ?? 1) !== expectedVersion) throw new RecordConflictError();
    transaction.delete(recordRef);
  });
}
