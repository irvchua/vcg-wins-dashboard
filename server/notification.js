const statuses = { todo: "To Do", inProgress: "In Progress", blocked: "Blocked", done: "Done" };

export function buildNotification(before, after, appUrl) {
  if (!after || !/^[^\s@]+@(jcmchcorp\.com|veteranschoiceglobal\.com)$/.test(after.assignedToEmail ?? "")) return null;
  const changes = [];
  if (!before || before.assignedToEmail !== after.assignedToEmail) changes.push("A task has been assigned to you.");
  if (before && before.status !== after.status) changes.push(`Status changed from ${statuses[before.status] ?? before.status} to ${statuses[after.status] ?? after.status}.`);
  if (before && (before.dueDate ?? "") !== (after.dueDate ?? "")) changes.push(`Due date changed to ${after.dueDate || "not set"}.`);
  if (!changes.length) return null;
  if (after.dueDateReviewRequired && after.status !== "done") changes.push("Please open the task and review and confirm the due date for its current status.");
  return {
    to: [after.assignedToEmail],
    subject: `Task update: ${String(after.title).replace(/[\r\n]/g, " ").slice(0, 160)}`,
    text: [after.title, ...changes, `Status: ${statuses[after.status] ?? after.status}`, `Due: ${after.dueDate || "Not set"}`, `Updated by: ${after.updatedBy || after.createdBy || "Team member"}`, `Open Tasks: ${new URL("/tasks", appUrl).href}`].join("\n\n"),
  };
}
