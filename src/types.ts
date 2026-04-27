export type StatusLabel = "" | "ON PROCESS" | "FOR CHECKING" | "APPEALS" | "CLAIMS";

export type StageKey = "appeals" | "claims526" | "reviewSignature" | "faxing" | "faxed";

export type BoardEntry = {
  id: number;
  name: string;
  assignedTo: string;
  adminInCharge: string;
  status: StatusLabel;
};

export type BoardState = Record<StageKey, BoardEntry[]>;
