import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import "../../styles/shared.css";
import "./TasksPage.css";
import {
  canUserEdit,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  type AuthUser,
} from "../../lib/firebase/auth";
import {
  createTask,
  deleteTask,
  initializeTaskBoard,
  isTasksFirebaseConfigured,
  registerTaskMember,
  retryTaskEmail,
  saveTask,
  saveTaskPositions,
  subscribeToTaskAdminStatus,
  subscribeToTaskBoard,
  subscribeToTaskMembers,
  subscribeToTasks,
  TaskConflictError,
  type TaskMember,
} from "../../lib/firebase/tasks";
import type { TaskEntry, TaskPriority, TaskStatus } from "../../types";

type StatusConfigItem = {
  key: TaskStatus;
  title: string;
};

type TaskBoardState = Record<TaskStatus, TaskEntry[]>;

type AddTaskDraft = {
  assignedTo: string;
  assignedToEmail: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  title: string;
};

const statusConfig: StatusConfigItem[] = [
  { key: "todo", title: "TO DO" },
  { key: "inProgress", title: "IN PROGRESS" },
  { key: "blocked", title: "BLOCKED" },
  { key: "done", title: "DONE" },
];

const priorityOptions: TaskPriority[] = ["low", "medium", "high", "urgent"];
const priorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const emptyTaskBoard: TaskBoardState = { todo: [], inProgress: [], blocked: [], done: [] };

// Without Firebase, isTaskAdmin defaults to true (see the local-mode convention below) but the
// real member directory can never populate, which would make the assignee dropdown permanently
// empty. Seed a synthetic entry so local/offline testing stays usable.
const localModeTaskMembers: TaskMember[] = [{ id: "local-user", email: "local@example.com", name: "Local user" }];

const defaultAddTaskDraft: AddTaskDraft = {
  assignedTo: "",
  assignedToEmail: "",
  description: "",
  dueDate: "",
  priority: "medium",
  status: "todo",
  title: "",
};

function suggestedDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTaskStatus(status: unknown): TaskStatus {
  return statusConfig.some((config) => config.key === status) ? (status as TaskStatus) : "todo";
}

function normalizeTaskPriority(priority: unknown): TaskPriority {
  return priorityOptions.includes(priority as TaskPriority) ? (priority as TaskPriority) : "medium";
}

function groupTasksByStatus(tasks: TaskEntry[]): TaskBoardState {
  const grouped: TaskBoardState = { todo: [], inProgress: [], blocked: [], done: [] };
  tasks.forEach((rawTask) => {
    const task: TaskEntry = {
      ...rawTask,
      status: normalizeTaskStatus(rawTask.status),
      priority: normalizeTaskPriority(rawTask.priority),
    };
    grouped[task.status].push(task);
  });
  Object.values(grouped).forEach((entries) =>
    entries.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
  );
  return grouped;
}

function isOverdue(task: TaskEntry): boolean {
  if (!task.dueDate || task.status === "done") return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return task.dueDate < today;
}

