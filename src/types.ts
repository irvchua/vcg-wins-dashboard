export type StatusLabel = "" | "ON PROCESS" | "UNDER QA REVIEW" | "APPEALS" | "CLAIMS";

export type StageKey = "appeals" | "claims526" | "reviewSignature" | "faxing" | "faxed";

export type BoardEntry = {
  id: number;
  position?: number;
  name: string;
  assignedTo: string;
  adminInCharge: string;
  status: StatusLabel;
  notes?: string;
  stageEnteredAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
};

export type BoardState = Record<StageKey, BoardEntry[]>;

export type ArchivedEntry = BoardEntry & {
  archivedAt: string;
  archivedFrom: StageKey;
};

export type ActivityEntry = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  recordName?: string;
};

export type TaskStatus = "todo" | "inProgress" | "blocked" | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskEntry = {
  id: string;
  title: string;
  description?: string;
  assignedTo: string;
  assignedToEmail: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  dueDateReviewRequired?: boolean;
  assignedByEmail?: string;
  position?: number;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
};

export type HoldStatus =
  | ""
  | "UNRESPONSIVE"
  | "REINSTATED"
  | "DONE"
  | "ACTION NEEDED"
  | "WAITING/REEVALUATION"
  | "NOT INTERESTED";

export type AppealLink = {
  id: string;
  label: string;
  url: string;
};

// Metadata only; the compressed image data lives in its own document at
// appealsHoldBoards/{boardId}/records/{recordId}/images/{id}.
export type AppealImage = {
  id: string;
  recordId: number;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
};

export type AppealHoldEntry = {
  id: number;
  vetName: string;
  holdStatus: HoldStatus;
  reasonOnHold: string;
  instructionDate: string;
  instructionLetterUrl: string;
  decisionLetterDate: string;
  decisionLetterUrl: string;
  links: AppealLink[];
  images: AppealImage[];
  /** Legacy combined field; migrated into decisionLetterDate/links on read. */
  decisionLetterLinkOrDate?: string;
  notes: string;
  actionNeeded: string;
  notesOnHoldStatus: string;
  position?: number;
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
};
