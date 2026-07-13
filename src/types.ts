export type StatusLabel = "" | "ON PROCESS" | "FOR CHECKING" | "APPEALS" | "CLAIMS";

export type StageKey = "appeals" | "claims526" | "reviewSignature" | "faxing" | "faxed";

export type BoardEntry = {
  id: number;
  name: string;
  assignedTo: string;
  adminInCharge: string;
  status: StatusLabel;
  notes?: string;
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
