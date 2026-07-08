import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  canUserEdit,
  type AuthUser,
  isFirebaseConfigured,
  saveBoardData,
  shouldSeedMissingFirebaseBoard,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  subscribeToBoard,
} from "./firebase";
import type { ArchivedEntry, BoardEntry, BoardState, StageKey, StatusLabel } from "./types";

type StageConfigItem = {
  key: StageKey;
  title: string;
  metaTitle: string;
};

type AddRecordDraft = {
  adminInCharge: string;
  name: string;
  notes: string;
  stage: StageKey;
  status: StatusLabel;
};

const STORAGE_KEY = "vcg-wins-board-data";
const ARCHIVED_STORAGE_KEY = "vcg-wins-board-archive";
const WINS_STORAGE_KEY = "vcg-total-wins";
const NOTE_MAX_LENGTH = 80;

const emptyBoard: BoardState = {
  appeals: [],
  claims526: [],
  reviewSignature: [],
  faxing: [],
  faxed: [],
};

const stageConfig: StageConfigItem[] = [
  { key: "appeals", title: "APPEALS", metaTitle: "STATUS" },
  { key: "claims526", title: "526EZ/CLAIMS", metaTitle: "STATUS" },
  { key: "reviewSignature", title: "FOR REVIEW AND SIGNATURE", metaTitle: "PROCESS" },
  { key: "faxing", title: "FOR FAXING", metaTitle: "PROCESS" },
  { key: "faxed", title: "FAXED", metaTitle: "PROCESS" },
];

const statusOptions: StatusLabel[] = ["", "ON PROCESS", "FOR CHECKING", "APPEALS", "CLAIMS"];

const defaultAddRecordDraft: AddRecordDraft = {
  adminInCharge: "",
  name: "",
  notes: "",
  stage: "appeals",
  status: "",
};

