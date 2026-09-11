import test from "node:test";
import assert from "node:assert/strict";
import { buildNotification } from "../server/notification.js";

const task = { title: "Review proposal", assignedToEmail: "person@veteranschoiceglobal.com", status: "todo", dueDate: "2026-09-11" };
const url = "https://example.com";
test("creation and reassignment notify the current assignee", () => {
  assert.deepEqual(buildNotification(null, task, url).to, [task.assignedToEmail]);
  assert.match(buildNotification({ ...task, assignedToEmail: "old@jcmchcorp.com" }, task, url).text, /assigned to you/);
});
test("status changes include the pending due date request", () => {
  assert.match(buildNotification(task, { ...task, status: "blocked", dueDateReviewRequired: true }, url).text, /review and confirm/);
});
test("due date changes notify but reordering and unrelated edits do not", () => {
  assert.match(buildNotification(task, { ...task, dueDate: "2026-09-15" }, url).text, /2026-09-15/);
  assert.equal(buildNotification(task, { ...task, position: 4, title: "Updated" }, url), null);
});
test("deletions and external recipients do not send", () => {
  assert.equal(buildNotification(task, null, url), null);
  assert.equal(buildNotification(null, { ...task, assignedToEmail: "person@example.com" }, url), null);
});
test("completed tasks do not request due date review", () => {
  assert.doesNotMatch(buildNotification(task, { ...task, status: "done", dueDateReviewRequired: true }, url).text, /review and confirm/);
});
