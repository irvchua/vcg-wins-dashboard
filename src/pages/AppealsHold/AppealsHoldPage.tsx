import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../../styles/shared.css";
import "../Tasks/TasksPage.css";
import "./AppealsHoldPage.css";
import { useAuthUser } from "../../components/authContext";
import { signOutUser } from "../../lib/firebase/auth";
import {
  createAppealRecord,
  deleteAppealRecord,
  isAppealsHoldFirebaseConfigured,
  RecordConflictError,
  saveAppealRecord,
  subscribeToAppealRecords,
} from "../../lib/firebase/appealsHold";
import {
  createTask,
  isTasksFirebaseConfigured,
  registerTaskMember,
  tasksBoardId,
  subscribeToTaskMembers,
  subscribeToTaskAdminStatus,
  type TaskMember,
} from "../../lib/firebase/tasks";
import {
  discardRejectedFollowUpRequest,
  followUpRequestKey,
  pendingFollowUpRequests,
} from "../../lib/firebase/taskRequests";
import type { AppealHoldEntry, HoldStatus, TaskEntry } from "../../types";

type AppealDraft = Omit<AppealHoldEntry, "id" | "position" | "updatedAt" | "updatedBy" | "version">;

type SortKey = "manual" | "vetName" | "holdStatus" | "instructionDate" | "updated";

const holdStatusOptions: HoldStatus[] = [
  "",
  "UNRESPONSIVE",
  "REINSTATED",
  "DONE",
  "ACTION NEEDED",
  "WAITING/REEVALUATION",
  "NOT INTERESTED",
];

const defaultDraft: AppealDraft = {
  vetName: "",
  holdStatus: "",
  reasonOnHold: "",
  instructionDate: "",
  decisionLetterLinkOrDate: "",
  notes: "",
  actionNeeded: "",
  notesOnHoldStatus: "",
};

function createRecordId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function createFollowUpTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function suggestedFollowUpDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getHoldStatusBadgeClass(status: HoldStatus): string {
  switch (status) {
    case "REINSTATED":
    case "DONE":
      return "appeals-hold-badge appeals-hold-badge-green";
    case "ACTION NEEDED":
      return "appeals-hold-badge appeals-hold-badge-yellow";
    case "UNRESPONSIVE":
      return "appeals-hold-badge appeals-hold-badge-red";
    case "WAITING/REEVALUATION":
      return "appeals-hold-badge appeals-hold-badge-blue";
    case "NOT INTERESTED":
      return "appeals-hold-badge appeals-hold-badge-sky";
    default:
      return "appeals-hold-badge appeals-hold-badge-empty";
  }
}

