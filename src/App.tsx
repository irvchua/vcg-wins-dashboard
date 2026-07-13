import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  canUserEdit,
  createBoardRecord,
  type AuthUser,
  isFirebaseConfigured,
  migrateLegacyBoardRecords,
  RecordConflictError,
  saveBoardRecord,
  saveBoardData,
  shouldSeedMissingFirebaseBoard,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  subscribeToBoard,
  updateRecordState,
} from "./firebase";
import type { ActivityEntry, ArchivedEntry, BoardEntry, BoardState, StageKey, StatusLabel } from "./types";

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

type EditRecordDraft = BoardEntry & { stage: StageKey };

const STORAGE_KEY = "vcg-wins-board-data";
const ARCHIVED_STORAGE_KEY = "vcg-wins-board-archive";
const WINS_STORAGE_KEY = "vcg-total-wins";
const ACTIVITY_STORAGE_KEY = "vcg-wins-board-activity";
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

function createRecordId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
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
    updatedAt: entry.updatedAt,
    updatedBy: entry.updatedBy,
    version: entry.version ?? 1,
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
    updatedAt: entry.updatedAt,
    updatedBy: entry.updatedBy,
    version: entry.version ?? 1,
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

function loadInitialActivities(): ActivityEntry[] {
  try {
    const saved = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activities, setActivities] = useState<ActivityEntry[]>(loadInitialActivities);
  const [now, setNow] = useState(new Date());
  const [addRecordDraft, setAddRecordDraft] = useState<AddRecordDraft>(defaultAddRecordDraft);
  const [archivedEntries, setArchivedEntries] = useState<ArchivedEntry[]>(loadInitialArchivedEntries);
  const [board, setBoard] = useState<BoardState>(loadInitialBoard);
  const [isAddRecordOpen, setIsAddRecordOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState("");
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<{ stage: StageKey; id: number } | null>(null);
  const [selectedEntryInitial, setSelectedEntryInitial] = useState<BoardEntry | null>(null);
  const [editRecordDraft, setEditRecordDraft] = useState<EditRecordDraft | null>(null);
  const [editConflict, setEditConflict] = useState("");
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [sortBy, setSortBy] = useState<"manual" | "name" | "admin" | "status" | "updated">("manual");
  const [confirmation, setConfirmation] = useState<{
    confirmLabel: string;
    message: string;
    onConfirm: () => void;
    title: string;
  } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [wins, setWins] = useState<number>(loadInitialWins);
  const [page, setPage] = useState<"tv" | "admin">("tv");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isFirebaseConfigured);
  const [isRemoteReady, setIsRemoteReady] = useState(!isFirebaseConfigured);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured ? "Connecting to Firebase..." : "Local backup only"
  );
  const hasRemoteLoaded = useRef(!isFirebaseConfigured);
  const lastRemotePayload = useRef("");
  const pendingLocalPayload = useRef("");
  const hasMigratedRecords = useRef(false);

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
        setIsRemoteReady(true);

        if (!remoteData) {
          const localActivities = loadInitialActivities();
          const localWins = loadInitialWins();
          const localPayload = JSON.stringify({
            activities: localActivities,
            wins: localWins,
          });

          if (!shouldSeedMissingFirebaseBoard) {
            lastRemotePayload.current = localPayload;
            setSyncStatus("Firebase board not found. Saving locally.");
            return;
          }

          lastRemotePayload.current = localPayload;
          saveBoardData(localWins, localActivities)
            .then(() => setSyncStatus("Synced with Firebase"))
            .catch(() => setSyncStatus("Firebase unavailable. Saving locally."));
          return;
        }

        const nextActivities = remoteData.activities ?? [];
        const nextArchivedEntries = normalizeArchivedEntries(remoteData.archivedEntries);
        const nextBoard = normalizeBoard(remoteData.board);
        const nextWins = Number.isFinite(remoteData.wins) ? remoteData.wins : 104;
        const remotePayload = JSON.stringify({
          activities: nextActivities,
          wins: nextWins,
        });

        if (pendingLocalPayload.current && remotePayload !== pendingLocalPayload.current) {
          return;
        }

        if (remotePayload === pendingLocalPayload.current) {
          pendingLocalPayload.current = "";
        }

        lastRemotePayload.current = remotePayload;
        setActivities(nextActivities);
        setArchivedEntries(nextArchivedEntries);
        setBoard(nextBoard);
        setWins(nextWins);
        setLastUpdatedAt(remoteData.updatedAt);
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
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activities));
  }, [activities]);

  useEffect(() => {
    if (!isFirebaseConfigured || !canUserEdit(authUser) || !isRemoteReady || hasMigratedRecords.current) {
      return;
    }
    hasMigratedRecords.current = true;
    migrateLegacyBoardRecords(board, archivedEntries).catch((error) => {
      console.error("Record migration failed:", error);
      hasMigratedRecords.current = false;
      setSyncStatus("Record migration failed. Please reload.");
    });
  }, [archivedEntries, authUser, board, isRemoteReady]);

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

    const payload = JSON.stringify({ activities, wins });
    if (payload === lastRemotePayload.current) return;

    pendingLocalPayload.current = payload;
    setSyncStatus("Saving to Firebase...");
    const saveTimer = window.setTimeout(() => {
      saveBoardData(wins, activities)
        .then(() => {
          if (pendingLocalPayload.current !== payload) return;

          lastRemotePayload.current = payload;
          pendingLocalPayload.current = "";
          setLastUpdatedAt(new Date().toISOString());
          setSyncStatus("Synced with Firebase");
        })
        .catch((error) => {
          console.error("Firebase save failed:", error);
          setSyncStatus("Firebase unavailable. Saving locally.");
        });
    }, 350);

    return () => window.clearTimeout(saveTimer);
  }, [activities, authUser, wins]);

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
  const displayedBoard = useMemo(() => {
    if (sortBy === "manual") return filteredBoard;

    const valueFor = (entry: BoardEntry) => {
      if (sortBy === "name") return entry.name;
      if (sortBy === "admin") return entry.adminInCharge;
      if (sortBy === "status") return entry.status;
      return entry.updatedAt ?? "";
    };

    return Object.fromEntries(
      stageConfig.map((stage) => [
        stage.key,
        [...filteredBoard[stage.key]].sort((a, b) =>
          sortBy === "updated"
            ? valueFor(b).localeCompare(valueFor(a))
            : valueFor(a).localeCompare(valueFor(b))
        ),
      ])
    ) as BoardState;
  }, [filteredBoard, sortBy]);
  const filteredArchivedEntries = useMemo(() => {
    const query = archiveSearchQuery.trim().toLowerCase();
    if (!query) return archivedEntries;
    return archivedEntries.filter((entry) =>
      [entry.name, entry.adminInCharge, entry.status, entry.notes].some((value) =>
        value?.toLowerCase().includes(query)
      )
    );
  }, [archiveSearchQuery, archivedEntries]);
  const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" }).format(now);
  const dayNumber = now.getDate();

  function logActivity(action: string, recordName?: string) {
    setActivities((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        action,
        actor: authUser?.email ?? "Local user",
        createdAt: new Date().toISOString(),
        recordName,
      },
      ...current,
    ].slice(0, 100));
  }

  function openEditRecord(stage: StageKey, entry: BoardEntry) {
    setSelectedEntry({ stage, id: entry.id });
    setSelectedEntryInitial({ ...entry });
    setEditRecordDraft({ ...entry, stage });
    setEditConflict("");
  }

  function dismissEditRecord() {
    setSelectedEntry(null);
    setSelectedEntryInitial(null);
    setEditRecordDraft(null);
    setEditConflict("");
  }

  async function closeEditRecord() {
    if (!selectedEntry || !selectedEntryInitial || !editRecordDraft || isSavingRecord) return;
    const changedFields = (["name", "adminInCharge", "status", "notes"] as const)
      .filter((field) => (editRecordDraft[field] ?? "") !== (selectedEntryInitial[field] ?? ""))
      .map((field) => ({ adminInCharge: "admin", name: "name", notes: "notes", status: "status" })[field]);
    if (editRecordDraft.stage !== selectedEntry.stage) changedFields.push("stage");
    if (!changedFields.length) {
      dismissEditRecord();
      return;
    }

    setIsSavingRecord(true);
    setEditConflict("");
    try {
      const { stage, ...entry } = editRecordDraft;
      const savedEntry = await saveBoardRecord(
        stage,
        entry,
        selectedEntryInitial.version ?? 1,
        authUser?.email ?? "Local user"
      );
      setBoard((current) => ({
        ...current,
        [selectedEntry.stage]: current[selectedEntry.stage].filter((item) => item.id !== entry.id),
        [stage]: [
          ...current[stage].filter((item) => item.id !== entry.id),
          { ...entry, ...savedEntry },
        ],
      }));
      logActivity(`Updated ${changedFields.join(", ")}`, entry.name);
      dismissEditRecord();
    } catch (error) {
      if (error instanceof RecordConflictError) {
        setEditConflict("Another editor changed this record. Reload the latest version before trying again.");
      } else {
        console.error("Record save failed:", error);
        setEditConflict("This record could not be saved. Check your connection and try again.");
      }
    } finally {
      setIsSavingRecord(false);
    }
  }

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

    const newEntry: BoardEntry = {
      id: createRecordId(),
      name,
      assignedTo: "",
      adminInCharge: addRecordDraft.adminInCharge.trim(),
      status: addRecordDraft.status,
      notes: addRecordDraft.notes.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: authUser?.email ?? "Local user",
      version: 1,
    };
    setBoard((current) => ({
      ...current,
      [addRecordDraft.stage]: [...current[addRecordDraft.stage], newEntry],
    }));
    createBoardRecord(addRecordDraft.stage, newEntry, authUser?.email ?? "Local user")
      .catch((error) => setSyncStatus(`Record save failed: ${error.message}`));

    logActivity("Added record", name);
    closeAddRecord();
  }

  function archiveEntry(stage: StageKey, id: number) {
    const entry = board[stage].find((entry) => entry.id === id);
    if (!entry) return;

    setBoard((current) => ({
      ...current,
      [stage]: current[stage].filter((entry) => entry.id !== id),
    }));

    setArchivedEntries((current) => [
      {
        ...entry,
        archivedAt: new Date().toISOString(),
        archivedFrom: stage,
      },
      ...current,
    ]);
    updateRecordState(entry, {
      archivedAt: new Date().toISOString(),
      archivedFrom: stage,
      isArchived: true,
      stage,
    }, authUser?.email ?? "Local user").catch((error) => setSyncStatus(`Archive failed: ${error.message}`));
    logActivity("Archived record", entry.name);
  }

  function restoreArchivedEntry(id: number, archivedAt: string) {
    const entry = archivedEntries.find((entry) => entry.id === id && entry.archivedAt === archivedAt);
    if (!entry) return;

    const restoredEntry: BoardEntry = {
      id: entry.id,
      name: entry.name,
      assignedTo: "",
      adminInCharge: entry.adminInCharge,
      status: entry.status,
      notes: entry.notes,
      updatedAt: new Date().toISOString(),
      updatedBy: authUser?.email ?? "Local user",
      version: (entry.version ?? 1) + 1,
    };
    setBoard((current) => ({
      ...current,
      [entry.archivedFrom]: [...current[entry.archivedFrom], restoredEntry],
    }));
    updateRecordState(entry, { isArchived: false, stage: entry.archivedFrom }, authUser?.email ?? "Local user")
      .catch((error) => setSyncStatus(`Restore failed: ${error.message}`));

    setArchivedEntries((current) =>
      current.filter((entry) => entry.id !== id || entry.archivedAt !== archivedAt)
    );
    logActivity("Restored record", entry.name);
  }

  function moveEntry(fromStage: StageKey, toStage: StageKey, id: number) {
    if (fromStage === toStage) return;

    setBoard((current) => {
      const entryToMove = current[fromStage].find((entry) => entry.id === id);
      if (!entryToMove) return current;

      return {
        ...current,
        [fromStage]: current[fromStage].filter((entry) => entry.id !== id),
        [toStage]: [...current[toStage], { ...entryToMove, updatedAt: new Date().toISOString() }],
      };
    });
    const movedEntry = board[fromStage].find((entry) => entry.id === id);
    if (movedEntry) {
      updateRecordState(movedEntry, { stage: toStage }, authUser?.email ?? "Local user")
        .catch((error) => setSyncStatus(`Move failed: ${error.message}`));
      const destination = stageConfig.find((stage) => stage.key === toStage)?.title ?? toStage;
      logActivity(`Moved to ${destination}`, movedEntry.name);
    }
  }

  function clearFaxedBoard() {
    setConfirmation({
      title: "Clear Faxed records?",
      message: `${board.faxed.length} record${board.faxed.length === 1 ? "" : "s"} will be moved to the archive. Other columns will not change.`,
      confirmLabel: `Archive ${board.faxed.length} records`,
      onConfirm: () => {
        const archivedAt = new Date().toISOString();
        setArchivedEntries((current) => [...archiveEntriesFromStage(board.faxed, "faxed"), ...current]);
        setBoard((current) => ({ ...current, faxed: [] }));
        Promise.all(board.faxed.map((entry) => updateRecordState(entry, {
          archivedAt,
          archivedFrom: "faxed",
          isArchived: true,
          stage: "faxed",
        }, authUser?.email ?? "Local user"))).catch((error) => setSyncStatus(`Clear Faxed failed: ${error.message}`));
        logActivity(`Cleared ${board.faxed.length} Faxed records`);
      },
    });
  }

  function resetBoard() {
    setConfirmation({
      title: "Reset the entire board?",
      message: `All ${totalEntries} active records will be archived and Total Wins will be reset to 0.`,
      confirmLabel: "Reset entire board",
      onConfirm: () => {
        const archivedAt = new Date().toISOString();
        const entriesToArchive = stageConfig.flatMap((stage) =>
          board[stage.key].map((entry) => ({ entry, stage: stage.key }))
        );
        setArchivedEntries((current) => [
          ...stageConfig.flatMap((stage) => archiveEntriesFromStage(board[stage.key], stage.key)),
          ...current,
        ]);
        setBoard(emptyBoard);
        setWins(0);
        Promise.all(entriesToArchive.map(({ entry, stage }) => updateRecordState(entry, {
          archivedAt,
          archivedFrom: stage,
          isArchived: true,
          stage,
        }, authUser?.email ?? "Local user"))).catch((error) => setSyncStatus(`Reset failed: ${error.message}`));
        logActivity(`Reset board and archived ${totalEntries} records`);
      },
    });
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
        {page === "admin" && authUser ? (
          <button className="nav-button sign-out-button" onClick={handleSignOut}>
            Sign Out
          </button>
        ) : null}
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
                <div className="records-count">
                  <strong>{normalizedSearchQuery ? filteredEntriesCount : totalEntries}</strong>
                  <span>{normalizedSearchQuery ? `of ${totalEntries} records shown` : "active records"}</span>
                </div>
                <div className="sync-status">{syncStatus}</div>
                {lastUpdatedAt ? (
                  <div className="sync-status">Last updated {new Date(lastUpdatedAt).toLocaleString()}</div>
                ) : null}
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
              <button className="secondary-action-button" onClick={() => setIsActivityOpen((current) => !current)}>
                Activity
              </button>
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

            <label className="sort-field">
              <span>Sort columns</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                <option value="manual">Manual order</option>
                <option value="name">Veteran name</option>
                <option value="admin">Admin</option>
                <option value="status">Status</option>
                <option value="updated">Recently updated</option>
              </select>
            </label>

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

              <label className="search-field archive-search">
                <span>Search archive</span>
                <input
                  value={archiveSearchQuery}
                  placeholder="Name, admin, status, or notes"
                  onChange={(event) => setArchiveSearchQuery(event.target.value)}
                />
              </label>

              {filteredArchivedEntries.length ? (
                <div className="archive-list">
                  {filteredArchivedEntries.map((entry) => (
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
                <p className="empty-state">
                  {archiveSearchQuery ? "No matching archived records." : "No archived records yet."}
                </p>
              )}
            </section>
          ) : null}

          {isActivityOpen ? (
            <section className="activity-panel">
              <div>
                <h2>Recent Activity</h2>
                <p>The latest 100 board changes are retained.</p>
              </div>
              {activities.length ? (
                <div className="activity-list">
                  {activities.map((activity) => (
                    <div className="activity-row" key={activity.id}>
                      <div>
                        <strong>{activity.action}</strong>
                        {activity.recordName ? <span>{activity.recordName}</span> : null}
                      </div>
                      <div>
                        <span>{activity.actor}</span>
                        <time>{new Date(activity.createdAt).toLocaleString()}</time>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No activity recorded yet.</p>
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

          {selectedEntry && editRecordDraft ? (
            <div className="modal-backdrop" role="presentation" onMouseDown={closeEditRecord}>
              <div
                className="record-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-record-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="record-modal-header">
                  <div>
                    <h2 id="edit-record-title">Edit Record</h2>
                    <p>{stageConfig.find((stage) => stage.key === selectedEntry.stage)?.title}</p>
                  </div>
                  <button type="button" onClick={closeEditRecord} aria-label="Close edit record form">
                    x
                  </button>
                </div>

                <label className="modal-field">
                  Stage
                  <select
                    value={editRecordDraft.stage}
                    onChange={(event) => {
                      const nextStage = event.target.value as StageKey;
                      setEditRecordDraft((current) => current ? { ...current, stage: nextStage } : null);
                    }}
                  >
                    {stageConfig.map((stage) => (
                      <option value={stage.key} key={stage.key}>{stage.title}</option>
                    ))}
                  </select>
                </label>

                <label className="modal-field">
                  Veteran
                  <input
                    autoFocus
                    value={editRecordDraft.name}
                    onChange={(event) => setEditRecordDraft((current) => current ? { ...current, name: event.target.value } : null)}
                  />
                </label>

                <label className="modal-field">
                  Admin
                  <input
                    value={editRecordDraft.adminInCharge}
                    placeholder="Admin"
                    onChange={(event) =>
                      setEditRecordDraft((current) => current ? { ...current, adminInCharge: event.target.value } : null)
                    }
                  />
                </label>

                <label className="modal-field">
                  Status
                  <select
                    value={editRecordDraft.status}
                    onChange={(event) => setEditRecordDraft((current) => current ? { ...current, status: event.target.value as StatusLabel } : null)}
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
                    value={editRecordDraft.notes ?? ""}
                    placeholder="Add notes for this record"
                    onChange={(event) => setEditRecordDraft((current) => current ? { ...current, notes: event.target.value } : null)}
                  />
                  <span className="note-counter">
                    {(editRecordDraft.notes ?? "").length}/{NOTE_MAX_LENGTH}
                  </span>
                </label>

                <div className="record-modal-actions edit-modal-actions">
                  <button
                    type="button"
                    className="archive-button"
                    onClick={() => setConfirmation({
                      title: "Archive this record?",
                      message: `${editRecordDraft.name || "This record"} will leave the live board and can be restored later.`,
                      confirmLabel: "Archive record",
                      onConfirm: () => {
                        archiveEntry(selectedEntry.stage, selectedEntry.id);
                        dismissEditRecord();
                      },
                    })}
                  >
                    Archive Record
                  </button>
                  <span className="modal-save-status">{isSavingRecord ? "Saving…" : "Changes are checked before saving"}</span>
                  <button type="button" className="primary-action-button" onClick={closeEditRecord} disabled={isSavingRecord}>
                    {isSavingRecord ? "Saving…" : "Save Changes"}
                  </button>
                </div>
                {editConflict ? (
                  <div className="edit-conflict" role="alert">
                    <span>{editConflict}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const latestStage = stageConfig.find((stage) =>
                          board[stage.key].some((entry) => entry.id === selectedEntry.id)
                        )?.key;
                        const latest = latestStage
                          ? board[latestStage].find((entry) => entry.id === selectedEntry.id)
                          : null;
                        if (latest && latestStage) openEditRecord(latestStage, latest);
                      }}
                    >
                      Reload latest
                    </button>
                  </div>
                ) : null}
              </div>
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
                      {displayedBoard[stage.key].length}
                      {normalizedSearchQuery ? `/${board[stage.key].length}` : ""}
                    </span>
                    <button onClick={() => openAddRecord(stage.key)}>+ Add</button>
                  </div>
                </div>

                <div className="drag-list">
                  {displayedBoard[stage.key].length ? (
                    displayedBoard[stage.key].map((entry) => (
                    <div
                      className="drag-row"
                      key={entry.id}
                      draggable={sortBy === "manual"}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("entryId", String(entry.id));
                        event.dataTransfer.setData("fromStage", stage.key);
                      }}
                    >
                      <div className="drag-handle">⋮⋮</div>
                      <button
                        type="button"
                        className="entry-summary-button"
                        onClick={() => openEditRecord(stage.key, entry)}
                      >
                        <span className={`status-dot status-${entry.status.toLowerCase().replaceAll(" ", "-") || "blank"}`} />
                        <span>{entry.name || "Unnamed record"}</span>
                        <span className="edit-entry-icon" aria-hidden="true">✎</span>
                      </button>
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

          {confirmation ? (
            <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmation(null)}>
              <div className="confirm-modal" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
                <h2>{confirmation.title}</h2>
                <p>{confirmation.message}</p>
                <div className="record-modal-actions">
                  <button className="secondary-action-button" onClick={() => setConfirmation(null)}>Cancel</button>
                  <button
                    className="danger-confirm-button"
                    onClick={() => {
                      confirmation.onConfirm();
                      setConfirmation(null);
                    }}
                  >
                    {confirmation.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
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
