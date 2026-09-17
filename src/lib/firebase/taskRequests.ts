import type { TaskEntry } from "../../types";

export class TaskRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TaskRequestError";
    this.status = status;
  }
}

// Retain unresolved requests across route changes without persisting private notes
// in browser storage. Each attempt belongs to one account, board, and appeal.
export const pendingFollowUpRequests = new Map<string, { task: TaskEntry; requestId: string }>();

export function followUpRequestKey(boardId: string | undefined, userId: string | undefined, recordId: number): string {
  return JSON.stringify([boardId, userId, recordId]);
}

export function discardRejectedFollowUpRequest(key: string, error: unknown): boolean {
  // A 400 validation rejection makes no writes. Other failures can occur after
  // an earlier request committed, so keep the original payload for a safe retry.
  if (!(error instanceof TaskRequestError) || error.status !== 400) return false;
  pendingFollowUpRequests.delete(key);
  return true;
}
