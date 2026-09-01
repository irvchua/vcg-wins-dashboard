import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { TaskEntry, TaskStatus } from "../../types";
import { cleanFirestoreData, FirestoreConflictError as TaskConflictError, getFirebaseApp, isFirebaseAppConfigured } from "./auth";

export { TaskConflictError };

export const tasksBoardId = import.meta.env.VITE_FIREBASE_TASKS_BOARD_ID;
export const isTasksFirebaseConfigured = isFirebaseAppConfigured && Boolean(tasksBoardId);

export const BOOTSTRAP_TASK_ADMIN_EMAIL = "admin@veteranschoiceglobal.com";

export type TaskBoardMetadata = {
  name: string;
  schemaVersion: number;
  configurationUpdatedAt: string | null;
};

export type TaskSubscriptionScope = { isAdmin: true } | { isAdmin: false; email: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getTaskBoardDocRef() {
  const app = getFirebaseApp();
  if (!app || !tasksBoardId) return null;

  return doc(getFirestore(app), "taskBoards", tasksBoardId);
}

function getTasksCollectionRef() {
  const boardRef = getTaskBoardDocRef();
  return boardRef ? collection(boardRef, "tasks") : null;
}

function getTaskDocRef(id: string) {
  const tasksRef = getTasksCollectionRef();
  return tasksRef ? doc(tasksRef, id) : null;
}

function getTaskAdminDocRef(email: string) {
  const boardRef = getTaskBoardDocRef();
  return boardRef ? doc(boardRef, "admins", normalizeEmail(email)) : null;
}

export function subscribeToTaskAdminStatus(
  email: string,
  onIsAdmin: (isAdmin: boolean) => void,
  onError: (error: Error) => void
) {
  if (!isTasksFirebaseConfigured) {
    onIsAdmin(true);
    return null;
  }
  if (normalizeEmail(email) === BOOTSTRAP_TASK_ADMIN_EMAIL) {
    onIsAdmin(true);
    return null;
  }

  const adminRef = getTaskAdminDocRef(email);
  if (!adminRef) {
    onIsAdmin(false);
    return null;
  }
  return onSnapshot(adminRef, (snapshot) => onIsAdmin(snapshot.exists()), onError);
}

export function subscribeToTaskAdmins(
  onData: (emails: string[]) => void,
  onError: (error: Error) => void
) {
  const boardRef = getTaskBoardDocRef();
  if (!boardRef) return null;

  return onSnapshot(collection(boardRef, "admins"), (snapshot) => {
    onData(snapshot.docs.map((adminDoc) => adminDoc.id));
  }, onError);
}

export async function grantTaskAdmin(email: string, actor: string) {
  const adminRef = getTaskAdminDocRef(email);
  if (!adminRef) return;

  await setDoc(adminRef, { grantedBy: actor, grantedAt: serverTimestamp() });
}

export async function revokeTaskAdmin(email: string) {
  if (normalizeEmail(email) === BOOTSTRAP_TASK_ADMIN_EMAIL) return;

  const adminRef = getTaskAdminDocRef(email);
  if (!adminRef) return;

  await deleteDoc(adminRef);
}

export function subscribeToTasks(
  scope: TaskSubscriptionScope,
  onData: (tasks: TaskEntry[]) => void,
  onError: (error: Error) => void
) {
  const tasksRef = getTasksCollectionRef();
  if (!tasksRef) return null;

  const tasksQuery = scope.isAdmin ? tasksRef : query(tasksRef, where("assignedToEmail", "==", normalizeEmail(scope.email)));

  return onSnapshot(tasksQuery, (snapshot) => {
    const tasks = snapshot.docs
      .map((taskDoc) => taskDoc.data() as TaskEntry)
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    onData(tasks);
  }, onError);
}

export function subscribeToTaskBoard(
  onData: (metadata: TaskBoardMetadata | null) => void,
  onError: (error: Error) => void
) {
  const boardRef = getTaskBoardDocRef();
  if (!boardRef) return null;

  return onSnapshot(boardRef, (snapshot) => {
    if (!snapshot.exists()) {
      onData(null);
      return;
    }

    const data = snapshot.data();
    onData({
      name: typeof data.name === "string" ? data.name : "Tasks",
      schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
      configurationUpdatedAt: data.updatedAt?.toDate?.().toISOString() ?? null,
    });
  }, onError);
}

export async function initializeTaskBoard(name = "Tasks") {
  const boardRef = getTaskBoardDocRef();
  const app = getFirebaseApp();
  if (!boardRef || !app) return false;

  return runTransaction(getFirestore(app), async (transaction) => {
    const snapshot = await transaction.get(boardRef);
    if (snapshot.exists()) return false;

    transaction.set(boardRef, {
      name: name.trim() || "Tasks",
      schemaVersion: 1,
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

export async function createTask(task: TaskEntry, actor: string) {
  const taskRef = getTaskDocRef(task.id);
  if (!taskRef) return;

  await setDoc(taskRef, cleanFirestoreData({
    ...task,
    assignedToEmail: normalizeEmail(task.assignedToEmail),
    createdBy: actor,
    createdAt: task.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    version: 1,
  }));
}

export async function saveTask(task: TaskEntry, expectedVersion: number, actor: string) {
  const taskRef = getTaskDocRef(task.id);
  const app = getFirebaseApp();
  if (!taskRef || !app) return { ...task, version: expectedVersion + 1 };

  const database = getFirestore(app);
  const updatedAt = new Date().toISOString();
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(taskRef);
    if (!snapshot.exists() || (snapshot.data().version ?? 1) !== expectedVersion) {
      throw new TaskConflictError();
    }
    const existingTask = snapshot.data() as TaskEntry;
    transaction.set(taskRef, cleanFirestoreData({
      ...task,
      assignedToEmail: normalizeEmail(task.assignedToEmail),
      createdAt: existingTask.createdAt,
      createdBy: existingTask.createdBy,
      updatedAt,
      updatedBy: actor,
      version: expectedVersion + 1,
    }));
  });
  return { ...task, assignedToEmail: normalizeEmail(task.assignedToEmail), updatedAt, updatedBy: actor, version: expectedVersion + 1 };
}

export async function saveTaskPositions(
  entries: Array<{ id: string; position: number; status: TaskStatus; version: number }>,
  actor: string
) {
  const app = getFirebaseApp();
  if (!app || !entries.length) return;

  const batch = writeBatch(getFirestore(app));
  const updatedAt = new Date().toISOString();
  entries.forEach(({ id, position, status, version }) => {
    const taskRef = getTaskDocRef(id);
    if (!taskRef) return;
    batch.set(taskRef, cleanFirestoreData({
      position,
      status,
      version: version + 1,
      updatedAt,
      updatedBy: actor,
    }), { merge: true });
  });
  await batch.commit();
  return entries.map((entry) => ({
    ...entry,
    updatedAt,
    updatedBy: actor,
    version: entry.version + 1,
  }));
}

export async function deleteTask(id: string) {
  const taskRef = getTaskDocRef(id);
  if (!taskRef) return;

  await deleteDoc(taskRef);
}