function formatRelativeUpdated(timestamp: string, now: Date): string {
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(timestamp).getTime()) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export default function AppealsHoldPage() {
  const authUser = useAuthUser();
  const [searchParams] = useSearchParams();
  const linkedRecordId = searchParams.get("record");
  const [signOutError, setSignOutError] = useState("");
  const [entries, setEntries] = useState<AppealHoldEntry[]>([]);
  const [isLoading, setIsLoading] = useState(isAppealsHoldFirebaseConfigured);
  const [syncMessage, setSyncMessage] = useState("");
  const [now, setNow] = useState(new Date());

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<HoldStatus | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("manual");

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<AppealDraft>(defaultDraft);
  const [addError, setAddError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<AppealHoldEntry | null>(null);
  const [editInitial, setEditInitial] = useState<AppealHoldEntry | null>(null);
  const [editConflict, setEditConflict] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);

  const [isTaskAdmin, setIsTaskAdmin] = useState(false);
  const [isTaskAdminLoading, setIsTaskAdminLoading] = useState(true);
  const [memberDirectoryError, setMemberDirectoryError] = useState("");
  const [isFollowUpLocked, setIsFollowUpLocked] = useState(false);
  const [adminTaskMembers, setTaskMembers] = useState<TaskMember[]>([]);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [followUpAssigneeEmail, setFollowUpAssigneeEmail] = useState("");
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [followUpDueDate, setFollowUpDueDate] = useState("");
  const [followUpError, setFollowUpError] = useState("");
  const [isCreatingFollowUp, setIsCreatingFollowUp] = useState(false);
  const [followUpCreated, setFollowUpCreated] = useState<{ assignedTo: string; dueDate: string } | null>(null);
  const isPageMounted = useRef(false);

  useEffect(() => {
    isPageMounted.current = true;
    return () => { isPageMounted.current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser) return;
    registerTaskMember(authUser).catch((error) => {
      console.error("Task member registration failed:", error);
    });
  }, [authUser]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser) return;
    return subscribeToTaskAdminStatus(authUser.email, (isAdmin) => {
      setIsTaskAdmin(isAdmin);
      if (!isAdmin) setIsFollowUpOpen(false);
      setIsTaskAdminLoading(false);
    }, () => {
      setIsTaskAdmin(false);
      setIsFollowUpOpen(false);
      setIsTaskAdminLoading(false);
    }) ?? undefined;
  }, [authUser]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser || isTaskAdminLoading) return;
    if (!isTaskAdmin) return;
    const unsubscribe = subscribeToTaskMembers(
      (members) => {
        setTaskMembers(members);
        setMemberDirectoryError("");
      },
      () => {
        setTaskMembers([]);
        setMemberDirectoryError("The assignee directory is unavailable. Check your connection.");
      }
    );
    return () => unsubscribe?.();
  }, [authUser, isTaskAdmin, isTaskAdminLoading]);

  // Only task administrators can create follow-up tasks (see the gate around the
  // "Create Follow-up Task" button below), so the assignee directory never needs the
  // self-only fallback a non-admin task creator would otherwise get.
  const taskMembers = adminTaskMembers;
  const canCreateFollowUp = isTasksFirebaseConfigured && !isTaskAdminLoading && isTaskAdmin;

  const hasUnsavedRowChanges = Boolean(editDraft && editInitial &&
    (Object.keys(defaultDraft) as Array<keyof AppealDraft>)
      .some((field) => (editDraft[field] ?? "") !== (editInitial[field] ?? "")));

  useEffect(() => {
    if (!isAppealsHoldFirebaseConfigured) return;

    let openedLinkedRecord = false;
    const unsubscribe = subscribeToAppealRecords(
      (nextEntries) => {
        setEntries(nextEntries);
        setIsLoading(false);
        if (linkedRecordId && !openedLinkedRecord) {
          const linkedEntry = nextEntries.find((entry) => String(entry.id) === linkedRecordId);
          if (linkedEntry) {
            openedLinkedRecord = true;
            setSelectedId(linkedEntry.id);
            setEditInitial({ ...linkedEntry });
            setEditDraft({ ...linkedEntry });
            setEditConflict("");
            setIsConfirmingDelete(false);
            setIsFollowUpOpen(false);
            setFollowUpCreated(null);
            setIsFollowUpLocked(pendingFollowUpRequests.has(followUpRequestKey(tasksBoardId, authUser?.id, linkedEntry.id)));
          } else {
            setSyncMessage("The linked appeal was not found. It may have been deleted.");
          }
        }
      },
      (error) => {
        console.error("Appeals hold sync failed:", error);
        setSyncMessage("Tracker unavailable. Check your connection.");
        setIsLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [linkedRecordId, authUser?.id]);

  const updaterName = authUser?.name.trim() || "Local user";

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (statusFilter !== "all" && entry.holdStatus !== statusFilter) return false;
      if (!normalizedSearchQuery) return true;
      return [
        entry.vetName,
        entry.holdStatus,
        entry.reasonOnHold,
        entry.instructionDate,
        entry.decisionLetterLinkOrDate,
        entry.notes,
        entry.actionNeeded,
        entry.notesOnHoldStatus,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedSearchQuery));
    });
  }, [entries, normalizedSearchQuery, statusFilter]);

  const displayedEntries = useMemo(() => {
    if (sortBy === "manual") return filteredEntries;

    const valueFor = (entry: AppealHoldEntry) => {
      if (sortBy === "vetName") return entry.vetName;
      if (sortBy === "holdStatus") return entry.holdStatus;
      if (sortBy === "instructionDate") return entry.instructionDate;
      return entry.updatedAt ?? "";
    };

    return [...filteredEntries].sort((a, b) =>
      sortBy === "updated" ? valueFor(b).localeCompare(valueFor(a)) : valueFor(a).localeCompare(valueFor(b))
    );
  }, [filteredEntries, sortBy]);

  function handleSignOut() {
    setSignOutError("");
    signOutUser().catch((error) => {
      console.error("Sign-out failed:", error);
      setSignOutError("Sign-out failed. Please try again.");
    });
  }

  function openAddRecord() {
    setAddDraft(defaultDraft);
    setAddError("");
    setIsAddOpen(true);
  }

  function closeAddRecord() {
    setIsAddOpen(false);
    setAddDraft(defaultDraft);
    setAddError("");
  }

  async function submitAddRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vetName = addDraft.vetName.trim();
    if (!vetName || isSaving || isCreatingFollowUp) return;

    const newEntry: AppealHoldEntry = {
      ...addDraft,
      id: createRecordId(),
      vetName,
      position: entries.length,
    };

    setIsSaving(true);
    setAddError("");
    try {
      const saved = await createAppealRecord(newEntry, updaterName);
      setEntries((current) => [...current, saved]);
      closeAddRecord();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Row could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  function openEditRecord(entry: AppealHoldEntry) {
    setIsFollowUpLocked(pendingFollowUpRequests.has(followUpRequestKey(tasksBoardId, authUser?.id, entry.id)));
    setSelectedId(entry.id);
    setEditInitial({ ...entry });
    setEditDraft({ ...entry });
    setEditConflict("");
    setIsConfirmingDelete(false);
    setIsFollowUpOpen(false);
    setFollowUpAssigneeEmail("");
    setFollowUpDueDate("");
    setFollowUpError("");
    setFollowUpCreated(null);
  }

  function dismissEditRecord() {
    if (isCreatingFollowUp) return;
    setSelectedId(null);
    setEditInitial(null);
    setEditDraft(null);
    setEditConflict("");
    setIsConfirmingDelete(false);
    setIsFollowUpOpen(false);
    setFollowUpAssigneeEmail("");
    setFollowUpDueDate("");
    setFollowUpError("");
    setFollowUpCreated(null);
  }

  function openFollowUpTask() {
    if (!editInitial || !canCreateFollowUp) return;
    const pending = pendingFollowUpRequests.get(followUpRequestKey(tasksBoardId, authUser?.id, editInitial.id));
    setIsFollowUpLocked(Boolean(pending));
    setFollowUpTitle(pending ? pending.task.title : editInitial.vetName);
    setFollowUpNotes(pending ? (pending.task.description ?? "").split("\n").slice(1).join("\n") : editInitial.notes ?? "");
    setFollowUpAssigneeEmail(pending ? pending.task.assignedToEmail : "");
    setFollowUpDueDate(pending ? pending.task.dueDate ?? "" : suggestedFollowUpDueDate());
    setFollowUpError("");
    setIsFollowUpOpen(true);
  }

  function closeFollowUpTask() {
    if (!isCreatingFollowUp) setIsFollowUpOpen(false);
  }

  async function submitFollowUpTask() {
    if (!editInitial || !canCreateFollowUp || isCreatingFollowUp || isSaving) return;
    const requestKey = followUpRequestKey(tasksBoardId, authUser?.id, editInitial.id);
    const pending = pendingFollowUpRequests.get(requestKey);
    if (hasUnsavedRowChanges && !pending) {
      setFollowUpError("Save your row changes before creating a follow-up task.");
      return;
    }

    const member = taskMembers.find((candidate) => candidate.email === followUpAssigneeEmail);
    if (!pending && (!member || !followUpDueDate || !followUpTitle.trim())) {
      setFollowUpError("Enter a title and choose an assignee and due date.");
      return;
    }

    const entry = editInitial;
    const newTask: TaskEntry = pending?.task ?? {
      id: createFollowUpTaskId(),
      title: followUpTitle.trim(),
      description: `${window.location.origin}/appeals-hold?record=${entry.id}\n${followUpNotes.trim()}`.trimEnd(),
      assignedTo: member!.name || member!.email,
      assignedToEmail: member!.email,
      assignedByEmail: authUser?.email.toLowerCase() || "local@example.com",
      priority: "medium",
      status: "todo",
      dueDate: followUpDueDate,
      createdBy: updaterName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: updaterName,
      version: 1,
    };

    const requestId = pending?.requestId ?? createFollowUpTaskId();
    pendingFollowUpRequests.set(requestKey, { task: newTask, requestId });
    setIsFollowUpLocked(true);
    setIsCreatingFollowUp(true);
    setFollowUpError("");
    try {
      await createTask(newTask, updaterName, requestId);
      // If the user navigated away, keep the request until a mounted page can
      // acknowledge success. A retry then retrieves the same saved task.
      if (!isPageMounted.current) return;
      pendingFollowUpRequests.delete(requestKey);
      setFollowUpCreated({ assignedTo: newTask.assignedTo, dueDate: newTask.dueDate ?? "" });
      setIsFollowUpOpen(false);
    } catch (error) {
      if (discardRejectedFollowUpRequest(requestKey, error)) setIsFollowUpLocked(false);
      setFollowUpError(error instanceof Error ? error.message : "Task could not be created.");
    } finally {
      if (isPageMounted.current) setIsCreatingFollowUp(false);
    }
  }

  async function submitEditRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !editInitial || !editDraft || isSaving || isCreatingFollowUp) return;

    const vetName = editDraft.vetName.trim();
    if (!vetName) {
      setEditConflict("Enter a veteran name before saving.");
      return;
    }

    const hasChanges = (Object.keys(defaultDraft) as Array<keyof AppealDraft>)
      .some((field) => (editDraft[field] ?? "") !== (editInitial[field] ?? ""));
    if (!hasChanges) {
      dismissEditRecord();
      return;
    }

    setIsSaving(true);
    setEditConflict("");
    try {
      const saved = await saveAppealRecord({ ...editDraft, vetName }, editInitial.version ?? 1, updaterName);
      setEntries((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)));
      dismissEditRecord();
    } catch (error) {
      if (error instanceof RecordConflictError) {
        setEditConflict("Another editor changed this row. Reload the latest version before trying again.");
      } else {
        console.error("Appeals hold save failed:", error);
        setEditConflict("This row could not be saved. Check your connection and try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRecord() {
    if (!selectedId || !editInitial || isSaving || isCreatingFollowUp) return;

    setIsSaving(true);
    try {
      await deleteAppealRecord(selectedId, editInitial.version ?? 1);
      setEntries((current) => current.filter((entry) => entry.id !== selectedId));
      dismissEditRecord();
    } catch (error) {
      if (error instanceof RecordConflictError) {
        setEditConflict("Another editor changed this row. Reload the latest version before trying again.");
      } else {
        console.error("Appeals hold delete failed:", error);
        setEditConflict("This row could not be deleted. Check your connection and try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleQuickStatusChange(entry: AppealHoldEntry, nextStatus: HoldStatus) {
    if (nextStatus === entry.holdStatus || savingStatusId !== null) return;

    setSavingStatusId(entry.id);
    setSyncMessage("");
    try {
      const saved = await saveAppealRecord({ ...entry, holdStatus: nextStatus }, entry.version ?? 1, updaterName);
      setEntries((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      if (error instanceof RecordConflictError) {
        setSyncMessage("Another editor changed this row. Reload the page to see the latest version.");
      } else {
        console.error("Quick status update failed:", error);
        setSyncMessage("Status update failed. Check your connection and try again.");
      }
    } finally {
      setSavingStatusId(null);
    }
  }

  return (
    <main className="tasks-shell appeals-hold-shell">
      <div className="tasks-top-bar">
        <Link to="/" className="tasks-back-link">
          ← Dashboard
        </Link>
        {authUser ? (
          <div className="tasks-account">
            <span>{authUser.name}</span>
            <button className="nav-button" onClick={handleSignOut}>Sign Out</button>
          </div>
        ) : null}
      </div>

      <h1>Appeals On Hold Status</h1>

      {!isAppealsHoldFirebaseConfigured ? (
        <p className="tasks-config-warning">
          This tracker is not configured for this environment (missing VITE_FIREBASE_APPEALS_HOLD_BOARD_ID). Changes here will not be saved.
        </p>
      ) : null}

      {signOutError ? <p className="tasks-auth-error" role="alert">{signOutError}</p> : null}

      <>
          <div className="tasks-filter-bar">
            <input
              type="search"
              placeholder="Search name, status, notes…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as HoldStatus | "all")}>
              <option value="all">All statuses</option>
              {holdStatusOptions.filter(Boolean).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
              <option value="manual">Sort: Manual</option>
              <option value="vetName">Sort: Name</option>
              <option value="holdStatus">Sort: Status</option>
              <option value="instructionDate">Sort: Instruction date</option>
              <option value="updated">Sort: Last updated</option>
            </select>
            <button className="primary-action-button" onClick={openAddRecord}>+ Add Row</button>
          </div>

          {syncMessage ? <p className="tasks-sync-message" role="alert">{syncMessage}</p> : null}

          {isLoading ? (
            <p className="tasks-loading">Loading tracker…</p>
          ) : (
            <div className="appeals-hold-table-wrapper">
              <table className="appeals-hold-table">
                <thead>
                  <tr>
                    <th>Vet Name</th>
                    <th>On Hold Status</th>
                    <th>Reason On Hold</th>
                    <th>Instruction Date</th>
                    <th>Decision Letter Link/Date</th>
                    <th>Notes</th>
                    <th>Action Needed</th>
                    <th>Notes On Hold Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedEntries.length ? (
                    displayedEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="appeals-hold-row-editable"
                        onClick={() => openEditRecord(entry)}
                      >
                        <td>{entry.vetName}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <select
                            className={`appeals-hold-status-select ${getHoldStatusBadgeClass(entry.holdStatus)}`}
                            value={entry.holdStatus}
                            disabled={savingStatusId === entry.id}
                            aria-label={`On hold status for ${entry.vetName}`}
                            onChange={(event) => handleQuickStatusChange(entry, event.target.value as HoldStatus)}
                          >
                            {holdStatusOptions.map((status) => (
                              <option key={status || "none"} value={status}>{status || "—"}</option>
                            ))}
                          </select>
                        </td>
                        <td>{entry.reasonOnHold || "—"}</td>
                        <td>{entry.instructionDate || "—"}</td>
                        <td>{entry.decisionLetterLinkOrDate || "—"}</td>
                        <td>{entry.notes || "—"}</td>
                        <td>{entry.actionNeeded || "—"}</td>
                        <td>{entry.notesOnHoldStatus || "—"}</td>
                        <td>{entry.updatedAt ? formatRelativeUpdated(entry.updatedAt, now) : "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="appeals-hold-table-empty">
                        {normalizedSearchQuery || statusFilter !== "all" ? "No matching rows" : "No rows yet"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
      </>

      {isAddOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!isSaving) closeAddRecord(); }}>
          <div className="task-modal appeals-hold-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Add Row</h2>
            <form onSubmit={submitAddRecord}>
              <div className="appeals-hold-modal-body" role="region" aria-label="Row details" tabIndex={0}>
              <div className="task-modal-row">
                <label className="modal-field">
                  Vet Name
                  <input
                    value={addDraft.vetName}
                    onChange={(event) => setAddDraft((draft) => ({ ...draft, vetName: event.target.value }))}
                    required
                    autoFocus
                  />
                </label>
                <label className="modal-field">
                  On Hold Status
                  <select
                    value={addDraft.holdStatus}
                    onChange={(event) => setAddDraft((draft) => ({ ...draft, holdStatus: event.target.value as HoldStatus }))}
                  >
                    {holdStatusOptions.map((status) => (
                      <option key={status || "none"} value={status}>{status || "—"}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="task-modal-row">
                <label className="modal-field">
                  Instruction Date
                  <input
                    value={addDraft.instructionDate}
                    onChange={(event) => setAddDraft((draft) => ({ ...draft, instructionDate: event.target.value }))}
                  />
                </label>
                <label className="modal-field">
                  Decision Letter Link/Date
                  <input
                    value={addDraft.decisionLetterLinkOrDate}
                    onChange={(event) => setAddDraft((draft) => ({ ...draft, decisionLetterLinkOrDate: event.target.value }))}
                  />
                </label>
              </div>
              <label className="modal-field">
                Reason On Hold
                <textarea
                  value={addDraft.reasonOnHold}
                  onChange={(event) => setAddDraft((draft) => ({ ...draft, reasonOnHold: event.target.value }))}
                />
              </label>
              <label className="modal-field">
                Notes
                <textarea
                  value={addDraft.notes}
                  onChange={(event) => setAddDraft((draft) => ({ ...draft, notes: event.target.value }))}
                />
              </label>
              <label className="modal-field">
                Action Needed
                <textarea
                  value={addDraft.actionNeeded}
                  onChange={(event) => setAddDraft((draft) => ({ ...draft, actionNeeded: event.target.value }))}
                />
              </label>
              <label className="modal-field">
                Notes On Hold Status
                <textarea
                  value={addDraft.notesOnHoldStatus}
                  onChange={(event) => setAddDraft((draft) => ({ ...draft, notesOnHoldStatus: event.target.value }))}
                />
              </label>
              </div>
              <div className="appeals-hold-modal-footer">
              {addError ? <p className="tasks-sync-message" role="alert">{addError}</p> : null}
              <div className="record-modal-actions">
                <button type="button" className="secondary-action-button" onClick={closeAddRecord} disabled={isSaving || isCreatingFollowUp}>Cancel</button>
                <button type="submit" className="primary-action-button" disabled={isSaving || isCreatingFollowUp}>{isSaving ? "Saving…" : "Add Row"}</button>
              </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editDraft && !isFollowUpOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={dismissEditRecord}>
          <div className="task-modal appeals-hold-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Edit Row</h2>
            <form onSubmit={submitEditRecord}>
              <div className="appeals-hold-modal-body" role="region" aria-label="Row details" tabIndex={0}>
              <div className="task-modal-row">
                <label className="modal-field">
                  Vet Name
                  <input
                    value={editDraft.vetName}
                    onChange={(event) => setEditDraft((draft) => draft && { ...draft, vetName: event.target.value })}
                    required
                  />
                </label>
                <label className="modal-field">
                  On Hold Status
                  <select
                    value={editDraft.holdStatus}
                    onChange={(event) => setEditDraft((draft) => draft && { ...draft, holdStatus: event.target.value as HoldStatus })}
                  >
                    {holdStatusOptions.map((status) => (
                      <option key={status || "none"} value={status}>{status || "—"}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="task-modal-row">
                <label className="modal-field">
                  Instruction Date
                  <input
                    value={editDraft.instructionDate}
                    onChange={(event) => setEditDraft((draft) => draft && { ...draft, instructionDate: event.target.value })}
                  />
                </label>
                <label className="modal-field">
                  Decision Letter Link/Date
                  <input
                    value={editDraft.decisionLetterLinkOrDate}
                    onChange={(event) => setEditDraft((draft) => draft && { ...draft, decisionLetterLinkOrDate: event.target.value })}
                  />
                </label>
              </div>
              <label className="modal-field">
                Reason On Hold
                <textarea
                  value={editDraft.reasonOnHold}
                  onChange={(event) => setEditDraft((draft) => draft && { ...draft, reasonOnHold: event.target.value })}
                />
              </label>
              <label className="modal-field">
                Notes
                <textarea
                  value={editDraft.notes}
                  onChange={(event) => setEditDraft((draft) => draft && { ...draft, notes: event.target.value })}
                />
              </label>
              <label className="modal-field">
                Action Needed
                <textarea
                  value={editDraft.actionNeeded}
                  onChange={(event) => setEditDraft((draft) => draft && { ...draft, actionNeeded: event.target.value })}
                />
              </label>
              <label className="modal-field">
                Notes On Hold Status
                <textarea
                  value={editDraft.notesOnHoldStatus}
                  onChange={(event) => setEditDraft((draft) => draft && { ...draft, notesOnHoldStatus: event.target.value })}
                />
              </label>

              {canCreateFollowUp ? (
                <div className="appeals-hold-followup">
                  {hasUnsavedRowChanges ? <p role="alert">Save your row changes before creating a follow-up task.</p> : null}
                  {memberDirectoryError ? <p role="alert">{memberDirectoryError}</p> : null}
                  {followUpCreated ? (
                    <p className="appeals-hold-followup-success">
                      Follow-up task created for {followUpCreated.assignedTo}, due {followUpCreated.dueDate}. <Link to="/tasks">Open Tasks</Link>
                    </p>
                  ) : (
                    <button type="button" className="secondary-action-button" onClick={openFollowUpTask} disabled={isSaving || (hasUnsavedRowChanges && !isFollowUpLocked)}>
                      Create Follow-up Task
                    </button>
                  )}
                </div>
              ) : null}

              </div>
              <div className="appeals-hold-modal-footer">
              <div className="record-modal-actions task-edit-actions">
                {isConfirmingDelete ? (
                  <>
                    <span className="tasks-delete-confirm-label">Delete this row?</span>
                    <button type="button" className="secondary-action-button" onClick={() => setIsConfirmingDelete(false)} disabled={isSaving || isCreatingFollowUp}>
                      Cancel
                    </button>
                    <button type="button" className="danger-confirm-button" onClick={handleDeleteRecord} disabled={isSaving || isCreatingFollowUp}>
                      Confirm Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="task-delete-action" onClick={() => setIsConfirmingDelete(true)} disabled={isSaving || isCreatingFollowUp}>
                      Delete
                    </button>
                    <span className="task-actions-spacer" />
                    <button type="button" className="secondary-action-button" onClick={dismissEditRecord} disabled={isSaving || isCreatingFollowUp}>Cancel</button>
                    <button type="submit" className="primary-action-button" disabled={isSaving || isCreatingFollowUp}>
                      {isSaving ? "Saving…" : "Save changes"}
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
                      const latest = entries.find((entry) => entry.id === selectedId);
                      if (latest) openEditRecord(latest);
                    }}
                  >
                    Reload latest
                  </button>
                </div>
              ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {isFollowUpOpen && editInitial && canCreateFollowUp ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeFollowUpTask}>
          <div className="task-modal appeals-hold-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
            if (event.key === "Escape") closeFollowUpTask();
          }}>
            <h2 id="follow-up-title">Create Follow-up Task</h2>
            <form onSubmit={(event) => {
              event.preventDefault();
              void submitFollowUpTask();
            }}>
              <div className="appeals-hold-modal-body">
                <label className="modal-field">
                  Title
                  <input autoFocus required maxLength={300} value={followUpTitle} disabled={isFollowUpLocked} onChange={(event) => setFollowUpTitle(event.target.value)} />
                </label>
                <label className="modal-field">
                  Notes
                  <textarea rows={5} value={followUpNotes} disabled={isFollowUpLocked} onChange={(event) => setFollowUpNotes(event.target.value)} />
                </label>
                {memberDirectoryError ? <p role="alert">{memberDirectoryError}</p> : null}
                {isFollowUpLocked ? <p>Retrying will use the original task details.</p> : null}
                      <div className="task-modal-row">
                        <label className="modal-field">
                          Assign follow-up to
                          <select
                            disabled={isFollowUpLocked || !isTaskAdmin}
                            value={followUpAssigneeEmail}
                            onChange={(event) => setFollowUpAssigneeEmail(event.target.value)}
                          >
                            <option value="">Select a user</option>
                            {taskMembers.map((member) => (
                              <option key={member.id} value={member.email}>
                                {member.name ? `${member.name} (${member.email})` : member.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="modal-field">
                          Due date
                          <input
                            type="date"
                            disabled={isFollowUpLocked}
                            value={followUpDueDate}
                            onChange={(event) => setFollowUpDueDate(event.target.value)}
                          />
                        </label>
                      </div>
                      {followUpError ? <p className="tasks-sync-message" role="alert">{followUpError}</p> : null}
                      <div className="record-modal-actions">
                        <button type="button" className="secondary-action-button" onClick={closeFollowUpTask} disabled={isCreatingFollowUp}>
                          Cancel
                        </button>
                        <button type="submit" className="primary-action-button" disabled={isCreatingFollowUp || isSaving || isTaskAdminLoading || (hasUnsavedRowChanges && !isFollowUpLocked)}>
                          {isCreatingFollowUp ? "Creating…" : isFollowUpLocked ? "Retry Create Task" : "Create Task"}
                        </button>
                      </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
