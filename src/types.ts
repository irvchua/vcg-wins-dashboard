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
  position?: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  version?: number;
};
