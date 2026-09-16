import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
import type { AppealHoldEntry, HoldStatus } from "../../types";

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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isAppealsHoldFirebaseConfigured) return;

    const unsubscribe = subscribeToAppealRecords(
      (nextEntries) => {
        setEntries(nextEntries);
        setIsLoading(false);
      },
      (error) => {
        console.error("Appeals hold sync failed:", error);
        setSyncMessage("Tracker unavailable. Check your connection.");
        setIsLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, []);

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
    if (!vetName || isSaving) return;

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
    setSelectedId(entry.id);
    setEditInitial({ ...entry });
    setEditDraft({ ...entry });
    setEditConflict("");
    setIsConfirmingDelete(false);
  }

  function dismissEditRecord() {
    setSelectedId(null);
    setEditInitial(null);
    setEditDraft(null);
    setEditConflict("");
    setIsConfirmingDelete(false);
  }

  async function submitEditRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !editInitial || !editDraft || isSaving) return;

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
    if (!selectedId || !editInitial || isSaving) return;

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
                        <td><span className={getHoldStatusBadgeClass(entry.holdStatus)}>{entry.holdStatus || "—"}</span></td>
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
                <button type="button" className="secondary-action-button" onClick={closeAddRecord} disabled={isSaving}>Cancel</button>
                <button type="submit" className="primary-action-button" disabled={isSaving}>{isSaving ? "Saving…" : "Add Row"}</button>
              </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editDraft ? (
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

              </div>
              <div className="appeals-hold-modal-footer">
              <div className="record-modal-actions task-edit-actions">
                {isConfirmingDelete ? (
                  <>
                    <span className="tasks-delete-confirm-label">Delete this row?</span>
                    <button type="button" className="secondary-action-button" onClick={() => setIsConfirmingDelete(false)} disabled={isSaving}>
                      Cancel
                    </button>
                    <button type="button" className="danger-confirm-button" onClick={handleDeleteRecord} disabled={isSaving}>
                      Confirm Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="task-delete-action" onClick={() => setIsConfirmingDelete(true)} disabled={isSaving}>
                      Delete
                    </button>
                    <span className="task-actions-spacer" />
                    <button type="button" className="secondary-action-button" onClick={dismissEditRecord} disabled={isSaving}>Cancel</button>
                    <button type="submit" className="primary-action-button" disabled={isSaving}>
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
    </main>
  );
}