export default function TasksPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isTasksFirebaseConfigured);
  const [authError, setAuthError] = useState("");
  const [isTaskAdmin, setIsTaskAdmin] = useState(!isTasksFirebaseConfigured);
  const [isAdminStatusLoading, setIsAdminStatusLoading] = useState(isTasksFirebaseConfigured);
  const [taskBoard, setTaskBoard] = useState<TaskBoardState>(emptyTaskBoard);
  const [isBoardLoading, setIsBoardLoading] = useState(isTasksFirebaseConfigured);
  const [taskMembers, setTaskMembers] = useState<TaskMember[]>(
    isTasksFirebaseConfigured ? [] : localModeTaskMembers
  );
  const [memberDirectoryMessage, setMemberDirectoryMessage] = useState("");
  const [pendingEmails, setPendingEmails] = useState<Array<{ receiptId: string; expired: boolean }>>([]);
  const [isRetryingEmail, setIsRetryingEmail] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [addTaskError, setAddTaskError] = useState("");
  const [isAddTaskLocked, setIsAddTaskLocked] = useState(false);
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);
  const [addTaskDraft, setAddTaskDraft] = useState<AddTaskDraft>(defaultAddTaskDraft);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editTaskDraft, setEditTaskDraft] = useState<TaskEntry | null>(null);
  const [editTaskInitial, setEditTaskInitial] = useState<TaskEntry | null>(null);
  const [dueDateConfirmed, setDueDateConfirmed] = useState(false);
  const [editConflict, setEditConflict] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const hasInitializedBoard = useRef(false);
  const pendingAddTaskRef = useRef<{ task: TaskEntry; requestId: string } | null>(null);

  const canEditTasks = canUserEdit(authUser);
  const showAuthGate = isTasksFirebaseConfigured && (!authUser || !canEditTasks);
  const canEditTodoDueDate = !isTasksFirebaseConfigured || (editTaskInitial?.assignedByEmail
    ? editTaskInitial.assignedByEmail === authUser?.email.toLowerCase()
    : isTaskAdmin);
  const updaterName = authUser?.name.trim() || "Local user";
  const editAssignedToEmail = isTaskAdmin
    ? editTaskDraft?.assignedToEmail.trim().toLowerCase()
    : editTaskInitial?.assignedToEmail;
  const editNeedsReview = Boolean(editTaskDraft && editTaskInitial
    && editTaskDraft.status !== "todo" && editTaskDraft.status !== "done"
    && (editTaskDraft.status !== editTaskInitial.status || editTaskInitial.dueDateReviewRequired
      || editAssignedToEmail !== editTaskInitial.assignedToEmail));

  useEffect(() => {
    if (!isTasksFirebaseConfigured) return;

    const unsubscribe = subscribeToAuth((user) => {
      const hasTaskAccess = Boolean(user && canUserEdit(user));
      setAuthUser(user);
      setTaskBoard(emptyTaskBoard);
      setPendingEmails([]);
      setTaskMembers([]);
      setIsTaskAdmin(false);
      setIsAdminStatusLoading(hasTaskAccess);
      setIsBoardLoading(hasTaskAccess);
      setSyncMessage("");
      setMemberDirectoryMessage("");
      setIsAuthLoading(false);
      if (hasTaskAccess && user) {
        registerTaskMember(user)
          .then(() => setMemberDirectoryMessage(""))
          .catch((error) => {
            console.error("Task member registration failed:", error);
            setMemberDirectoryMessage("Couldn't add you to the assignee directory. Try reloading the page.");
          });
      }
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser || !canUserEdit(authUser)) return;

    const unsubscribe = subscribeToTaskAdminStatus(
      authUser.email,
      (isAdmin) => {
        setTaskBoard(emptyTaskBoard);
        setTaskMembers([]);
        setIsBoardLoading(true);
        setIsTaskAdmin(isAdmin);
        setIsAdminStatusLoading(false);
      },
      (error) => {
        console.error("Task admin status check failed:", error);
        setTaskBoard(emptyTaskBoard);
        setTaskMembers([]);
        setIsBoardLoading(true);
        setIsTaskAdmin(false);
        setIsAdminStatusLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [authUser]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured) return;
    if (!authUser || !canUserEdit(authUser) || isAdminStatusLoading) return;

    const handleData = (tasks: TaskEntry[]) => {
      setTaskBoard(groupTasksByStatus(tasks));
      setIsBoardLoading(false);
    };
    const handleError = (error: Error) => {
      console.error("Task sync failed:", error);
      setSyncMessage("Tasks unavailable. Check your connection.");
      setIsBoardLoading(false);
    };

    const unsubscribe = isTaskAdmin
      ? subscribeToTasks({ isAdmin: true }, handleData, handleError)
      : subscribeToTasks({ isAdmin: false, email: authUser.email }, handleData, handleError);

    return () => unsubscribe?.();
  }, [authUser, isAdminStatusLoading, isTaskAdmin]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !isTaskAdmin) return;

    const unsubscribe = subscribeToTaskMembers(
      (members) => {
        setTaskMembers(members);
        setMemberDirectoryMessage("");
      },
      (error) => {
        console.error("Task member directory sync failed:", error);
        setMemberDirectoryMessage("The assignee directory is unavailable. Check your connection.");
      }
    );
    return () => unsubscribe?.();
  }, [isTaskAdmin]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !isTaskAdmin || hasInitializedBoard.current) return;

    const unsubscribe = subscribeToTaskBoard(
      (metadata) => {
        if (metadata || hasInitializedBoard.current) return;
        hasInitializedBoard.current = true;
        initializeTaskBoard().catch((error) => {
          console.error("Task board initialization failed:", error);
          hasInitializedBoard.current = false;
        });
      },
      (error) => console.error("Task board metadata sync failed:", error)
    );
    return () => unsubscribe?.();
  }, [isTaskAdmin]);

  useEffect(() => {
    const onPending = (event: Event) => {
      const notice = (event as CustomEvent<{ receiptId: string; expired: boolean }>).detail;
      setPendingEmails((current) => [...current.filter((item) => item.receiptId !== notice.receiptId), notice]);
    };
    window.addEventListener("task-email-pending", onPending);
    return () => window.removeEventListener("task-email-pending", onPending);
  }, []);

  async function retryEmails() {
    setIsRetryingEmail(true);
    const pending = pendingEmails.filter((item) => !item.expired);
    setPendingEmails((current) => current.filter((item) => item.expired));
    for (const item of pending) {
      try { await retryTaskEmail(item.receiptId); }
      catch { setPendingEmails((current) => [...current, item]); }
    }
    setIsRetryingEmail(false);
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isFiltering = Boolean(normalizedSearchQuery) || priorityFilter !== "all";
  const filteredTaskBoard = useMemo(() => {
    if (!isFiltering) return taskBoard;

    const matchesTask = (task: TaskEntry) => {
      const matchesQuery = !normalizedSearchQuery || [task.title, task.description, task.assignedTo, task.assignedToEmail]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearchQuery));
      const matchesPriority = priorityFilter === "all" || task.priority === priorityFilter;
      return matchesQuery && matchesPriority;
    };

    return Object.fromEntries(
      statusConfig.map((status) => [status.key, taskBoard[status.key].filter(matchesTask)])
    ) as TaskBoardState;
  }, [isFiltering, normalizedSearchQuery, priorityFilter, taskBoard]);

  function handleSignIn() {
    setAuthError("");
    signInWithGoogle().catch((error) => {
      console.error("Google sign-in failed:", error);
      setAuthError("Sign-in failed. Please try again.");
    });
  }

  function handleSignOut() {
    setAuthError("");
    signOutUser().catch((error) => {
      console.error("Sign-out failed:", error);
      setAuthError("Sign-out failed. Please try again.");
    });
  }

  function openAddTask(status: TaskStatus = "todo") {
    pendingAddTaskRef.current = null;
    setIsAddTaskLocked(false);
    setAddTaskError("");
    setAddTaskDraft({
      ...defaultAddTaskDraft,
      status,
      dueDate: status === "todo" ? suggestedDueDate() : "",
      assignedTo: isTaskAdmin ? "" : (authUser?.name ?? ""),
      assignedToEmail: isTaskAdmin ? "" : (authUser?.email ?? ""),
    });
    setIsAddTaskOpen(true);
  }

  function closeAddTask() {
    pendingAddTaskRef.current = null;
    setIsAddTaskLocked(false);
    setIsAddTaskOpen(false);
    setAddTaskDraft(defaultAddTaskDraft);
  }

  async function submitAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = addTaskDraft.title.trim();
    const assignedToEmail = (isTaskAdmin ? addTaskDraft.assignedToEmail : authUser?.email ?? "").trim().toLowerCase();
    if (!title || !assignedToEmail || isSavingTask) return;

    // Keep the whole payload stable: the server fingerprints timestamps and position too.
    const newTask: TaskEntry = pendingAddTaskRef.current?.task ?? {
      id: createTaskId(),
      title,
      description: addTaskDraft.description.trim() || undefined,
      assignedTo: addTaskDraft.assignedTo.trim(),
      assignedToEmail,
      assignedByEmail: authUser?.email.toLowerCase() || "local@example.com",
      priority: addTaskDraft.priority,
      status: addTaskDraft.status,
      dueDate: addTaskDraft.dueDate || undefined,
      position: taskBoard[addTaskDraft.status].length,
      createdBy: updaterName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: updaterName,
      version: 1,
    };
    const requestId = pendingAddTaskRef.current?.requestId ?? createTaskId();
    pendingAddTaskRef.current = { task: newTask, requestId };
    setIsAddTaskLocked(true);
    setIsSavingTask(true);
    setAddTaskError("");
    try {
      const savedTask = await createTask(newTask, updaterName, requestId);
      setTaskBoard((current) => groupTasksByStatus([...Object.values(current).flat().filter((task) => task.id !== savedTask.id), savedTask]));
      closeAddTask();
    } catch (error) {
      setAddTaskError(error instanceof Error ? error.message : "Task could not be saved.");
    } finally {
      setIsSavingTask(false);
    }
  }

  function openEditTask(task: TaskEntry) {
    setDueDateConfirmed(false);
    setSelectedTaskId(task.id);
    setEditTaskInitial({ ...task });
    setEditTaskDraft({ ...task });
    setEditConflict("");
    setIsConfirmingDelete(false);
  }

  function dismissEditTask() {
    setSelectedTaskId(null);
    setEditTaskInitial(null);
    setEditTaskDraft(null);
    setEditConflict("");
    setIsConfirmingDelete(false);
  }

  async function closeEditTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTaskId || !editTaskInitial || !editTaskDraft || isSavingTask) return;

    const title = editTaskDraft.title.trim();
    const assignedToEmail = editAssignedToEmail;
    if (!title) {
      setEditConflict("Enter a task title before saving.");
      return;
    }
    if (!assignedToEmail) {
      setEditConflict("Select an assignee before saving.");
      return;
    }

    const statusChanged = editTaskDraft.status !== editTaskInitial.status;
    const isAssignee = !isTasksFirebaseConfigured || assignedToEmail === authUser?.email.toLowerCase();
    const needsReview = editNeedsReview;
    if (needsReview && isAssignee && (!dueDateConfirmed || !editTaskDraft.dueDate)) {
      setEditConflict("Choose and confirm the due date for this status before saving.");
      return;
    }

    if (editTaskDraft.status === "todo" && !canEditTodoDueDate && (editTaskDraft.dueDate ?? "") !== (editTaskInitial.dueDate ?? "")) {
      setEditConflict("Only the assigner can change a To Do due date.");
      return;
    }

    const hasChanges = (["title", "description", "assignedTo", "assignedToEmail", "priority", "status", "dueDate"] as const)
      .some((field) => (editTaskDraft[field] ?? "") !== (editTaskInitial[field] ?? ""));
    if (!hasChanges && !(needsReview && dueDateConfirmed)) {
      dismissEditTask();
      return;
    }

    const taskToSave: TaskEntry = {
      ...editTaskDraft,
      title,
      description: editTaskDraft.description?.trim() || undefined,
      assignedTo: editTaskDraft.assignedTo.trim(),
      assignedToEmail,
      assignedByEmail: assignedToEmail !== editTaskInitial.assignedToEmail ? authUser?.email.toLowerCase() : editTaskInitial.assignedByEmail,
      dueDate: editTaskDraft.dueDate || undefined,
      dueDateReviewRequired: Boolean(needsReview && !(isAssignee && dueDateConfirmed)),
      position: statusChanged ? taskBoard[editTaskDraft.status].length : editTaskDraft.position,
    };

    setIsSavingTask(true);
    setEditConflict("");
    try {
      const savedTask = await saveTask(taskToSave, editTaskInitial.version ?? 1, updaterName, dueDateConfirmed);
      setTaskBoard((current) =>
        groupTasksByStatus(
          Object.values(current)
            .flat()
            .map((task) => (task.id === savedTask.id ? savedTask : task))
        )
      );
      dismissEditTask();
    } catch (error) {
      if (error instanceof TaskConflictError) {
        setEditConflict("Another editor changed this task. Reload the latest version before trying again.");
      } else {
        console.error("Task save failed:", error);
        setEditConflict(error instanceof Error ? error.message : "This task could not be saved. Check your connection and try again.");
      }
    } finally {
      setIsSavingTask(false);
    }
  }

  async function handleDeleteTask() {
    if (!selectedTaskId || !editTaskInitial || !isTaskAdmin || isSavingTask) return;
    const idToDelete = selectedTaskId;

    setIsSavingTask(true);
    try {
      await deleteTask(idToDelete, editTaskInitial.version ?? 1);
      setTaskBoard((current) => groupTasksByStatus(Object.values(current).flat().filter((task) => task.id !== idToDelete)));
      dismissEditTask();
    } catch (error) {
      setEditConflict(error instanceof Error ? error.message : "Task could not be deleted.");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function moveTask(fromStatus: TaskStatus, toStatus: TaskStatus, id: string, targetId?: string) {
    const current = taskBoard;
    const movedTask = current[fromStatus]?.find((task) => task.id === id);
    if (!movedTask || targetId === id || isSavingTask) return;
    if (fromStatus !== toStatus) {
      openEditTask(movedTask);
      setEditTaskDraft({ ...movedTask, status: toStatus });
      return;
    }

    const originalPosition = new Map<string, { position: number; status: TaskStatus; version: number }>();
    current[fromStatus].forEach((task) =>
      originalPosition.set(task.id, { position: task.position ?? 0, status: fromStatus, version: task.version ?? 1 })
    );
    if (toStatus !== fromStatus) {
      current[toStatus].forEach((task) =>
        originalPosition.set(task.id, { position: task.position ?? 0, status: toStatus, version: task.version ?? 1 })
      );
    }

    const sourceEntries = current[fromStatus].filter((task) => task.id !== id);
    const destinationEntries = fromStatus === toStatus
      ? sourceEntries
      : current[toStatus].filter((task) => task.id !== id);
    const targetIndex = targetId === undefined
      ? destinationEntries.length
      : destinationEntries.findIndex((task) => task.id === targetId);
    const insertAt = targetIndex < 0 ? destinationEntries.length : targetIndex;
    destinationEntries.splice(insertAt, 0, fromStatus === toStatus ? movedTask : { ...movedTask, status: toStatus });

    const applyPositions = (tasks: TaskEntry[], status: TaskStatus) =>
      tasks.map((task, position) => {
        const original = originalPosition.get(task.id);
        const changed = !original || original.status !== status || original.position !== position;
        return changed
          ? { ...task, position, status, version: (original?.version ?? task.version ?? 1) + 1 }
          : { ...task, position, status };
      });

    const nextFromStatus = applyPositions(fromStatus === toStatus ? destinationEntries : sourceEntries, fromStatus);
    const nextToStatus = applyPositions(destinationEntries, toStatus);
    const nextByStatus: TaskBoardState = { ...current, [fromStatus]: nextFromStatus, [toStatus]: nextToStatus };

    const affectedStatuses = fromStatus === toStatus ? [toStatus] : [fromStatus, toStatus];
    const positionUpdates = affectedStatuses.flatMap((status) =>
      nextByStatus[status]
        .filter((task) => {
          const original = originalPosition.get(task.id);
          return !original || original.status !== status || original.position !== task.position;
        })
        .map((task) => ({
          id: task.id,
          position: task.position ?? 0,
          status,
          version: originalPosition.get(task.id)?.version ?? 1,
        }))
    );

    if (positionUpdates.length) {
      setIsSavingTask(true);
      try {
        const saved = await saveTaskPositions(positionUpdates, updaterName);
        const updates = new Map(saved.map((entry) => [entry.id, entry]));
        setTaskBoard((current) => groupTasksByStatus(Object.values(current).flat().map((task) => {
          const update = updates.get(task.id);
          return update && update.version >= (task.version ?? 1) ? { ...task, ...update } : task;
        })));
      } catch (error) {
        setSyncMessage(error instanceof Error ? error.message : "Reorder failed. Try again.");
      } finally {
        setIsSavingTask(false);
      }
    }
  }

  return (
    <main className="tasks-shell">
      <div className="tasks-top-bar">
        <Link to="/" className="tasks-back-link">
          ← Dashboard
        </Link>
        {authUser ? (
          <div className="tasks-account">
            <span>{authUser.name}</span>
            {isTaskAdmin ? <span className="tasks-admin-badge">Admin</span> : null}
            <button className="nav-button" onClick={handleSignOut}>Sign Out</button>
          </div>
        ) : null}
      </div>

      <h1>Tasks</h1>

      {!isTasksFirebaseConfigured ? (
        <p className="tasks-config-warning">
          Task storage is not configured for this environment (missing VITE_FIREBASE_TASKS_BOARD_ID). Changes here will not be saved.
        </p>
      ) : null}

      {isAuthLoading ? (
        <p className="tasks-loading">Loading…</p>
      ) : showAuthGate ? (
        <div className="tasks-auth-gate">
          <p>Sign in with an approved Google account to view and manage tasks.</p>
          <button className="primary-action-button" onClick={handleSignIn}>Sign in with Google</button>
          {authError ? <p className="tasks-auth-error" role="alert">{authError}</p> : null}
        </div>
      ) : (
        <>
          <div className="tasks-filter-bar">
            <input
              type="search"
              placeholder="Search title, description, assignee…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as TaskPriority | "all")}
            >
              <option value="all">All priorities</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>{priorityLabels[priority]}</option>
              ))}
            </select>
            <button className="primary-action-button" onClick={() => openAddTask()}>+ New Task</button>
          </div>

          {pendingEmails.length ? (
            <div className="tasks-sync-message" role="status">
              Tasks saved. {pendingEmails.length} email notification(s) {pendingEmails.some((item) => item.expired) ? "need administrator attention" : "are waiting to send"}.
              {pendingEmails.some((item) => !item.expired) ? <button type="button" className="nav-button" disabled={isRetryingEmail} onClick={retryEmails}>{isRetryingEmail ? "Retrying…" : "Retry email"}</button> : null}
            </div>
          ) : null}
          {syncMessage ? <p className="tasks-sync-message" role="alert">{syncMessage}</p> : null}
          {memberDirectoryMessage ? <p className="tasks-sync-message" role="alert">{memberDirectoryMessage}</p> : null}

          {isBoardLoading ? (
            <p className="tasks-loading">Loading tasks…</p>
          ) : (
            <div className="task-board">
              {statusConfig.map((status) => (
                <section
                  className="task-column"
                  key={status.key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const taskId = event.dataTransfer.getData("taskId");
                    const fromStatus = event.dataTransfer.getData("fromStatus") as TaskStatus;
                    if (taskId) moveTask(fromStatus, status.key, taskId);
                  }}
                >
                  <div className="task-column-header">
                    <h2>{status.title}</h2>
                    <div className="task-column-actions">
                      <span>
                        {filteredTaskBoard[status.key].length}
                        {isFiltering ? `/${taskBoard[status.key].length}` : ""}
                      </span>
                      <button onClick={() => openAddTask(status.key)}>+ Add</button>
                    </div>
                  </div>

                  <div className="task-list">
                    {filteredTaskBoard[status.key].length ? (
                      filteredTaskBoard[status.key].map((task, taskIndex) => (
                        <div
                          className={`task-card ${isOverdue(task) ? "task-overdue" : ""}`}
                          key={task.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("taskId", task.id);
                            event.dataTransfer.setData("fromStatus", status.key);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const taskId = event.dataTransfer.getData("taskId");
                            const fromStatus = event.dataTransfer.getData("fromStatus") as TaskStatus;
                            if (taskId) moveTask(fromStatus, status.key, taskId, task.id);
                          }}
                        >
                          <div className="task-card-handle">⋮⋮</div>
                          <button type="button" className="task-card-body" onClick={() => openEditTask(task)}>
                            <span className={`priority-badge priority-badge-${task.priority}`}>
                              {priorityLabels[task.priority]}
                            </span>
                            {isOverdue(task) ? (
                              <span className="task-overdue-badge">
                                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 3 2 21h20L12 3Z" />
                                  <path d="M12 9v5m0 3h.01" />
                                </svg>
                                Overdue
                              </span>
                            ) : null}
                            <span className="task-card-title">{task.title}</span>
                            {task.assignedTo ? <span className="task-card-assignee">{task.assignedTo}</span> : null}
                            {task.dueDateReviewRequired && task.status !== "done" ? <span className="task-card-due">Due date needs your review</span> : null}
                            {task.dueDate ? (
                              <span className="task-card-due">
                                Due {task.dueDate}
                              </span>
                            ) : null}
                          </button>
                          <div className="task-order-actions" aria-label={`Reorder ${task.title}`}>
                            <button
                              type="button"
                              aria-label={`Move ${task.title} up`}
                              disabled={taskIndex === 0}
                              onClick={() => moveTask(status.key, status.key, task.id, filteredTaskBoard[status.key][taskIndex - 1]?.id)}
                            >↑</button>
                            <button
                              type="button"
                              aria-label={`Move ${task.title} down`}
                              disabled={taskIndex === filteredTaskBoard[status.key].length - 1}
                              onClick={() => {
                                const afterNext = filteredTaskBoard[status.key][taskIndex + 2]?.id;
                                moveTask(status.key, status.key, task.id, afterNext);
                              }}
                            >↓</button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="task-column-empty">
                        {isFiltering ? "No matching tasks" : "No tasks"}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}

          {isAddTaskOpen ? (
            <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!isSavingTask) closeAddTask(); }}>
              <div className="task-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
                <h2>New Task</h2>
                <form onSubmit={submitAddTask}>
                  <label className="modal-field">
                    Title
                    <input
                      disabled={isAddTaskLocked}
                      value={addTaskDraft.title}
                      onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, title: event.target.value }))}
                      required
                      autoFocus
                    />
                  </label>
                  <label className="modal-field">
                    Description
                    <textarea
                      disabled={isAddTaskLocked}
                      value={addTaskDraft.description}
                      onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, description: event.target.value }))}
                    />
                  </label>
                  {isTaskAdmin ? (
                    <div className="task-modal-row task-modal-row-assignee">
                      <label className="modal-field">
                        Assignee
                        <select
                          disabled={isAddTaskLocked}
                          required
                          value={addTaskDraft.assignedToEmail}
                          onChange={(event) => {
                            const member = taskMembers.find((candidate) => candidate.email === event.target.value);
                            setAddTaskDraft((draft) => ({
                              ...draft,
                              assignedTo: member?.name || member?.email || "",
                              assignedToEmail: member?.email || "",
                            }));
                          }}
                        >
                          <option value="">Select a user</option>
                          {taskMembers.map((member) => (
                            <option key={member.id} value={member.email}>
                              {member.name ? `${member.name} (${member.email})` : member.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <label className="modal-field">
                      Assignee
                      <input
                        disabled={isAddTaskLocked}
                        value={addTaskDraft.assignedTo}
                        onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, assignedTo: event.target.value }))}
                      />
                      <span className="tasks-assignee-note">Tasks you create are assigned to you ({authUser?.email})</span>
                    </label>
                  )}
                  <div className="task-modal-row">
                    <label className="modal-field">
                      Priority
                      <select
                        disabled={isAddTaskLocked}
                        value={addTaskDraft.priority}
                        onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, priority: event.target.value as TaskPriority }))}
                      >
                        {priorityOptions.map((priority) => (
                          <option key={priority} value={priority}>{priorityLabels[priority]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="modal-field">
                      Status
                      <select
                        disabled={isAddTaskLocked}
                        value={addTaskDraft.status}
                        onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, status: event.target.value as TaskStatus, dueDate: event.target.value === "todo" && !draft.dueDate ? suggestedDueDate() : draft.dueDate }))}
                      >
                        {statusConfig.map((status) => (
                          <option key={status.key} value={status.key}>{status.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="modal-field">
                      Due date
                      <input
                        disabled={isAddTaskLocked}
                        type="date"
                        value={addTaskDraft.dueDate}
                        onChange={(event) => setAddTaskDraft((draft) => ({ ...draft, dueDate: event.target.value }))}
                      />
                    </label>
                  </div>
                  {addTaskError ? <p className="tasks-sync-message" role="alert">{addTaskError} Retry to confirm this submission, or cancel to start a new draft.</p> : null}
                  <div className="record-modal-actions">
                    <button type="button" className="secondary-action-button" onClick={closeAddTask} disabled={isSavingTask}>Cancel</button>
                    <button type="submit" className="primary-action-button" disabled={isSavingTask}>{isSavingTask ? "Saving…" : "Add Task"}</button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {editTaskDraft ? (
            <div className="modal-backdrop" role="presentation" onMouseDown={dismissEditTask}>
              <div className="task-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
                <h2>Edit Task</h2>
                <form onSubmit={closeEditTask}>
                  <label className="modal-field">
                    Title
                    <input
                      required
                      value={editTaskDraft.title}
                      onChange={(event) => setEditTaskDraft((draft) => draft && { ...draft, title: event.target.value })}
                    />
                  </label>
                  <label className="modal-field">
                    Description
                    <textarea
                      value={editTaskDraft.description ?? ""}
                      onChange={(event) => setEditTaskDraft((draft) => draft && { ...draft, description: event.target.value })}
                    />
                  </label>
                  {isTaskAdmin ? (
                    <div className="task-modal-row task-modal-row-assignee">
                      <label className="modal-field">
                        Assignee
                        <select
                          required
                          value={editTaskDraft.assignedToEmail}
                          onChange={(event) => {
                            const member = taskMembers.find((candidate) => candidate.email === event.target.value);
                            setDueDateConfirmed(false);
                            setEditTaskDraft((draft) => draft && ({
                              ...draft,
                              assignedTo: member?.name || member?.email || "",
                              assignedToEmail: member?.email || "",
                            }));
                          }}
                        >
                          {!editTaskDraft.assignedToEmail ? <option value="">Select a user</option> : null}
                          {editTaskDraft.assignedToEmail && !taskMembers.some((member) => member.email === editTaskDraft.assignedToEmail) ? (
                            <option value={editTaskDraft.assignedToEmail}>
                              {editTaskDraft.assignedTo || editTaskDraft.assignedToEmail} ({editTaskDraft.assignedToEmail})
                            </option>
                          ) : null}
                          {taskMembers.map((member) => (
                            <option key={member.id} value={member.email}>
                              {member.name ? `${member.name} (${member.email})` : member.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <label className="modal-field">
                      Assignee
                      <input
                        value={editTaskDraft.assignedTo}
                        onChange={(event) => setEditTaskDraft((draft) => draft && { ...draft, assignedTo: event.target.value })}
                      />
                      <span className="tasks-assignee-note">Assigned to you ({editTaskDraft.assignedToEmail})</span>
                    </label>
                  )}
                  <div className="task-modal-row">
                    <label className="modal-field">
                      Priority
                      <select
                        value={editTaskDraft.priority}
                        onChange={(event) => setEditTaskDraft((draft) => draft && { ...draft, priority: event.target.value as TaskPriority })}
                      >
                        {priorityOptions.map((priority) => (
                          <option key={priority} value={priority}>{priorityLabels[priority]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="modal-field">
                      Status
                      <select
                        value={editTaskDraft.status}
                        onChange={(event) => { setDueDateConfirmed(false); setEditTaskDraft((draft) => draft && { ...draft, status: event.target.value as TaskStatus }); }}
                      >
                        {statusConfig.map((status) => (
                          <option key={status.key} value={status.key}>{status.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="modal-field">
                      Due date
                      <input
                        type="date"
                        disabled={editTaskDraft.status === "todo" && !canEditTodoDueDate}
                        value={editTaskDraft.dueDate ?? ""}
                        onChange={(event) => setEditTaskDraft((draft) => draft && { ...draft, dueDate: event.target.value })}
                      />
                    </label>
                  </div>

                  {editTaskDraft.status === "todo" ? <p className="tasks-assignee-note">Only the assigner can change the To Do due date.</p> : null}
                  {editNeedsReview ? (
                    <div className="task-date-review">
                      <p className="task-date-review-title">Review the due date</p>
                      {!isTasksFirebaseConfigured || editAssignedToEmail === authUser?.email.toLowerCase() ? (
                        <label className="task-date-review-check">
                          <input type="checkbox" checked={dueDateConfirmed} onChange={(event) => setDueDateConfirmed(event.target.checked)} />
                          <span>I have reviewed and confirmed this due date.</span>
                        </label>
                      ) : <p className="task-date-review-note">The assignee will be prompted to confirm a due date.</p>}
                    </div>
                  ) : null}

                  <div className="record-modal-actions task-edit-actions">
                    {isTaskAdmin && isConfirmingDelete ? (
                      <>
                        <span className="tasks-delete-confirm-label">Delete this task?</span>
                        <button type="button" className="secondary-action-button" onClick={() => setIsConfirmingDelete(false)} disabled={isSavingTask}>
                          Cancel
                        </button>
                        <button type="button" className="danger-confirm-button" onClick={handleDeleteTask} disabled={isSavingTask}>
                          Confirm Delete
                        </button>
                      </>
                    ) : (
                      <>
                        {isTaskAdmin ? (
                          <button type="button" className="task-delete-action" onClick={() => setIsConfirmingDelete(true)} disabled={isSavingTask}>
                            Delete
                          </button>
                        ) : null}
                        <span className="task-actions-spacer" />
                        <button type="button" className="secondary-action-button" onClick={dismissEditTask} disabled={isSavingTask}>Cancel</button>
                        <button type="submit" className="primary-action-button" disabled={isSavingTask}>
                          {isSavingTask ? "Saving…" : "Save changes"}
                        </button>
                      </>
                    )}
                  </div>
                  {editConflict ? (
                    <div className="edit-conflict" role="alert">
                      <span>{editConflict}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const latest = Object.values(taskBoard).flat().find((task) => task.id === selectedTaskId);
                          if (latest) openEditTask(latest);
                        }}
                      >
                        Reload latest
                      </button>
                    </div>
                  ) : null}
                </form>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
