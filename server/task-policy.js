export class TaskApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const approvedEmail = (email) => typeof email === "string" && /^[^\s@]+@(jcmchcorp\.com|veteranschoiceglobal\.com)$/.test(email);
export const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const statuses = ["todo", "inProgress", "blocked", "done"];
const priorities = ["low", "medium", "high", "urgent"];
function requireCondition(condition, status, message) {
  if (!condition) throw new TaskApiError(status, message);
}
export function assertActor(user) {
  requireCondition(user?.email_verified === true && approvedEmail(user.email), 403, "Use a verified company account.");
}
export function assertOwner(task, user, isAdmin) {
  requireCondition(isAdmin || task?.assignedToEmail === user.email, 403, "You do not have access to this task.");
}
export function assertVersion(task, version) {
  requireCondition(task && Number.isInteger(version) && version === (task.version ?? 1), 409, "Another editor changed this task. Reload the latest version.");
}

export function prepareTask(input, before, user, isAdmin, confirmed, now) {
  requireCondition(input && typeof input === "object" && validId(input.id), 400, "Invalid task.");
  requireCondition(typeof input.title === "string" && input.title.trim().length > 0 && input.title.length <= 300, 400, "Enter a title of up to 300 characters.");
  const email = typeof input.assignedToEmail === "string" ? input.assignedToEmail.trim().toLowerCase() : "";
  requireCondition(approvedEmail(email), 400, "Select a company assignee.");
  assertOwner(before ?? { assignedToEmail: email }, user, isAdmin);
  requireCondition(isAdmin || email === user.email, 403, "Only administrators can reassign tasks.");
  requireCondition(statuses.includes(input.status) && priorities.includes(input.priority), 400, "Invalid status or priority.");
  requireCondition(typeof input.assignedTo === "string" && input.assignedTo.length <= 200, 400, "Invalid assignee name.");
  requireCondition(input.description == null || (typeof input.description === "string" && input.description.length <= 10000), 400, "Description is too long.");
  const dueDate = input.dueDate || "";
  requireCondition(typeof dueDate === "string" && (!dueDate || (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && Number.isFinite(Date.parse(dueDate)) && new Date(dueDate).toISOString().slice(0, 10) === dueDate)), 400, "Choose a valid due date.");
  requireCondition(input.position == null || (Number.isInteger(input.position) && input.position >= 0), 400, "Invalid task position.");
  const reassigned = before && before.assignedToEmail !== email;
  if (before && input.status === "todo" && dueDate !== (before.dueDate || "")) {
    requireCondition(before.assignedByEmail ? before.assignedByEmail === user.email : isAdmin, 403, "Only the assigner can change a To Do due date.");
  }
  const needsReview = Boolean(before && !["todo", "done"].includes(input.status) && (before.status !== input.status || before.dueDateReviewRequired || reassigned));
  if (needsReview && email === user.email) {
    requireCondition(confirmed === true && Boolean(dueDate), 400, "Choose and confirm the due date for this status.");
  }
  return {
    id: input.id, title: input.title.trim(), description: input.description?.trim() || "",
    assignedTo: input.assignedTo.trim(), assignedToEmail: email,
    assignedByEmail: !before || reassigned ? user.email : (before.assignedByEmail || ""),
    priority: input.priority, status: input.status, dueDate,
    dueDateReviewRequired: needsReview && email !== user.email,
    position: input.position ?? before?.position ?? 0,
    createdBy: before?.createdBy ?? user.name ?? user.email,
    createdAt: before?.createdAt ?? now,
    updatedBy: user.name || user.email, updatedAt: now, version: (before?.version ?? (before ? 1 : 0)) + 1,
  };
}
