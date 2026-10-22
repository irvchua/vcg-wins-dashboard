import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../../styles/shared.css";
import "../Tasks/TasksPage.css";
import "./AppealsHoldPage.css";
import { useAuthUser } from "../../components/authContext";
import { signOutUser } from "../../lib/firebase/auth";
import {
  createAppealRecord,
  deleteAppealImages,
  deleteAppealRecord,
  isAppealsHoldFirebaseConfigured,
  loadAppealImageUrl,
  maxAppealImageSourceBytes,
  RecordConflictError,
  saveAppealRecord,
  subscribeToAppealRecords,
  uploadAppealImage,
  AppealImageReadError,
} from "../../lib/firebase/appealsHold";
import {
  createTask,
  isTasksFirebaseConfigured,
  registerTaskMember,
  tasksBoardId,
  subscribeToTaskMembers,
  subscribeToTaskAdminStatus,
  subscribeToTasks,
  type TaskMember,
} from "../../lib/firebase/tasks";
import {
  discardRejectedFollowUpRequest,
  followUpRequestKey,
  pendingFollowUpRequests,
} from "../../lib/firebase/taskRequests";
import type { AppealHoldEntry, AppealImage, AppealLink, HoldStatus, TaskEntry, TaskStatus } from "../../types";

type AppealDraft = Omit<AppealHoldEntry, "id" | "position" | "updatedAt" | "updatedBy" | "version" | "decisionLetterLinkOrDate">;

type DraftChange = (draft: AppealDraft) => Partial<AppealDraft>;

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
  instructionLetterUrl: "",
  decisionLetterDate: "",
  decisionLetterUrl: "",
  links: [],
  images: [],
  notes: "",
  actionNeeded: "",
  notesOnHoldStatus: "",
};

const draftFields = Object.keys(defaultDraft) as Array<keyof AppealDraft>;

function draftDiffers(draft: AppealDraft, initial: AppealDraft): boolean {
  return draftFields.some((field) => JSON.stringify(draft[field] ?? "") !== JSON.stringify(initial[field] ?? ""));
}

function createRecordId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function createUniqueId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function suggestedFollowUpDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Same order and labels as the Tasks board columns.
const taskStatusConfig: Array<{ key: TaskStatus; title: string }> = [
  { key: "todo", title: "TO DO" },
  { key: "inProgress", title: "IN PROGRESS" },
  { key: "blocked", title: "BLOCKED" },
  { key: "done", title: "DONE" },
];

function taskStatusTitle(status: TaskStatus): string {
  return taskStatusConfig.find((config) => config.key === status)?.title ?? status;
}

// Follow-up tasks link back to their appeal on the first line of the description
// (see submitFollowUpTask), which also identifies follow-ups created before this history existed.
function appealRecordIdForTask(task: TaskEntry): string | null {
  const firstLine = task.description?.split("\n", 1)[0].trim();
  if (!firstLine) return null;
  try {
    const url = new URL(firstLine);
    const recordId = url.searchParams.get("record");
    if ((url.protocol === "https:" || url.protocol === "http:") &&
        url.pathname === "/appeals-hold" && recordId && /^\d+$/.test(recordId)) {
      return recordId;
    }
  } catch {
    // Ordinary task notes do not have a source URL.
  }
  return null;
}

function formatTrailDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTrailDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Due dates are stored as calendar days (YYYY-MM-DD); parse them as local dates so
// they do not shift a day in time zones west of UTC.
function formatTrailDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split("-").map(Number);
  if (!year || !month || !day) return dueDate;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Only http(s) links are kept so a stored value can never become a javascript: href.