const initialBoard: BoardState = {
  appeals: [
    { id: 1, name: "Alan Cain", assignedTo: "", adminInCharge: "", status: "" },
    { id: 2, name: "Reginald Mccoy", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 3, name: "Derek Kelly", assignedTo: "", adminInCharge: "", status: "" },
    { id: 4, name: "Christopher Cheramie", assignedTo: "", adminInCharge: "", status: "" },
    { id: 5, name: "Suphakit Areeyat", assignedTo: "", adminInCharge: "", status: "" },
    { id: 6, name: "Lavalle Jenkins", assignedTo: "", adminInCharge: "", status: "" },
    { id: 7, name: "Gavriel Hudson", assignedTo: "", adminInCharge: "", status: "" },
    { id: 8, name: "Mercedes Pratt", assignedTo: "", adminInCharge: "", status: "" },
    { id: 9, name: "Thomas Dezell", assignedTo: "", adminInCharge: "", status: "" },
  ],
  claims526: [
    { id: 10, name: "Douglas Kramer", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 11, name: "Aurelio Cuervo", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 12, name: "Gary Watson", assignedTo: "", adminInCharge: "", status: "FOR CHECKING" },
    { id: 13, name: "Freddie Gonzales", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 14, name: "Juan Ocampo", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 15, name: "Elvis Thien", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 16, name: "Michael Johnson", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 17, name: "Jeffrey Mota", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 18, name: "Dennis Robinson", assignedTo: "", adminInCharge: "", status: "" },
    { id: 19, name: "Jamar Harrison", assignedTo: "", adminInCharge: "", status: "" },
    { id: 20, name: "Rey Thompson", assignedTo: "", adminInCharge: "", status: "" },
  ],
  reviewSignature: [
    { id: 21, name: "Wilson Warner", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 22, name: "Shing-Chit Chuang", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 23, name: "Isaac Contreras", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 24, name: "Quinn Lacey", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 25, name: "Anthony Davis", assignedTo: "", adminInCharge: "", status: "APPEALS" },
  ],
  faxing: [{ id: 26, name: "Issiah Johnson", assignedTo: "", adminInCharge: "", status: "CLAIMS" }],
  faxed: [
    { id: 27, name: "Louis Collins", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 28, name: "Jason Moore", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 29, name: "Dennis Robinson", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 30, name: "Anthony Hale", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 31, name: "Antiuwan Jones", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 32, name: "Philip Edgar", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 33, name: "Tristian Blaney", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 34, name: "Brandon Black", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 35, name: "Keith Genereux", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 36, name: "Dake Hamilton", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 37, name: "Eddian Edwards", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 38, name: "Irving Scales Sr.", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 39, name: "Elijah Stroh", assignedTo: "", adminInCharge: "", status: "" },
  ],
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getTotalEntries(board: BoardState): number {
  return Object.values(board).reduce((sum, group) => sum + group.length, 0);
}

function getNextId(board: BoardState): number {
  const ids = Object.values(board).flat().map((entry) => entry.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function archiveEntriesFromStage(entries: BoardEntry[], stage: StageKey): ArchivedEntry[] {
  const archivedAt = new Date().toISOString();

  return entries.map((entry) => ({
    ...entry,
    archivedAt,
    archivedFrom: stage,
  }));
}

function getBadgeClass(status: StatusLabel): string {
  switch (status) {
    case "ON PROCESS":
      return "badge badge-green";
    case "FOR CHECKING":
      return "badge badge-yellow";
    case "APPEALS":
      return "badge badge-blue";
    case "CLAIMS":
      return "badge badge-sky";
    default:
      return "badge badge-empty";
  }
}

function normalizeBoard(board: BoardState): BoardState {
  const normalizeEntry = (entry: Partial<BoardEntry>): BoardEntry => ({
    ...entry,
    id: entry.id ?? 0,
    name: entry.name ?? "",
    assignedTo: "",
    adminInCharge: entry.adminInCharge ?? entry.assignedTo ?? "",
    status: entry.status ?? "",
    notes: (entry.notes ?? "").slice(0, NOTE_MAX_LENGTH),
  });

  return {
    appeals: board.appeals.map(normalizeEntry),
    claims526: board.claims526.map(normalizeEntry),
    reviewSignature: board.reviewSignature.map(normalizeEntry),
    faxing: board.faxing.map(normalizeEntry),
    faxed: board.faxed.map(normalizeEntry),
  };
}

function normalizeArchivedEntries(entries: Partial<ArchivedEntry>[] = []): ArchivedEntry[] {
  return entries.map((entry) => ({
    ...entry,
    archivedAt: entry.archivedAt ?? new Date().toISOString(),
    archivedFrom: entry.archivedFrom ?? "appeals",
    id: entry.id ?? 0,
    name: entry.name ?? "",
    assignedTo: "",
    adminInCharge: entry.adminInCharge ?? entry.assignedTo ?? "",
    status: entry.status ?? "",
    notes: (entry.notes ?? "").slice(0, NOTE_MAX_LENGTH),
  }));
}

function loadInitialBoard(): BoardState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeBoard(JSON.parse(saved)) : initialBoard;
  } catch {
    return initialBoard;
  }
}

function loadInitialArchivedEntries(): ArchivedEntry[] {
  try {
    const saved = localStorage.getItem(ARCHIVED_STORAGE_KEY);
    return saved ? normalizeArchivedEntries(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

function loadInitialWins(): number {
  const savedWins = localStorage.getItem(WINS_STORAGE_KEY);
  return savedWins ? Number(savedWins) : 104;
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [addRecordDraft, setAddRecordDraft] = useState<AddRecordDraft>(defaultAddRecordDraft);
  const [archivedEntries, setArchivedEntries] = useState<ArchivedEntry[]>(loadInitialArchivedEntries);
  const [board, setBoard] = useState<BoardState>(loadInitialBoard);
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [wins, setWins] = useState<number>(loadInitialWins);
  const [page, setPage] = useState<"tv" | "admin">("tv");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isFirebaseConfigured);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured ? "Connecting to Firebase..." : "Local backup only"
  );
  const hasRemoteLoaded = useRef(!isFirebaseConfigured);
  const lastRemotePayload = useRef("");
  const pendingLocalPayload = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const unsubscribe = subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthLoading(false);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    const unsubscribe = subscribeToBoard(
      (remoteData) => {
        hasRemoteLoaded.current = true;

        if (!remoteData) {
          const localArchivedEntries = loadInitialArchivedEntries();
          const localBoard = loadInitialBoard();
          const localWins = loadInitialWins();
          const localPayload = JSON.stringify({
            archivedEntries: localArchivedEntries,
            board: localBoard,
            wins: localWins,
          });

          if (!shouldSeedMissingFirebaseBoard) {
            lastRemotePayload.current = localPayload;
            setSyncStatus("Firebase board not found. Saving locally.");
            return;
          }

          lastRemotePayload.current = localPayload;
          saveBoardData(localBoard, localWins, localArchivedEntries)
            .then(() => setSyncStatus("Synced with Firebase"))
            .catch(() => setSyncStatus("Firebase unavailable. Saving locally."));
          return;
        }

        const nextArchivedEntries = normalizeArchivedEntries(remoteData.archivedEntries);
        const nextBoard = normalizeBoard(remoteData.board);
        const nextWins = Number.isFinite(remoteData.wins) ? remoteData.wins : 104;
        const remotePayload = JSON.stringify({
          archivedEntries: nextArchivedEntries,
          board: nextBoard,
          wins: nextWins,
        });

        if (pendingLocalPayload.current && remotePayload !== pendingLocalPayload.current) {
          return;
        }

        if (remotePayload === pendingLocalPayload.current) {
          pendingLocalPayload.current = "";
        }

        lastRemotePayload.current = remotePayload;
        setArchivedEntries(nextArchivedEntries);
        setBoard(nextBoard);
        setWins(nextWins);
        setSyncStatus("Synced with Firebase");
      },
      (error) => {
        console.error("Firebase sync failed:", error);
        hasRemoteLoaded.current = true;
        setSyncStatus("Firebase unavailable. Saving locally.");
      }
    );

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board]);

  useEffect(() => {
    localStorage.setItem(ARCHIVED_STORAGE_KEY, JSON.stringify(archivedEntries));
  }, [archivedEntries]);

  useEffect(() => {
    localStorage.setItem(WINS_STORAGE_KEY, String(wins));
  }, [wins]);

  useEffect(() => {
    if (!isFirebaseConfigured || !hasRemoteLoaded.current || !canUserEdit(authUser)) return;

    const payload = JSON.stringify({ archivedEntries, board, wins });
    if (payload === lastRemotePayload.current) return;

    pendingLocalPayload.current = payload;
    setSyncStatus("Saving to Firebase...");
    const saveTimer = window.setTimeout(() => {
      saveBoardData(board, wins, archivedEntries)
        .then(() => {
          if (pendingLocalPayload.current !== payload) return;

          lastRemotePayload.current = payload;
          pendingLocalPayload.current = "";
          setSyncStatus("Synced with Firebase");
        })
        .catch((error) => {
          console.error("Firebase save failed:", error);
          setSyncStatus("Firebase unavailable. Saving locally.");
        });
    }, 350);

    return () => window.clearTimeout(saveTimer);
  }, [archivedEntries, authUser, board, wins]);

  const totalEntries = useMemo(() => getTotalEntries(board), [board]);
  const canEditBoard = canUserEdit(authUser);
  const showAuthGate = isFirebaseConfigured && (!authUser || !canEditBoard);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredBoard = useMemo(() => {
    if (!normalizedSearchQuery) return board;

    const matchesQuery = (entry: BoardEntry) =>
      [entry.name, entry.adminInCharge, entry.status, entry.notes]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearchQuery));

    return {
      appeals: board.appeals.filter(matchesQuery),
      claims526: board.claims526.filter(matchesQuery),
      reviewSignature: board.reviewSignature.filter(matchesQuery),
      faxing: board.faxing.filter(matchesQuery),
      faxed: board.faxed.filter(matchesQuery),
    };
  }, [board, normalizedSearchQuery]);
  const filteredEntriesCount = getTotalEntries(filteredBoard);
  const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" }).format(now);
  const dayNumber = now.getDate();

  function openAddRecord(stage: StageKey) {
    setAddRecordDraft({ ...defaultAddRecordDraft, stage });
    setIsAddRecordOpen(true);
  }

  function closeAddRecord() {
    setIsAddRecordOpen(false);
    setAddRecordDraft(defaultAddRecordDraft);
  }

  function submitAddRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = addRecordDraft.name.trim();
    if (!name) return;

    setBoard((current) => ({
      ...current,
      [addRecordDraft.stage]: [
        ...current[addRecordDraft.stage],
        {
          id: getNextId(current),
          name,
          assignedTo: "",
          adminInCharge: addRecordDraft.adminInCharge.trim(),
          status: addRecordDraft.status,
          notes: addRecordDraft.notes.trim(),
        },
      ],
    }));

    closeAddRecord();
  }

  function updateEntry(stage: StageKey, id: number, field: keyof BoardEntry, value: string) {
    setBoard((current) => ({
      ...current,
      [stage]: current[stage].map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function archiveEntry(stage: StageKey, id: number) {
    setBoard((current) => ({
      ...current,
      [stage]: current[stage].filter((entry) => entry.id !== id),
    }));

    const entry = board[stage].find((entry) => entry.id === id);
    if (!entry) return;

    setArchivedEntries((current) => [
      {
        ...entry,
        archivedAt: new Date().toISOString(),
        archivedFrom: stage,
      },
      ...current,
    ]);
  }

  function restoreArchivedEntry(id: number, archivedAt: string) {
    const entry = archivedEntries.find((entry) => entry.id === id && entry.archivedAt === archivedAt);
    if (!entry) return;

    setBoard((current) => ({
      ...current,
      [entry.archivedFrom]: [
        ...current[entry.archivedFrom],
        {
          id: getNextId(current),
          name: entry.name,
          assignedTo: "",
          adminInCharge: entry.adminInCharge,
          status: entry.status,
          notes: entry.notes,
        },
      ],
    }));

    setArchivedEntries((current) =>
      current.filter((entry) => entry.id !== id || entry.archivedAt !== archivedAt)
    );
  }

  function moveEntry(fromStage: StageKey, toStage: StageKey, id: number) {
    if (fromStage === toStage) return;

    setBoard((current) => {
      const entryToMove = current[fromStage].find((entry) => entry.id === id);
      if (!entryToMove) return current;

      return {
        ...current,
        [fromStage]: current[fromStage].filter((entry) => entry.id !== id),
        [toStage]: [...current[toStage], entryToMove],
      };
    });
  }

  function clearFaxedBoard() {
    const confirmClear = window.confirm("Clear only the FAXED column and keep everything else?");
    if (!confirmClear) return;

    setArchivedEntries((current) => [...archiveEntriesFromStage(board.faxed, "faxed"), ...current]);
    setBoard((current) => ({
      ...current,
      faxed: [],
    }));
  }

  function resetBoard() {
    const confirmReset = window.confirm("Clear all rows and reset Total Wins to 0?");
    if (!confirmReset) return;

    setArchivedEntries((current) => [
      ...stageConfig.flatMap((stage) => archiveEntriesFromStage(board[stage.key], stage.key)),
      ...current,
    ]);
    setBoard(emptyBoard);
    setWins(0);
  }

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

  return (
    <main className="app-shell">
      <div className="top-actions">
        <button className={page === "tv" ? "nav-button active" : "nav-button"} onClick={() => setPage("tv")}>
          TV Board
        </button>
        <button className={page === "admin" ? "nav-button active" : "nav-button"} onClick={() => setPage("admin")}>
          Edit Board
        </button>
      </div>

      {page === "tv" ? (
        <div className="tv-layout">
          <aside className="left-panel">
            <img src="/vcg-logo.png" alt="Veterans Choice Global" className="logo" />

            <div className="clock-block">
              <div className="date-small">
                {weekdayShort} {monthShort}
              </div>
              <div className="day-number">{dayNumber}</div>
              <div className="clock-time">{formatTime(now)}</div>
            </div>
          </aside>

          <div className="board-panel">
            <h1 className="wins-title">
              TOTAL WINS: <span>{wins}</span>
            </h1>
            <BoardTable board={board} />
            <div className="entries-line">Entries: {totalEntries}</div>
          </div>
        </div>
      ) : showAuthGate ? (
        <div className="auth-page">
          <section className="auth-panel">
            <img src="/vcg-logo.png" alt="Veterans Choice Global" className="auth-logo" />
            <h1>Edit Board</h1>
            {isAuthLoading ? (
              <p>Checking access...</p>
            ) : authUser ? (
              <>
                <p>This Google account does not have edit access. Please sign in with an approved work account.</p>
                <button className="auth-button secondary" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p>Sign in with an approved Google account to update records.</p>
                <button className="auth-button" onClick={handleSignIn}>
                  Sign in with Google
                </button>
              </>
            )}
            {authError ? <div className="auth-error">{authError}</div> : null}
          </section>
        </div>
      ) : (
        <div className="admin-page">
          <div className="admin-header">
            <div className="admin-title-block">
              <h1>Edit Wins Board</h1>
              <p>Drag rows between columns, update statuses, and assign who is in charge.</p>
              <div className="status-row">
                <div className="sync-status">{syncStatus}</div>
                {authUser ? <div className="sync-status">Signed in as {authUser.email}</div> : null}
              </div>
            </div>

            <div className="admin-actions">
              <label className="wins-editor">
                Total Wins
                <input type="number" value={wins} onChange={(event) => setWins(Number(event.target.value))} />
              </label>

              <button className="secondary-action-button" onClick={() => setIsArchiveOpen((current) => !current)}>
                Archive ({archivedEntries.length})
              </button>

              {authUser ? (
                <button className="secondary-action-button" onClick={handleSignOut}>
                  Sign Out
                </button>
              ) : null}
            </div>
          </div>

          <div className="admin-toolbar">
            <label className="search-field">
              <span>Search</span>
              <input
                value={searchQuery}
                placeholder="Name, admin, status, or notes"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>

            <div className="toolbar-summary">
              {normalizedSearchQuery ? `${filteredEntriesCount} of ${totalEntries} records shown` : `${totalEntries} active records`}
            </div>

            <div className="danger-actions">
              <button className="reset-keep-button" onClick={clearFaxedBoard}>
                Clear Faxed
              </button>
              <button className="reset-button" onClick={resetBoard}>
                Reset All
              </button>
            </div>
          </div>

          {isArchiveOpen ? (
            <section className="archive-panel">
              <div>
                <h2>Archived Records</h2>
                <p>Archived rows stay out of the live board but can be restored.</p>
              </div>

              {archivedEntries.length ? (
                <div className="archive-list">
                  {archivedEntries.map((entry) => (
                    <div className="archive-row" key={`${entry.id}-${entry.archivedAt}`}>
                      <div>
                        <strong>{entry.name}</strong>
                        <span>
                          From {stageConfig.find((stage) => stage.key === entry.archivedFrom)?.title ?? entry.archivedFrom}
                        </span>
                      </div>
                      <button onClick={() => restoreArchivedEntry(entry.id, entry.archivedAt)}>Restore</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No archived records yet.</p>
              )}
            </section>
          ) : null}

          {isAddRecordOpen ? (
            <div className="modal-backdrop" role="presentation" onMouseDown={closeAddRecord}>
              <form className="record-modal" onSubmit={submitAddRecord} onMouseDown={(event) => event.stopPropagation()}>
                <div className="record-modal-header">
                  <h2>Add Record</h2>
                  <button type="button" onClick={closeAddRecord} aria-label="Close add record form">
                    x
                  </button>
                </div>

                <label className="modal-field">
                  Stage
                  <select
                    value={addRecordDraft.stage}
                    onChange={(event) =>
                      setAddRecordDraft((current) => ({ ...current, stage: event.target.value as StageKey }))
                    }
                  >
                    {stageConfig.map((stage) => (
                      <option key={stage.key} value={stage.key}>
                        {stage.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="modal-field">
                  Veteran
                  <input
                    autoFocus
                    value={addRecordDraft.name}
                    placeholder="Veteran's Name"
                    onChange={(event) => setAddRecordDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>

                <label className="modal-field">
                  Admin
                  <input
                    value={addRecordDraft.adminInCharge}
                    placeholder="Admin"
                    onChange={(event) =>
                      setAddRecordDraft((current) => ({ ...current, adminInCharge: event.target.value }))
                    }
                  />
                </label>

                <label className="modal-field">
                  Status
                  <select
                    value={addRecordDraft.status}
                    onChange={(event) =>
                      setAddRecordDraft((current) => ({ ...current, status: event.target.value as StatusLabel }))
                    }
                  >
                    {statusOptions.map((status) => (
                      <option key={status || "blank"} value={status}>
                        {status || "Blank"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="modal-field">
                  Notes
                  <textarea
                    maxLength={NOTE_MAX_LENGTH}
                    value={addRecordDraft.notes}
                    placeholder="Add notes for this record"
                    onChange={(event) =>
                      setAddRecordDraft((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                  <span className="note-counter">
                    {addRecordDraft.notes.length}/{NOTE_MAX_LENGTH}
                  </span>
                </label>

                <div className="record-modal-actions">
                  <button type="button" className="secondary-action-button" onClick={closeAddRecord}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-action-button" disabled={!addRecordDraft.name.trim()}>
                    Add Record
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          <div className="drag-admin-board">
            {stageConfig.map((stage) => (
              <section
                className="drag-column"
                key={stage.key}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const entryId = Number(event.dataTransfer.getData("entryId"));
                  const fromStage = event.dataTransfer.getData("fromStage") as StageKey;
                  moveEntry(fromStage, stage.key, entryId);
                }}
              >
                <div className="drag-column-header">
                  <div>
                    <h2>{stage.title}</h2>
                    <p>{stage.metaTitle}</p>
                  </div>
                  <div className="drag-column-actions">
                    <span>
                      {filteredBoard[stage.key].length}
                      {normalizedSearchQuery ? `/${board[stage.key].length}` : ""}
                    </span>
                    <button onClick={() => openAddRecord(stage.key)}>+ Add</button>
                  </div>
                </div>

                <div className="drag-list">
                  {filteredBoard[stage.key].length ? (
                    filteredBoard[stage.key].map((entry) => (
                    <div
                      className="drag-row"
                      key={entry.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("entryId", String(entry.id));
                        event.dataTransfer.setData("fromStage", stage.key);
                      }}
                    >
                      <div className="drag-handle">⋮⋮</div>

                      <label className="entry-field">
                        <span className="entry-field-label">Veteran</span>
                        <input
                          value={entry.name}
                          placeholder="Veteran's Name"
                          onChange={(event) => updateEntry(stage.key, entry.id, "name", event.target.value)}
                        />
                      </label>

                      <label className="entry-field owner-field">
                        <span className="entry-field-label">Admin</span>
                        <input
                          className="owner-input"
                          value={entry.adminInCharge}
                          placeholder="Admin"
                          onChange={(event) => updateEntry(stage.key, entry.id, "adminInCharge", event.target.value)}
                        />
                      </label>

                      <label className="entry-field notes-field">
                        <span className="entry-field-label">Notes</span>
                        <textarea
                          maxLength={NOTE_MAX_LENGTH}
                          value={entry.notes ?? ""}
                          placeholder="Add notes for this record"
                          onChange={(event) => updateEntry(stage.key, entry.id, "notes", event.target.value)}
                        />
                        <span className="note-counter">
                          {(entry.notes ?? "").length}/{NOTE_MAX_LENGTH}
                        </span>
                      </label>

                      <div className="controls-row">
                        <select
                          value={entry.status}
                          onChange={(event) => updateEntry(stage.key, entry.id, "status", event.target.value)}
                        >
                          {statusOptions.map((status) => (
                            <option key={status || "blank"} value={status}>
                              {status || "Blank"}
                            </option>
                          ))}
                        </select>

                        <button className="archive-button" onClick={() => archiveEntry(stage.key, entry.id)}>
                          Archive
                        </button>
                      </div>
                    </div>
                    ))
                  ) : (
                    <div className="column-empty-state">
                      {normalizedSearchQuery ? "No matching records" : "No records"}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function BoardTable({ board }: { board: BoardState }) {
  return (
    <div className="modern-board">
      {stageConfig.map((stage) => {
        const entries = board[stage.key];
        const rowCount = Math.max(8, entries.length);

        return (
          <section className="stage-card" key={stage.key}>
            <div className="stage-header">
              <div>
                <h2>{stage.title}</h2>
                <p>{stage.metaTitle}</p>
              </div>
              <span className="stage-count">{entries.length}</span>
            </div>

            <div className="stage-list">
              {Array.from({ length: rowCount }).map((_, index) => {
                const entry = entries[index];
                const status = entry?.status ?? "";

                return (
                  <div className={entry ? "stage-row" : "stage-row empty-row"} key={`${stage.key}-${index}`}>
                    <div className="person-details">
                      <span className="person-name">{entry?.name ?? ""}</span>
                      {entry?.adminInCharge ? (
                        <span className="person-owner">Admin: {entry.adminInCharge}</span>
                      ) : null}
                      {entry?.notes ? (
                        <span className="person-notes">
                          <span>NOTE</span>
                          {entry.notes}
                        </span>
                      ) : null}
                    </div>
                    <span className={getBadgeClass(status)}>{status || " "}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
