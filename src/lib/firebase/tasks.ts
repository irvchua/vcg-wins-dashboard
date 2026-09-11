import { getAuth } from "firebase/auth";
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
} from "firebase/firestore";
import type { TaskEntry, TaskStatus } from "../../types";
import { FirestoreConflictError as TaskConflictError, getFirebaseApp, isFirebaseAppConfigured, type AuthUser } from "./auth";

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

export type TaskMember = {
  id: string;
  email: string;
  name: string;
};

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

function getTaskAdminDocRef(email: string) {
  const boardRef = getTaskBoardDocRef();
  return boardRef ? doc(boardRef, "admins", normalizeEmail(email)) : null;
}

function getTaskMembersCollectionRef() {
  const boardRef = getTaskBoardDocRef();
  return boardRef ? collection(boardRef, "members") : null;
}

export async function registerTaskMember(user: AuthUser) {
  const membersRef = getTaskMembersCollectionRef();
  if (!membersRef) return;

  await setDoc(doc(membersRef, user.id), {
    // Written exactly as Firebase Auth reports it (not normalizeEmail'd) so it always
    // matches request.auth.token.email in firestore.rules' create/update check. The read
    // path in subscribeToTaskMembers below normalizes it for display/matching elsewhere.
    email: user.email,
    name: user.name.trim() || user.email,
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
}

export function subscribeToTaskMembers(
  onData: (members: TaskMember[]) => void,
  onError: (error: Error) => void
) {
  const membersRef = getTaskMembersCollectionRef();
  if (!membersRef) return null;

  return onSnapshot(membersRef, (snapshot) => {
    const members = snapshot.docs
      .map((memberDoc) => {
        const data = memberDoc.data();
        return {
          id: memberDoc.id,
          email: typeof data.email === "string" ? normalizeEmail(data.email) : "",
          name: typeof data.name === "string" ? data.name : "",
        };
      })
      .filter((member) => member.email)
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    onData(members);
  }, onError);
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

async function callTaskApi<T>(body: Record<string, unknown>, requestId: string = crypto.randomUUID()): Promise<T> {
  const app = getFirebaseApp();
  const user = app && getAuth(app).currentUser;
  if (!user) throw new Error("Sign in to manage tasks.");
  const token = await user.getIdToken();
  const payload = JSON.stringify({ boardId: tasksBoardId, requestId, ...body });
  let response: Response | undefined;
  // Reuse the request ID if a response is lost after the server commits a save.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch("/api/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: payload,
      });
      if (response.status >= 500 && attempt === 0) continue;
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  if (!response) throw new Error("Task server unavailable.");
  const data = await response.json();
  if (response.status === 409) throw new TaskConflictError();
  if (!response.ok) throw new Error(data.error || "Task could not be saved.");
  if (data.emailStatus === "pending" || data.emailStatus === "expired") {
    window.dispatchEvent(new CustomEvent("task-email-pending", { detail: { receiptId: data.receiptId, expired: data.emailStatus === "expired" } }));
  }
  return data.result as T;
}

export async function retryTaskEmail(receiptId: string) {
  return callTaskApi<null>({ action: "retryEmail", receiptId });
}

export async function createTask(task: TaskEntry, actor: string, requestId?: string) {
  if (!isTasksFirebaseConfigured) return { ...task, createdBy: actor };
  return callTaskApi<TaskEntry>({ action: "create", task }, requestId);
}

export async function saveTask(task: TaskEntry, expectedVersion: number, actor: string, dueDateConfirmed = false) {
  if (!isTasksFirebaseConfigured) return { ...task, updatedBy: actor, version: expectedVersion + 1 };
  return callTaskApi<TaskEntry>({ action: "update", task, expectedVersion, dueDateConfirmed });
}

export async function saveTaskPositions(
  entries: Array<{ id: string; position: number; status: TaskStatus; version: number }>,
  actor: string
) {
  if (!isTasksFirebaseConfigured || !entries.length) return entries.map((entry) => ({ ...entry, version: entry.version + 1, updatedBy: actor }));
  return callTaskApi<typeof entries>({ action: "reorder", entries });
}

export async function deleteTask(id: string, expectedVersion: number) {
  if (!isTasksFirebaseConfigured) return;
  await callTaskApi<null>({ action: "delete", task: { id }, expectedVersion });
}