// Bare domains ("drive.google.com/…") are treated as https.
function toSafeUrl(value: string): string | null {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Validates the two letter links and the custom links together before a save.
function normalizeDraftLinks(draft: AppealDraft): { patch: Pick<AppealDraft, "instructionLetterUrl" | "decisionLetterUrl" | "links">; error: string } {
  const letterUrls = { instructionLetterUrl: "", decisionLetterUrl: "" };
  const letters = [["instructionLetterUrl", "Instruction Letter"], ["decisionLetterUrl", "Decision Letter"]] as const;
  for (const [field, name] of letters) {
    const rawUrl = draft[field].trim();
    if (!rawUrl) continue;
    const url = toSafeUrl(rawUrl);
    if (!url) return { patch: { ...letterUrls, links: draft.links }, error: `The ${name} link "${rawUrl}" is not a valid web link.` };
    letterUrls[field] = url;
  }
  const { links, error } = normalizeLinks(draft.links);
  return { patch: { ...letterUrls, links }, error };
}

function normalizeLinks(links: AppealLink[]): { links: AppealLink[]; error: string } {
  const normalized: AppealLink[] = [];
  for (const link of links) {
    const label = link.label.trim();
    const rawUrl = link.url.trim();
    if (!label && !rawUrl) continue;
    if (!rawUrl) return { links, error: `Add a URL for "${label}" or remove that link.` };
    const url = toSafeUrl(rawUrl);
    if (!url) return { links, error: `"${rawUrl}" is not a valid web link.` };
    normalized.push({ id: link.id, label: label || new URL(url).hostname, url });
  }
  return { links: normalized, error: "" };
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

function AppealImageThumbnail({ image, onOpen }: { image: AppealImage; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadAppealImageUrl(image)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch((error) => {
        console.error("Appeal image load failed:", error);
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, [image]);

  if (!url) {
    return <span className="appeals-hold-image-placeholder">{failed ? "Unavailable" : "Loading…"}</span>;
  }
  return (
    <button type="button" className="appeals-hold-image-open" title={image.name} aria-label={`View ${image.name}`} onClick={() => onOpen(url)}>
      <img src={url} alt="" />
    </button>
  );
}

function AppealImagePreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div
      className="appeals-hold-image-preview"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <button type="button" className="appeals-hold-image-preview-close" aria-label="Close image" autoFocus onClick={onClose}>
        ×
      </button>
      <img src={url} alt={name} />
    </div>
  );
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
  const [addRecordId, setAddRecordId] = useState(createRecordId);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [imageError, setImageError] = useState("");
  // Images uploaded in the open modal that are not saved on the row yet. They are deleted
  // from storage if the modal is dismissed without saving.
  const sessionUploadsRef = useRef<AppealImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Saved links render as hyperlinks; these are the ones switched back to text inputs.
  const [editingLinkKeys, setEditingLinkKeys] = useState<Set<string>>(() => new Set());
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

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
  const [followUpTasks, setFollowUpTasks] = useState<TaskEntry[]>([]);
  const [followUpTrailError, setFollowUpTrailError] = useState("");
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

  // Only task administrators can read every task, so the history is limited to them;
  // anyone else would see a partial history made up of their own assignments.
  useEffect(() => {
    if (!canCreateFollowUp) return;
    const unsubscribe = subscribeToTasks(
      { isAdmin: true },
      (tasks) => {
        setFollowUpTasks(tasks.filter((task) => appealRecordIdForTask(task) !== null));
        setFollowUpTrailError("");
      },
      (error) => {
        console.error("Follow-up history sync failed:", error);
        setFollowUpTasks([]);
        setFollowUpTrailError("Follow-up history is unavailable. Check your connection.");
      }
    );
    return () => unsubscribe?.();
  }, [canCreateFollowUp]);

  const followUpsByRecordId = useMemo(() => {
    const grouped = new Map<string, TaskEntry[]>();
    for (const task of followUpTasks) {
      const recordId = appealRecordIdForTask(task)!;
      grouped.set(recordId, [...(grouped.get(recordId) ?? []), task]);
    }
    for (const tasks of grouped.values()) {
      tasks.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    }
    return grouped;
  }, [followUpTasks]);

  const selectedFollowUps = selectedId !== null ? followUpsByRecordId.get(String(selectedId)) ?? [] : [];

  const hasUnsavedRowChanges = Boolean(editDraft && editInitial && draftDiffers(editDraft, editInitial));
  const isUploading = uploadingCount > 0;

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
        entry.instructionLetterUrl,
        entry.decisionLetterDate,
        entry.decisionLetterUrl,
        ...entry.links.flatMap((link) => [link.label, link.url]),
        ...entry.images.map((image) => image.name),
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

  function discardSessionUploads() {
    const pending = sessionUploadsRef.current;
    sessionUploadsRef.current = [];
    if (pending.length) void deleteAppealImages(pending);
  }

  async function handleImageFiles(recordId: number, files: File[], applyChange: (change: DraftChange) => void) {
    if (!files.length) return;
    const rejected = files.filter((file) => !file.type.startsWith("image/") || file.size > maxAppealImageSourceBytes);
    const accepted = files.filter((file) => !rejected.includes(file));
    setImageError(rejected.length
      ? `Skipped ${rejected.map((file) => file.name).join(", ")}: only images up to 25 MB can be attached.`
      : "");
    if (!accepted.length) return;

    setUploadingCount((count) => count + accepted.length);
    await Promise.all(accepted.map(async (file) => {
      try {
        const image = await uploadAppealImage(recordId, file, updaterName);
        if (!isPageMounted.current) {
          void deleteAppealImages([image]);
          return;
        }
        sessionUploadsRef.current = [...sessionUploadsRef.current, image];
        applyChange((draft) => ({ images: [...draft.images, image] }));
      } catch (error) {
        console.error("Appeal image upload failed:", error);
        const message = error instanceof AppealImageReadError ? error.message : `${file.name} could not be uploaded.`;
        setImageError((current) => [current, message].filter(Boolean).join(" "));
      } finally {
        if (isPageMounted.current) setUploadingCount((count) => count - 1);
      }
    }));
  }

  function removeDraftImage(image: AppealImage, applyChange: (change: DraftChange) => void) {
    // Unsaved uploads can go right away; saved images are deleted once the row is saved.
    if (sessionUploadsRef.current.some((upload) => upload.id === image.id)) {
      sessionUploadsRef.current = sessionUploadsRef.current.filter((upload) => upload.id !== image.id);
      void deleteAppealImages([image]);
    }
    applyChange((draft) => ({ images: draft.images.filter((item) => item.id !== image.id) }));
  }

  function openAddRecord() {
    setAddDraft(defaultDraft);
    setAddRecordId(createRecordId());
    setAddError("");
    setImageError("");
    setEditingLinkKeys(new Set());
    setIsAddOpen(true);
  }

  function closeAddRecord() {
    if (isUploading) return;
    discardSessionUploads();
    setIsAddOpen(false);
    setAddDraft(defaultDraft);
    setAddError("");
    setImageError("");
  }

  async function submitAddRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vetName = addDraft.vetName.trim();
    if (!vetName || isSaving || isCreatingFollowUp || isUploading) return;

    const { patch: linkFields, error: linkError } = normalizeDraftLinks(addDraft);
    if (linkError) {
      setAddError(linkError);
      return;
    }

    const newEntry: AppealHoldEntry = {
      ...addDraft,
      ...linkFields,
      id: addRecordId,
      vetName,
      position: entries.length,
    };

    setIsSaving(true);
    setAddError("");
    try {
      const saved = await createAppealRecord(newEntry, updaterName);
      sessionUploadsRef.current = [];
      setEntries((current) => [...current, saved]);
      closeAddRecord();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Row could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  function openEditRecord(entry: AppealHoldEntry, keepSessionUploads = false) {
    // "Reload latest" keeps images uploaded in this session so they aren't lost or orphaned.
    const carriedUploads = keepSessionUploads
      ? sessionUploadsRef.current.filter((upload) => !entry.images.some((image) => image.id === upload.id))
      : [];
    if (!keepSessionUploads) discardSessionUploads();
    setIsFollowUpLocked(pendingFollowUpRequests.has(followUpRequestKey(tasksBoardId, authUser?.id, entry.id)));
    setSelectedId(entry.id);
    setEditInitial({ ...entry });
    setEditDraft({ ...entry, images: [...entry.images, ...carriedUploads] });
    setEditingLinkKeys(new Set());
    setEditConflict("");
    setImageError("");
    setIsConfirmingDelete(false);
    setIsFollowUpOpen(false);
    setFollowUpAssigneeEmail("");
    setFollowUpDueDate("");
    setFollowUpError("");
    setFollowUpCreated(null);
  }

  function dismissEditRecord() {
    if (isCreatingFollowUp || isUploading) return;
    discardSessionUploads();
    setSelectedId(null);
    setEditInitial(null);
    setEditDraft(null);
    setEditConflict("");
    setImageError("");
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
      id: createUniqueId(),
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

    const requestId = pending?.requestId ?? createUniqueId();
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
    if (!selectedId || !editInitial || !editDraft || isSaving || isCreatingFollowUp || isUploading) return;

    const vetName = editDraft.vetName.trim();
    if (!vetName) {
      setEditConflict("Enter a veteran name before saving.");
      return;
    }

    const { patch: linkFields, error: linkError } = normalizeDraftLinks(editDraft);
    if (linkError) {
      setEditConflict(linkError);
      return;
    }

    const nextEntry: AppealHoldEntry = { ...editDraft, ...linkFields, vetName };
    if (!draftDiffers(nextEntry, editInitial)) {
      dismissEditRecord();
      return;
    }

    setIsSaving(true);
    setEditConflict("");
    try {
      const saved = await saveAppealRecord(nextEntry, editInitial.version ?? 1, updaterName);
      const removedImages = editInitial.images.filter((image) => !saved.images.some((item) => item.id === image.id));
      void deleteAppealImages(removedImages);
      sessionUploadsRef.current = [];
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
    if (!selectedId || !editInitial || isSaving || isCreatingFollowUp || isUploading) return;

    setIsSaving(true);
    try {
      await deleteAppealRecord(selectedId, editInitial.version ?? 1);
      void deleteAppealImages([...editInitial.images, ...sessionUploadsRef.current]);
      sessionUploadsRef.current = [];
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

  function startEditingLink(key: string) {
    setEditingLinkKeys((current) => new Set(current).add(key));
  }

  // A link shows as a hyperlink only while it still matches what is saved on the row, so
  // anything new or being typed stays an input.
  function savedHref(url: string, savedUrl: string | undefined, key: string): string | null {
    if (!savedUrl || url !== savedUrl || editingLinkKeys.has(key)) return null;
    return toSafeUrl(url);
  }

  function renderLetterFields(draft: AppealDraft, saved: AppealDraft | null, applyChange: (change: DraftChange) => void) {
    const letters = [
      { name: "Instruction Letter", dateField: "instructionDate", urlField: "instructionLetterUrl" },
      { name: "Decision Letter", dateField: "decisionLetterDate", urlField: "decisionLetterUrl" },
    ] as const;

    return letters.map(({ name, dateField, urlField }) => {
      const href = savedHref(draft[urlField], saved?.[urlField], urlField);
      return (
        <div className="task-modal-row" key={name}>
          <label className="modal-field">
            {name} Date
            <input
              value={draft[dateField]}
              onChange={(event) => {
                const value = event.target.value;
                applyChange(() => ({ [dateField]: value }));
              }}
            />
          </label>
          {href ? (
            <div className="modal-field">
              <span>{name} Link</span>
              <div className="appeals-hold-saved-link-row">
                <a className="appeals-hold-saved-link" href={href} target="_blank" rel="noopener noreferrer">
                  View {name}
                </a>
                <button type="button" className="appeals-hold-edit-link-button" onClick={() => startEditingLink(urlField)}>
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <label className="modal-field">
              {name} Link
              <input
                placeholder="https://…"
                inputMode="url"
                autoFocus={editingLinkKeys.has(urlField)}
                value={draft[urlField]}
                onChange={(event) => {
                  const value = event.target.value;
                  applyChange(() => ({ [urlField]: value }));
                }}
              />
            </label>
          )}
        </div>
      );
    });
  }

  // The board shows the letter's date as the link to the letter.
  function renderLetterCell(date: string, url: string) {
    const href = url ? toSafeUrl(url) : null;
    if (!href) return date || "—";
    return (
      <a className="appeals-hold-letter-link" href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
        {date || "View letter"}
      </a>
    );
  }

  function renderAttachmentFields(recordId: number, draft: AppealDraft, saved: AppealDraft | null, applyChange: (change: DraftChange) => void) {
    const updateLink = (id: string, patch: Partial<AppealLink>) =>
      applyChange((current) => ({ links: current.links.map((link) => (link.id === id ? { ...link, ...patch } : link)) }));

    return (
      <>
        <div className="modal-field appeals-hold-attachments" role="group" aria-labelledby={`links-heading-${recordId}`}>
          <span id={`links-heading-${recordId}`}>Other Links</span>
          {draft.links.map((link) => {
            const savedLink = saved?.links.find((item) => item.id === link.id);
            const href = savedLink?.label === link.label ? savedHref(link.url, savedLink.url, link.id) : null;
            const removeButton = (
              <button
                type="button"
                className="appeals-hold-remove-button"
                aria-label={`Remove link ${link.label || link.url}`}
                onClick={() => applyChange((current) => ({ links: current.links.filter((item) => item.id !== link.id) }))}
              >
                ×
              </button>
            );
            return href ? (
              <div className="appeals-hold-saved-link-row" key={link.id}>
                <a className="appeals-hold-saved-link" href={href} target="_blank" rel="noopener noreferrer">
                  {link.label || link.url}
                </a>
                <button type="button" className="appeals-hold-edit-link-button" onClick={() => startEditingLink(link.id)}>
                  Edit
                </button>
                {removeButton}
              </div>
            ) : (
            <div className="appeals-hold-link-row" key={link.id}>
              <input
                aria-label="Link label"
                placeholder="Label (e.g. C-File)"
                autoFocus={editingLinkKeys.has(link.id)}
                value={link.label}
                onChange={(event) => updateLink(link.id, { label: event.target.value })}
              />
              <input
                aria-label="Link URL"
                placeholder="https://…"
                inputMode="url"
                value={link.url}
                onChange={(event) => updateLink(link.id, { url: event.target.value })}
              />
              {removeButton}
            </div>
            );
          })}
          <button
            type="button"
            className="secondary-action-button appeals-hold-add-button"
            onClick={() => {
              const id = createUniqueId();
              startEditingLink(id);
              applyChange((current) => ({ links: [...current.links, { id, label: "", url: "" }] }));
            }}
          >
            + Add link
          </button>
        </div>

        <div className="modal-field appeals-hold-attachments" role="group" aria-labelledby={`images-heading-${recordId}`}>
          <span id={`images-heading-${recordId}`}>Images</span>
          {draft.images.length ? (
            <ul className="appeals-hold-image-grid">
              {draft.images.map((image) => (
                <li key={image.id}>
                  <AppealImageThumbnail image={image} onOpen={(url) => setPreviewImage({ url, name: image.name })} />
                  <button
                    type="button"
                    className="appeals-hold-remove-button"
                    aria-label={`Remove image ${image.name}`}
                    onClick={() => removeDraftImage(image, applyChange)}
                    disabled={isSaving}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void handleImageFiles(recordId, files, applyChange);
            }}
          />
          <button
            type="button"
            className="secondary-action-button appeals-hold-add-button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isSaving}
          >
            + Attach images
          </button>
          {isUploading ? <p className="appeals-hold-upload-status">Uploading {uploadingCount} image{uploadingCount === 1 ? "" : "s"}…</p> : null}
          {imageError ? <p className="tasks-sync-message" role="alert">{imageError}</p> : null}
        </div>
      </>
    );
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
                    <th>Instruction Letter</th>
                    <th>Decision Letter</th>
                    <th>Other Links</th>
                    <th>Notes</th>
                    <th>Action Needed</th>
                    <th>Notes On Hold Status</th>
                    {canCreateFollowUp ? <th>Follow-ups</th> : null}
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
                        <td>{renderLetterCell(entry.instructionDate, entry.instructionLetterUrl)}</td>
                        <td>{renderLetterCell(entry.decisionLetterDate, entry.decisionLetterUrl)}</td>
                        <td>
                          {entry.links.length ? (
                            <div className="appeals-hold-link-list">
                              {entry.links.map((link) => {
                                const href = toSafeUrl(link.url);
                                return href ? (
                                  <a key={link.id} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                                    {link.label || link.url}
                                  </a>
                                ) : null;
                              })}
                            </div>
                          ) : "—"}
                        </td>
                        <td>{entry.notes || "—"}</td>
                        <td>{entry.actionNeeded || "—"}</td>
                        <td>{entry.notesOnHoldStatus || "—"}</td>
                        {canCreateFollowUp ? (
                          <td>
                            {(() => {
                              const followUps = followUpsByRecordId.get(String(entry.id)) ?? [];
                              if (!followUps.length) return "—";
                              return (
                                <div className="appeals-hold-followup-counts">
                                  {taskStatusConfig.map(({ key, title }) => {
                                    const count = followUps.filter((task) => task.status === key).length;
                                    return count ? (
                                      <span key={key} className={`appeals-hold-task-status appeals-hold-task-status-${key}`}>
                                        {count} {title}
                                      </span>
                                    ) : null;
                                  })}
                                </div>
                              );
                            })()}
                          </td>
                        ) : null}
                        <td>{entry.updatedAt ? formatRelativeUpdated(entry.updatedAt, now) : "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={canCreateFollowUp ? 11 : 10} className="appeals-hold-table-empty">
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
              {renderLetterFields(addDraft, null, (change) => setAddDraft((draft) => ({ ...draft, ...change(draft) })))}
              {renderAttachmentFields(addRecordId, addDraft, null, (change) => setAddDraft((draft) => ({ ...draft, ...change(draft) })))}
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
                <button type="button" className="secondary-action-button" onClick={closeAddRecord} disabled={isSaving || isCreatingFollowUp || isUploading}>Cancel</button>
                <button type="submit" className="primary-action-button" disabled={isSaving || isCreatingFollowUp || isUploading}>{isSaving ? "Saving…" : "Add Row"}</button>
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
              {renderLetterFields(editDraft, editInitial, (change) => setEditDraft((draft) => draft && { ...draft, ...change(draft) }))}
              {renderAttachmentFields(editDraft.id, editDraft, editInitial, (change) => setEditDraft((draft) => draft && { ...draft, ...change(draft) }))}
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
                  <div className="appeals-hold-followup-trail">
                    <h3>Follow-up History</h3>
                    {followUpTrailError ? <p role="alert">{followUpTrailError}</p> : null}
                    {selectedFollowUps.length ? (
                      <ol>
                        {selectedFollowUps.map((task) => (
                          <li key={task.id} className={`appeals-hold-followup-trail-item-${task.status}`}>
                            <Link
                              to={`/tasks?task=${encodeURIComponent(task.id)}`}
                              className="appeals-hold-followup-trail-link"
                              aria-label={`Open ${task.title} on the task board`}
                              onClick={(event) => {
                                if (hasUnsavedRowChanges && !window.confirm("Leave without saving your row changes?")) event.preventDefault();
                              }}
                            >
                            <div className="appeals-hold-followup-trail-heading">
                              <span className="appeals-hold-followup-trail-title">{task.title}</span>
                              <span className={`appeals-hold-task-status appeals-hold-task-status-${task.status}`}>
                                {taskStatusTitle(task.status)}
                              </span>
                            </div>
                            <dl className="appeals-hold-followup-trail-dates">
                              <div>
                                <dt>Created</dt>
                                <dd title={formatTrailDateTime(task.createdAt)}>{formatTrailDate(task.createdAt) || "—"}</dd>
                              </div>
                              {task.status === "done" ? (
                                <div className="appeals-hold-followup-trail-date-done">
                                  <dt>Done</dt>
                                  {task.completedAt ? (
                                    <dd title={formatTrailDateTime(task.completedAt)}>{formatTrailDate(task.completedAt)}</dd>
                                  ) : (
                                    <dd title="This task was completed before completion dates were recorded; its last update is shown.">
                                      by {task.updatedAt ? formatTrailDate(task.updatedAt) : "—"}
                                    </dd>
                                  )}
                                </div>
                              ) : task.dueDate ? (
                                <div>
                                  <dt>Due</dt>
                                  <dd>{formatTrailDueDate(task.dueDate)}</dd>
                                </div>
                              ) : null}
                            </dl>
                            <div className="appeals-hold-followup-trail-meta">
                              Assigned to {task.assignedTo || task.assignedToEmail}
                              {task.createdBy ? ` · created by ${task.createdBy}` : ""}
                            </div>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    ) : followUpTrailError ? null : (
                      <p className="appeals-hold-followup-trail-empty">No follow-up tasks yet.</p>
                    )}
                  </div>
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
                    <button type="button" className="task-delete-action" onClick={() => setIsConfirmingDelete(true)} disabled={isSaving || isCreatingFollowUp || isUploading}>
                      Delete
                    </button>
                    <span className="task-actions-spacer" />
                    <button type="button" className="secondary-action-button" onClick={dismissEditRecord} disabled={isSaving || isCreatingFollowUp || isUploading}>Cancel</button>
                    <button type="submit" className="primary-action-button" disabled={isSaving || isCreatingFollowUp || isUploading}>
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
                      if (latest) openEditRecord(latest, true);
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
      {previewImage ? (
        <AppealImagePreview url={previewImage.url} name={previewImage.name} onClose={() => setPreviewImage(null)} />
      ) : null}
    </main>
  );
}
