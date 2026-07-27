import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  canUserEdit,
  createBoardRecord,
  type AuthUser,
  isFirebaseConfigured,
  migrateLegacyBoardRecords,
  RecordConflictError,
  saveAnnouncement,
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

type WinsAnimation = {
  delta: number;
  direction: "increase" | "decrease";
  id: number;
};

const STORAGE_KEY = "vcg-wins-board-data";
const ARCHIVED_STORAGE_KEY = "vcg-wins-board-archive";
const WINS_STORAGE_KEY = "vcg-total-wins";
const WINS_TARGET_STORAGE_KEY = "vcg-wins-target";
const ACTIVITY_STORAGE_KEY = "vcg-wins-board-activity";
const NOTE_MAX_LENGTH = 80;
const CELEBRATION_VISUAL_DURATION_MS = 33_000;
const ANNOUNCEMENT_EDITOR_EMAILS = [
  "admin@veteranschoiceglobal.com",
  "le.juico@veteranschoiceglobal.com",
  "fa.ramos@veteranschoiceglobal.com",
  "j.sawit@veteranschoiceglobal.com",
];
const ANNOUNCEMENT_MAX_LENGTH = 240;

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

function formatRelativeUpdated(timestamp: string, now: Date): string {
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(timestamp).getTime()) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
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

function loadInitialWinsTarget(): number {
  const savedTarget = localStorage.getItem(WINS_TARGET_STORAGE_KEY);
  return savedTarget ? Number(savedTarget) : 0;
}

function normalizeWinsEditorValue(value: string, fallback: number): number {
  const nextValue = Number(value.trim());
  return Number.isFinite(nextValue) ? Math.max(0, Math.trunc(nextValue)) : fallback;
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
  const [announcement, setAnnouncement] = useState("");
  const [announcementInput, setAnnouncementInput] = useState("");
  const [announcementSaveMessage, setAnnouncementSaveMessage] = useState("");
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
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
  const [winsInput, setWinsInput] = useState(() => String(loadInitialWins()));
  const [isWinsDirty, setIsWinsDirty] = useState(false);
  const [isSavingWins, setIsSavingWins] = useState(false);
  const [winsSaveMessage, setWinsSaveMessage] = useState("");
  const [winsAnimation, setWinsAnimation] = useState<WinsAnimation | null>(null);
  const [winsTarget, setWinsTarget] = useState<number>(loadInitialWinsTarget);
  const [winsTargetInput, setWinsTargetInput] = useState(() => String(loadInitialWinsTarget()));
  const [isWinsTargetDirty, setIsWinsTargetDirty] = useState(false);
  const [isSavingWinsTarget, setIsSavingWinsTarget] = useState(false);
  const [winsTargetSaveMessage, setWinsTargetSaveMessage] = useState("");
  const [isCelebrationSoundEnabled, setIsCelebrationSoundEnabled] = useState(true);
  const [isCelebrationSoundUnlocked, setIsCelebrationSoundUnlocked] = useState(false);
  const [isCelebrationSoundPlaying, setIsCelebrationSoundPlaying] = useState(false);
  const [isCelebrationActive, setIsCelebrationActive] = useState(false);
  const [celebrationSoundError, setCelebrationSoundError] = useState("");
  const [areAssetsLoaded, setAreAssetsLoaded] = useState(false);
  const [assetLoadError, setAssetLoadError] = useState("");
  const [loadedAssetCount, setLoadedAssetCount] = useState(0);
  const [assetLoadAttempt, setAssetLoadAttempt] = useState(0);
  const [page, setPage] = useState<"tv" | "admin">("tv");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isFirebaseConfigured);
  const [isRemoteReady, setIsRemoteReady] = useState(!isFirebaseConfigured);
  const [areTvControlsVisible, setAreTvControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [hasRemoteLegacyBoard, setHasRemoteLegacyBoard] = useState(false);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured ? "Connecting to Firebase..." : "Local backup only"
  );
  const hasRemoteLoaded = useRef(!isFirebaseConfigured);
  const lastRemotePayload = useRef("");
  const pendingLocalPayload = useRef("");
  const hasMigratedRecords = useRef(false);
  const previousWins = useRef(wins);
  const hasReceivedInitialWins = useRef(!isFirebaseConfigured);
  const isWinsInputFocused = useRef(false);
  const isWinsTargetInputFocused = useRef(false);
  const winnerAnnouncementAudio = useRef<HTMLAudioElement | null>(null);
  const applauseAudio = useRef<HTMLAudioElement | null>(null);
  const youWinAudio = useRef<HTMLAudioElement | null>(null);
  const celebrationSequence = useRef(0);
  const celebrationVisualTimer = useRef<number | null>(null);
  const isUnlockingCelebrationAudio = useRef(false);
  const isAnnouncementDirty = useRef(false);

  useEffect(() => {
    let cancelled = false;

    winnerAnnouncementAudio.current ??= new Audio("/winner-announcement.wav");
    applauseAudio.current ??= new Audio("/applause.wav");
    youWinAudio.current ??= new Audio("/you-win.wav");

    const preloadAudio = (audio: HTMLAudioElement) => new Promise<void>((resolve, reject) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        resolve();
        return;
      }
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error(`Could not load ${audio.src}`));
      };
      const cleanup = () => {
        audio.removeEventListener("canplaythrough", loaded);
        audio.removeEventListener("error", failed);
      };
      audio.addEventListener("canplaythrough", loaded);
      audio.addEventListener("error", failed);
      audio.preload = "auto";
      audio.load();
    });

    const preloadImage = (source: string) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not load ${source}`));
      image.src = source;
    });

    const assets = [
      preloadAudio(winnerAnnouncementAudio.current),
      preloadAudio(applauseAudio.current),
      preloadAudio(youWinAudio.current),
      preloadImage("/vcg-logo.png"),
    ].map((asset) => asset.then(() => {
      if (!cancelled) setLoadedAssetCount((count) => count + 1);
    }));

    Promise.all(assets)
      .then(() => {
        if (!cancelled) setAreAssetsLoaded(true);
      })
      .catch((error) => {
        console.error("Asset preload failed:", error);
        if (!cancelled) setAssetLoadError("Some celebration assets could not be loaded.");
      });

    return () => { cancelled = true; };
  }, [assetLoadAttempt]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page !== "tv") return;

    let hideTimer = window.setTimeout(() => setAreTvControlsVisible(false), 5000);
    const revealControls = () => {
      setAreTvControlsVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setAreTvControlsVisible(false), 5000);
    };

    window.addEventListener("mousemove", revealControls);
    window.addEventListener("keydown", revealControls);
    window.addEventListener("touchstart", revealControls);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("mousemove", revealControls);
      window.removeEventListener("keydown", revealControls);
      window.removeEventListener("touchstart", revealControls);
    };
  }, [page]);

  useEffect(() => {
    const updateFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);

  useEffect(() => {
    const previous = previousWins.current;
    if (previous === wins) return;

    previousWins.current = wins;
    const animation: WinsAnimation = {
      delta: wins - previous,
      direction: wins > previous ? "increase" : "decrease",
      id: Date.now(),
    };
    setWinsAnimation(animation);
    if (animation.direction === "increase" && page === "tv") startCelebration();
    const timer = window.setTimeout(() => setWinsAnimation(null), 1400);
    return () => window.clearTimeout(timer);
    // A change in the win total is the event; sound-control state must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, wins]);

  useEffect(() => () => {
    celebrationSequence.current += 1;
    [winnerAnnouncementAudio.current, applauseAudio.current, youWinAudio.current].forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.onended = null;
    });
    if (celebrationVisualTimer.current !== null) window.clearTimeout(celebrationVisualTimer.current);
  }, []);

  useEffect(() => {
    if (page !== "tv" && (isCelebrationSoundPlaying || isCelebrationActive)) stopCelebration();
    // Page changes are the only trigger; playback state is read to avoid redundant stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!isCelebrationSoundEnabled || isCelebrationSoundUnlocked) return;

    const unlockOnFirstInteraction = () => void enableCelebrationSound();
    window.addEventListener("pointerdown", unlockOnFirstInteraction);
    window.addEventListener("keydown", unlockOnFirstInteraction);
    return () => {
      window.removeEventListener("pointerdown", unlockOnFirstInteraction);
      window.removeEventListener("keydown", unlockOnFirstInteraction);
    };
    // Sound authorization is intentionally attempted only when enabled state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCelebrationSoundEnabled, isCelebrationSoundUnlocked]);

  useEffect(() => {
    if (!isWinsInputFocused.current && !isWinsDirty) setWinsInput(String(wins));
  }, [isWinsDirty, wins]);

  useEffect(() => {
    if (!isWinsTargetInputFocused.current && !isWinsTargetDirty) setWinsTargetInput(String(winsTarget));
  }, [isWinsTargetDirty, winsTarget]);

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
          setHasRemoteLegacyBoard(false);
          const localActivities = loadInitialActivities();
          const localWins = loadInitialWins();
          const localWinsTarget = loadInitialWinsTarget();
          const localPayload = JSON.stringify({
            activities: localActivities,
            wins: localWins,
            winsTarget: localWinsTarget,
          });

          if (!shouldSeedMissingFirebaseBoard) {
            lastRemotePayload.current = localPayload;
            setSyncStatus("Firebase board not found. Saving locally.");
            return;
          }

          lastRemotePayload.current = localPayload;
          saveBoardData(localWins, localWinsTarget, localActivities)
            .then(() => setSyncStatus("Synced with Firebase"))
            .catch(() => setSyncStatus("Firebase unavailable. Saving locally."));
          return;
        }

        const nextActivities = remoteData.activities ?? [];
        setAnnouncement(remoteData.announcement ?? "");
        if (!isAnnouncementDirty.current) setAnnouncementInput(remoteData.announcement ?? "");
        setHasRemoteLegacyBoard(remoteData.hasLegacyBoard);
        const nextArchivedEntries = normalizeArchivedEntries(remoteData.archivedEntries);
        const nextBoard = normalizeBoard(remoteData.board);
        const nextWins = Number.isFinite(remoteData.wins) ? remoteData.wins : 104;
        const nextWinsTarget = Number.isFinite(remoteData.winsTarget) ? remoteData.winsTarget : 0;
        if (!hasReceivedInitialWins.current) {
          previousWins.current = nextWins;
          hasReceivedInitialWins.current = true;
        }
        const remotePayload = JSON.stringify({
          activities: nextActivities,
          wins: nextWins,
          winsTarget: nextWinsTarget,
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
        setWinsTarget(nextWinsTarget);
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
    if (
      !isFirebaseConfigured
      || !canUserEdit(authUser)
      || !isRemoteReady
      || (!hasRemoteLegacyBoard && !shouldSeedMissingFirebaseBoard)
      || hasMigratedRecords.current
    ) {
      return;
    }
    hasMigratedRecords.current = true;
    migrateLegacyBoardRecords(board, archivedEntries).catch((error) => {
      console.error("Record migration failed:", error);
      hasMigratedRecords.current = false;
      setSyncStatus("Record migration failed. Please reload.");
    });
  }, [archivedEntries, authUser, board, hasRemoteLegacyBoard, isRemoteReady]);

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
    localStorage.setItem(WINS_TARGET_STORAGE_KEY, String(winsTarget));
  }, [winsTarget]);

  useEffect(() => {
    if (!isFirebaseConfigured || !hasRemoteLoaded.current || !canUserEdit(authUser)) return;

    const payload = JSON.stringify({ activities, wins, winsTarget });
    if (payload === lastRemotePayload.current) return;

    pendingLocalPayload.current = payload;
    setSyncStatus("Saving to Firebase...");
    const saveTimer = window.setTimeout(() => {
      saveBoardData(wins, winsTarget, activities)
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
  }, [activities, authUser, wins, winsTarget]);

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
  const tvConnection = !isFirebaseConfigured
    ? { label: "Local", state: "local" }
    : syncStatus.includes("Synced")
      ? { label: "Live", state: "live" }
      : syncStatus.includes("Connecting") || syncStatus.includes("Saving")
        ? { label: "Connecting", state: "connecting" }
        : { label: "Offline", state: "offline" };

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

  async function saveWinsInput() {
    if (isSavingWins || !isWinsDirty) return;

    const trimmedValue = winsInput.trim();
    if (!trimmedValue) {
      setWinsSaveMessage("Enter a win total");
      return;
    }

    const nextWins = Number(trimmedValue);
    if (!Number.isFinite(nextWins)) {
      setWinsSaveMessage("Enter a valid number");
      return;
    }

    const normalizedWins = Math.max(0, Math.trunc(nextWins));
    if (normalizedWins === wins) {
      setWinsInput(String(wins));
      setIsWinsDirty(false);
      setWinsSaveMessage("No changes to save");
      return;
    }

    setIsSavingWins(true);
    setWinsSaveMessage("");

    if (!isFirebaseConfigured) {
      setWins(normalizedWins);
      setWinsInput(String(normalizedWins));
      setIsWinsDirty(false);
      setWinsSaveMessage("Saved locally");
      setIsSavingWins(false);
      return;
    }

    const nextWinsTarget = normalizeWinsEditorValue(winsTargetInput, winsTarget);
    const payload = JSON.stringify({
      activities,
      wins: normalizedWins,
      winsTarget: nextWinsTarget,
    });
    pendingLocalPayload.current = payload;
    setSyncStatus("Saving to Firebase...");

    try {
      await saveBoardData(normalizedWins, nextWinsTarget, activities);
      if (pendingLocalPayload.current === payload) {
        lastRemotePayload.current = payload;
        pendingLocalPayload.current = "";
        setSyncStatus("Synced with Firebase");
      }
      setWins(normalizedWins);
      setWinsInput(String(normalizedWins));
      setIsWinsDirty(false);
      setWinsSaveMessage("Saved");
      setLastUpdatedAt(new Date().toISOString());

      setWinsTarget(nextWinsTarget);
      if (isWinsTargetDirty && winsTargetInput.trim() === String(nextWinsTarget)) {
        setIsWinsTargetDirty(false);
        setWinsTargetSaveMessage("Saved");
      }
    } catch (error) {
      console.error("Total Wins save failed:", error);
      if (pendingLocalPayload.current === payload) {
        pendingLocalPayload.current = "";
        setSyncStatus("Firebase unavailable. Changes not saved.");
      }
      setWinsSaveMessage("Save failed — try again");
    } finally {
      setIsSavingWins(false);
    }
  }

  async function saveWinsTargetInput() {
    if (isSavingWinsTarget || !isWinsTargetDirty) return;

    const trimmedValue = winsTargetInput.trim();
    if (!trimmedValue) {
      setWinsTargetSaveMessage("Enter a target");
      return;
    }

    const nextTarget = Number(trimmedValue);
    if (!Number.isFinite(nextTarget)) {
      setWinsTargetSaveMessage("Enter a valid number");
      return;
    }

    const normalizedTarget = Math.max(0, Math.trunc(nextTarget));
    if (normalizedTarget === winsTarget) {
      setWinsTargetInput(String(winsTarget));
      setIsWinsTargetDirty(false);
      setWinsTargetSaveMessage("No changes to save");
      return;
    }

    setIsSavingWinsTarget(true);
    setWinsTargetSaveMessage("");

    if (!isFirebaseConfigured) {
      setWinsTarget(normalizedTarget);
      setWinsTargetInput(String(normalizedTarget));
      setIsWinsTargetDirty(false);
      setWinsTargetSaveMessage("Saved locally");
      setIsSavingWinsTarget(false);
      return;
    }

    const nextWins = normalizeWinsEditorValue(winsInput, wins);
    const payload = JSON.stringify({
      activities,
      wins: nextWins,
      winsTarget: normalizedTarget,
    });
    pendingLocalPayload.current = payload;
    setSyncStatus("Saving to Firebase...");

    try {
      await saveBoardData(nextWins, normalizedTarget, activities);
      if (pendingLocalPayload.current === payload) {
        lastRemotePayload.current = payload;
        pendingLocalPayload.current = "";
        setSyncStatus("Synced with Firebase");
      }
      setWinsTarget(normalizedTarget);
      setWinsTargetInput(String(normalizedTarget));
      setIsWinsTargetDirty(false);
      setWinsTargetSaveMessage("Saved");
      setLastUpdatedAt(new Date().toISOString());

      setWins(nextWins);
      if (isWinsDirty && winsInput.trim() === String(nextWins)) {
        setIsWinsDirty(false);
        setWinsSaveMessage("Saved");
      }
    } catch (error) {
      console.error("Win target save failed:", error);
      if (pendingLocalPayload.current === payload) {
        pendingLocalPayload.current = "";
        setSyncStatus("Firebase unavailable. Changes not saved.");
      }
      setWinsTargetSaveMessage("Save failed — try again");
    } finally {
      setIsSavingWinsTarget(false);
    }
  }

  async function saveAnnouncementInput() {
    if (isSavingAnnouncement || !ANNOUNCEMENT_EDITOR_EMAILS.includes(authUser?.email.toLowerCase() ?? "")) return;
    const nextAnnouncement = announcementInput.trim().slice(0, ANNOUNCEMENT_MAX_LENGTH);
    setIsSavingAnnouncement(true);
    setAnnouncementSaveMessage("");
    try {
      if (isFirebaseConfigured) await saveAnnouncement(nextAnnouncement);
      setAnnouncement(nextAnnouncement);
      setAnnouncementInput(nextAnnouncement);
      isAnnouncementDirty.current = false;
      setAnnouncementSaveMessage("Saved");
    } catch (error) {
      console.error("Announcement save failed:", error);
      setAnnouncementSaveMessage("Save failed");
    } finally {
      setIsSavingAnnouncement(false);
    }
  }

  function stopCelebrationSound() {
    celebrationSequence.current += 1;
    [winnerAnnouncementAudio.current, applauseAudio.current, youWinAudio.current].forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      audio.loop = false;
      audio.onended = null;
    });
    setIsCelebrationSoundPlaying(false);
  }

  function stopCelebration() {
    stopCelebrationSound();
    if (celebrationVisualTimer.current !== null) {
      window.clearTimeout(celebrationVisualTimer.current);
      celebrationVisualTimer.current = null;
    }
    setIsCelebrationActive(false);
  }

  function startCelebration() {
    if (page !== "tv") return;
    if (celebrationVisualTimer.current !== null) window.clearTimeout(celebrationVisualTimer.current);
    setIsCelebrationActive(true);
    celebrationVisualTimer.current = window.setTimeout(() => {
      celebrationVisualTimer.current = null;
      setIsCelebrationActive(false);
    }, CELEBRATION_VISUAL_DURATION_MS);
    playCelebrationSound();
  }

  function disableCelebrationSound() {
    stopCelebration();
    setIsCelebrationSoundEnabled(false);
    setIsCelebrationSoundUnlocked(false);
    setCelebrationSoundError("");
  }

  async function enableCelebrationSound() {
    if (isUnlockingCelebrationAudio.current || isCelebrationSoundUnlocked) return;
    isUnlockingCelebrationAudio.current = true;
    try {
      winnerAnnouncementAudio.current ??= new Audio("/winner-announcement.wav");
      applauseAudio.current ??= new Audio("/applause.wav");
      youWinAudio.current ??= new Audio("/you-win.wav");
      const audioClips = [winnerAnnouncementAudio.current, applauseAudio.current, youWinAudio.current];
      audioClips.forEach((audio) => {
        audio.preload = "auto";
        audio.muted = false;
        audio.volume = 0.001;
      });

      const unlockResults = await Promise.allSettled(audioClips.map((audio) => audio.play()));
      audioClips.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      });

      const failedUnlock = unlockResults.find((result) => result.status === "rejected");
      if (failedUnlock?.status === "rejected") {
        console.debug("Audio activation was deferred:", failedUnlock.reason);
        setIsCelebrationSoundUnlocked(false);
        return;
      }

      setCelebrationSoundError("");
      setIsCelebrationSoundEnabled(true);
      setIsCelebrationSoundUnlocked(true);
    } finally {
      isUnlockingCelebrationAudio.current = false;
    }
  }

  function playCelebrationSound() {
    const announcement = winnerAnnouncementAudio.current;
    const applause = applauseAudio.current;
    const youWin = youWinAudio.current;
    if (!isCelebrationSoundEnabled || !isCelebrationSoundUnlocked || !announcement || !applause || !youWin) return;

    stopCelebrationSound();
    const sequence = celebrationSequence.current;
    setIsCelebrationSoundPlaying(true);
    announcement.onended = () => {
      if (sequence !== celebrationSequence.current) return;
      announcement.onended = null;
      applause.currentTime = 0;
      applause.loop = false;
      applause.onended = () => {
        if (sequence !== celebrationSequence.current) return;
        applause.onended = null;
        youWin.currentTime = 0;
        youWin.onended = () => {
          youWin.onended = null;
          setIsCelebrationSoundPlaying(false);
          setIsCelebrationActive(false);
          if (celebrationVisualTimer.current !== null) {
            window.clearTimeout(celebrationVisualTimer.current);
            celebrationVisualTimer.current = null;
          }
        };
        void youWin.play().catch((error) => handleCelebrationPlaybackError("You Win", error));
      };
      void applause.play().catch((error) => handleCelebrationPlaybackError("applause", error));
    };
    void announcement.play().catch((error) => handleCelebrationPlaybackError("win announcement", error));
  }

  function handleCelebrationPlaybackError(clip: string, error: unknown) {
    console.error(`Celebration ${clip} playback failed:`, error);
    stopCelebrationSound();
    setIsCelebrationSoundUnlocked(false);
    setCelebrationSoundError(`Browser blocked ${clip}. Click the TV Board once, then test again.`);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen request failed:", error);
    }
  }

  return (
    <main className={`app-shell ${page === "tv" ? "tv-page" : ""} ${page === "tv" && announcement ? "has-announcement" : ""}`}>
      {page === "tv" && isCelebrationActive ? <CanvasFireworks /> : null}
      {page === "tv" && announcement ? (
        <div className="announcement-banner" role="status" aria-label="Announcement">
          <div><span>{announcement}</span><span aria-hidden="true">{announcement}</span></div>
        </div>
      ) : null}
      <div className={`top-actions ${page === "tv" ? "tv-controls" : ""} ${page === "tv" && !areTvControlsVisible ? "tv-controls-hidden" : ""}`}>
        <div className="top-action-buttons">
          <button
            className={page === "tv" ? "nav-button active" : "nav-button"}
            onClick={() => {
              setAreTvControlsVisible(true);
              setPage("tv");
            }}
          >
            TV Board
          </button>
          <button
            className={page === "admin" ? "nav-button active" : "nav-button"}
            onClick={() => {
              setAreTvControlsVisible(true);
              setPage("admin");
            }}
          >
            Edit Board
          </button>
          {page === "tv" ? (
            <>
              <button
                className={`nav-button sound-button ${isCelebrationSoundEnabled ? "is-enabled" : ""}`}
                onClick={() => isCelebrationSoundEnabled ? disableCelebrationSound() : void enableCelebrationSound()}
              >
                {isCelebrationSoundPlaying ? "Stop Sound" : isCelebrationSoundEnabled ? "Disable Sound" : "Enable Sound"}
              </button>
              {celebrationSoundError ? <span className="sound-error" role="alert">{celebrationSoundError}</span> : null}
              {!areAssetsLoaded ? (
                <span className="sound-load-status">
                  {assetLoadError ? (
                    <button onClick={() => {
                      setAssetLoadError("");
                      setLoadedAssetCount(0);
                      setAssetLoadAttempt((attempt) => attempt + 1);
                    }}>Retry sound assets</button>
                  ) : `Loading sound assets… ${loadedAssetCount}/4`}
                </span>
              ) : null}
              <button className="nav-button fullscreen-button" onClick={toggleFullscreen}>
                {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </>
          ) : null}
          {page === "admin" && authUser ? (
            <button className="nav-button sign-out-button" onClick={handleSignOut}>
              Sign Out
            </button>
          ) : null}
        </div>
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
            <div className="tv-metrics-header">
              <div className="tv-active-entries">
                <span>Active Entries</span>
                <strong>{totalEntries}</strong>
              </div>
              <div className="wins-block">
                {winsTarget > 0 ? (
                  <div className="wins-target">
                    Target <strong>{winsTarget}</strong>
                  </div>
                ) : null}
                <h1 className="wins-title">
                  TOTAL WINS:{" "}
                  <span
                    className={`wins-celebration ${winsAnimation ? `is-${winsAnimation.direction}` : ""}`}
                    key={winsAnimation?.id ?? "wins-idle"}
                  >
                    <span className="wins-number">{wins}</span>
                    {winsAnimation?.direction === "increase" ? (
                      <span className="wins-delta">+{winsAnimation.delta} {winsAnimation.delta === 1 ? "WIN" : "WINS"}</span>
                    ) : null}
                    <span className="win-sparkle sparkle-one" aria-hidden="true">✦</span>
                    <span className="win-sparkle sparkle-two" aria-hidden="true">✦</span>
                    <span className="win-sparkle sparkle-three" aria-hidden="true">✦</span>
                  </span>
                </h1>
              </div>
              <div className={`tv-live-status is-${tvConnection.state}`}>
                <span aria-hidden="true" />
                {tvConnection.label}
              </div>
            </div>
            <BoardTable board={board} now={now} />
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
                {lastUpdatedAt ? (
                  <div className="sync-status">Last updated {new Date(lastUpdatedAt).toLocaleString()}</div>
                ) : null}
                {authUser ? <div className="sync-status">Signed in as {authUser.email}</div> : null}
              </div>
            </div>

            <div className="admin-actions">
              {ANNOUNCEMENT_EDITOR_EMAILS.includes(authUser?.email.toLowerCase() ?? "") ? (
                <div className="announcement-editor">
                  <label>
                    <span>TV announcement</span>
                    <input
                      value={announcementInput}
                      maxLength={ANNOUNCEMENT_MAX_LENGTH}
                      placeholder="Leave blank to hide the banner"
                      onChange={(event) => {
                        isAnnouncementDirty.current = true;
                        setAnnouncementInput(event.target.value);
                        setAnnouncementSaveMessage("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveAnnouncementInput();
                      }}
                    />
                  </label>
                  <button
                    className="primary-action-button"
                    disabled={isSavingAnnouncement || announcementInput.trim() === announcement}
                    onClick={() => void saveAnnouncementInput()}
                  >
                    {isSavingAnnouncement ? "Saving…" : "Save announcement"}
                  </button>
                  {announcementSaveMessage ? <span>{announcementSaveMessage}</span> : null}
                </div>
              ) : null}
              <div className="wins-editor-controls">
                <label className={`wins-editor ${winsAnimation ? `is-${winsAnimation.direction}` : ""}`}>
                  <span>
                    Total Wins
                    {isWinsDirty ? <strong className="unsaved-indicator">Unsaved</strong> : null}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={winsInput}
                    onFocus={(event) => {
                      isWinsInputFocused.current = true;
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      setWinsInput(event.target.value);
                      setIsWinsDirty(true);
                      setWinsSaveMessage("");
                    }}
                    onBlur={() => {
                      isWinsInputFocused.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveWinsInput();
                      if (event.key === "Escape") {
                        setWinsInput(String(wins));
                        setIsWinsDirty(false);
                        setWinsSaveMessage("");
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="primary-action-button save-wins-button"
                  onClick={() => void saveWinsInput()}
                  disabled={!isWinsDirty || isSavingWins}
                >
                  {isSavingWins ? "Saving…" : "Save"}
                </button>
                {winsSaveMessage ? (
                  <span className={`wins-save-message ${winsSaveMessage.includes("failed") || winsSaveMessage.startsWith("Enter") ? "is-error" : ""}`}>
                    {winsSaveMessage}
                  </span>
                ) : null}
              </div>

              <div className="wins-editor-controls">
                <label className="wins-editor">
                  <span>
                    Win Target
                    {isWinsTargetDirty ? <strong className="unsaved-indicator">Unsaved</strong> : null}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={winsTargetInput}
                    onFocus={(event) => {
                      isWinsTargetInputFocused.current = true;
                      event.currentTarget.select();
                    }}
                    onChange={(event) => {
                      setWinsTargetInput(event.target.value);
                      setIsWinsTargetDirty(true);
                      setWinsTargetSaveMessage("");
                    }}
                    onBlur={() => {
                      isWinsTargetInputFocused.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveWinsTargetInput();
                      if (event.key === "Escape") {
                        setWinsTargetInput(String(winsTarget));
                        setIsWinsTargetDirty(false);
                        setWinsTargetSaveMessage("");
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="primary-action-button save-wins-button"
                  onClick={() => void saveWinsTargetInput()}
                  disabled={!isWinsTargetDirty || isSavingWinsTarget}
                >
                  {isSavingWinsTarget ? "Saving…" : "Save"}
                </button>
                {winsTargetSaveMessage ? (
                  <span className={`wins-save-message ${winsTargetSaveMessage.includes("failed") || winsTargetSaveMessage.startsWith("Enter") ? "is-error" : ""}`}>
                    {winsTargetSaveMessage}
                  </span>
                ) : null}
              </div>

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

type FireworkParticle = {
  alpha: number;
  color: string;
  decay: number;
  gravity: number;
  trail: Array<{ x: number; y: number }>;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type FireworkRocket = FireworkParticle & { targetY: number };

function CanvasFireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const colors = ["#ffd95a", "#ff5d73", "#5ee7ff", "#8dff8a", "#ca8cff", "#ff9d4d", "#ffffff"];
    const rockets: FireworkRocket[] = [];
    const sparks: FireworkParticle[] = [];
    let animationFrame = 0;
    let nextLaunchAt = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const launchRocket = () => {
      const x = width * (0.08 + Math.random() * 0.84);
      const targetY = height * (0.1 + Math.random() * 0.48);
      rockets.push({
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        decay: 0,
        gravity: 0,
        targetY,
        trail: [],
        vx: (Math.random() - 0.5) * 1.1,
        vy: -(7.5 + Math.random() * 2.8),
        x,
        y: height + 12,
      });
    };

    const explode = (rocket: FireworkRocket) => {
      const particleCount = 30 + Math.floor(Math.random() * 18);
      if (sparks.length + particleCount > 280) {
        sparks.splice(0, sparks.length + particleCount - 280);
      }
      for (let index = 0; index < particleCount; index += 1) {
        const angle = (Math.PI * 2 * index) / particleCount + Math.random() * 0.08;
        const speed = 1.5 + Math.random() * 5.2;
        sparks.push({
          alpha: 1,
          color: Math.random() > 0.18 ? rocket.color : colors[Math.floor(Math.random() * colors.length)],
          decay: 0.009 + Math.random() * 0.012,
          gravity: 0.045 + Math.random() * 0.025,
          trail: [],
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          x: rocket.x,
          y: rocket.y,
        });
      }
    };

    const drawTrail = (particle: FireworkParticle, lineWidth: number) => {
      if (!particle.trail.length) return;
      context.beginPath();
      context.moveTo(particle.trail[0].x, particle.trail[0].y);
      particle.trail.forEach((point) => context.lineTo(point.x, point.y));
      context.lineTo(particle.x, particle.y);
      context.globalAlpha = particle.alpha;
      context.strokeStyle = particle.color;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.stroke();
    };

    const animate = (time: number) => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      if (time >= nextLaunchAt) {
        launchRocket();
        if (Math.random() > 0.9 && sparks.length < 220) launchRocket();
        nextLaunchAt = time + 600 + Math.random() * 600;
      }

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index];
        rocket.trail.push({ x: rocket.x, y: rocket.y });
        if (rocket.trail.length > 7) rocket.trail.shift();
        rocket.x += rocket.vx;
        rocket.y += rocket.vy;
        rocket.vy += 0.025;
        drawTrail(rocket, 2.2);
        if (rocket.y <= rocket.targetY || rocket.vy >= -1.2) {
          explode(rocket);
          rockets.splice(index, 1);
        }
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.trail.push({ x: spark.x, y: spark.y });
        if (spark.trail.length > 3) spark.trail.shift();
        spark.vx *= 0.985;
        spark.vy = spark.vy * 0.985 + spark.gravity;
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.alpha -= spark.decay;
        drawTrail(spark, 1.45);
        if (spark.alpha <= 0) sparks.splice(index, 1);
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      animationFrame = window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fireworks-canvas" aria-hidden="true" />;
}

function BoardTable({ board, now }: { board: BoardState; now: Date }) {
  return (
    <div className="modern-board">
      {stageConfig.map((stage, stageIndex) => {
        const entries = board[stage.key];

        return (
          <section className={`stage-card stage-${stage.key}`} key={stage.key}>
            <div className="stage-header">
              <div>
                <h2>{stage.title}</h2>
                <p>{stage.metaTitle}</p>
              </div>
              <span className="stage-count">{entries.length}</span>
            </div>

            <AutoScrollingStageList entries={entries} now={now} stageIndex={stageIndex} />
          </section>
        );
      })}
    </div>
  );
}

function AutoScrollingStageList({
  entries,
  now,
  stageIndex,
}: {
  entries: BoardEntry[];
  now: Date;
  stageIndex: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentStartRef = useRef(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(entries.length || 1);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const rows = Array.from(content.querySelectorAll<HTMLElement>(".stage-row"));
      const firstRow = rows[0];
      const secondRow = rows[1];
      const rowStep = firstRow
        ? secondRow
          ? secondRow.offsetTop - firstRow.offsetTop
          : firstRow.offsetHeight
        : 1;
      const nextVisibleCount = Math.max(1, Math.floor((viewport.clientHeight + 1) / Math.max(1, rowStep)));
      setVisibleCount(Math.min(entries.length || 1, nextVisibleCount));
      setHasOverflow(content.scrollHeight > viewport.clientHeight + 2);
      currentStartRef.current = 0;
      setStartIndex(0);
      viewport.scrollTop = 0;
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    const initialFrame = window.requestAnimationFrame(measure);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      observer.disconnect();
    };
  }, [entries]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !hasOverflow || isPaused || prefersReducedMotion) return;

    let timer: number;
    let resetTimer: number | undefined;
    const scrollToIndex = (index: number) => {
      const rows = content.querySelectorAll<HTMLElement>(".stage-row");
      viewport.scrollTo({ behavior: "smooth", top: rows[index]?.offsetTop ?? 0 });
      currentStartRef.current = index;
      setStartIndex(index);
    };

    const advance = () => {
      const maximumStart = Math.max(0, entries.length - visibleCount);
      if (currentStartRef.current >= maximumStart) {
        timer = window.setTimeout(() => {
          setIsResetting(true);
          resetTimer = window.setTimeout(() => {
            scrollToIndex(0);
            setIsResetting(false);
            timer = window.setTimeout(advance, 5000);
          }, 260);
        }, 6000);
        return;
      }

      scrollToIndex(currentStartRef.current + 1);
      timer = window.setTimeout(advance, 4000);
    };

    timer = window.setTimeout(advance, 5000 + stageIndex * 1000);
    return () => {
      window.clearTimeout(timer);
      if (resetTimer) window.clearTimeout(resetTimer);
    };
  }, [entries.length, hasOverflow, isPaused, prefersReducedMotion, stageIndex, visibleCount]);

  const visibleEnd = Math.min(entries.length, startIndex + visibleCount);

  return (
    <div
      className={`stage-list-viewport ${hasOverflow ? "has-overflow" : ""} ${isResetting ? "is-resetting" : ""}`}
      ref={viewportRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="stage-list" ref={contentRef}>
        {entries.length ? entries.map((entry) => (
          <div className="stage-row" key={entry.id}>
            <div className="person-details">
              <span className="person-name">{entry.name}</span>
              {entry.adminInCharge ? <span className="person-owner">Admin: {entry.adminInCharge}</span> : null}
              {entry.notes ? (
                <span className="person-notes">
                  <span>NOTE</span>
                  {entry.notes}
                </span>
              ) : null}
              {entry.updatedAt ? (
                <span className="person-updated" title={new Date(entry.updatedAt).toLocaleString()}>
                  Updated {formatRelativeUpdated(entry.updatedAt, now)}
                </span>
              ) : null}
            </div>
            <span className={getBadgeClass(entry.status)}>{entry.status || " "}</span>
          </div>
        )) : <div className="stage-row empty-row" aria-hidden="true" />}
      </div>
      {hasOverflow ? (
        <div className="stage-scroll-status" aria-hidden="true">
          {startIndex + 1}–{visibleEnd} of {entries.length}
        </div>
      ) : null}
    </div>
  );
}
