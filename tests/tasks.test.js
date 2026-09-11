import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/tasks.js";
import { prepareTask } from "../server/task-policy.js";
import { mutateTask, deliverNotification } from "../server/task-service.js";

const user = { uid: "assignee", email: "person@veteranschoiceglobal.com", email_verified: true, name: "Person" };
const admin = { uid: "admin", email: "admin@veteranschoiceglobal.com", email_verified: true };
const task = { id: "task1", title: "Proposal", assignedTo: "Person", assignedToEmail: user.email, assignedByEmail: admin.email, status: "todo", priority: "medium", dueDate: "2026-09-11", version: 1 };
const config = { boardId: "test", emailEnabled: true, sender: "Tasks <tasks@updates.veteranschoiceglobal.com>", appUrl: "https://example.com" };
const now = "2026-09-08T00:00:00Z";
function database(initial = {}) {
  const data = new Map(Object.entries(initial));
  const ref = (path) => ({ path, id: path.split("/").at(-1), collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }), update: async (change) => data.set(path, { ...data.get(path), ...change }) });
  return {
    data, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (r) => ({ exists: data.has(r.path), data: () => data.get(r.path) }),
        set: (r, value) => writes.push(() => data.set(r.path, value)),
        update: (r, value) => writes.push(() => data.set(r.path, { ...data.get(r.path), ...value })),
        delete: (r) => writes.push(() => data.delete(r.path)),
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
}
const expectStatus = (status) => (error) => error.status === status;

test("assignee cannot edit To Do date but assigner can", () => {
  assert.throws(() => prepareTask({ ...task, dueDate: "2026-09-12" }, task, user, false, false, now), expectStatus(403));
  assert.equal(prepareTask({ ...task, dueDate: "2026-09-12" }, task, admin, true, false, now).dueDate, "2026-09-12");
  const otherAdmin = { ...admin, email: "another@veteranschoiceglobal.com" };
  assert.throws(() => prepareTask({ ...task, dueDate: "2026-09-12" }, task, otherAdmin, true, false, now), expectStatus(403));
});
test("assignee must confirm active status date; administrator leaves review pending", () => {
  assert.throws(() => prepareTask({ ...task, status: "inProgress" }, task, user, false, false, now), expectStatus(400));
  assert.equal(prepareTask({ ...task, status: "inProgress" }, task, user, false, true, now).dueDateReviewRequired, false);
  assert.equal(prepareTask({ ...task, status: "blocked", dueDateReviewRequired: false }, task, admin, true, true, now).dueDateReviewRequired, true);
  assert.equal(prepareTask({ ...task, status: "done" }, task, user, false, false, now).dueDateReviewRequired, false);
});
test("server derives ownership and audit fields; cannot forge assigner", () => {
  const result = prepareTask({ ...task, assignedByEmail: user.email, createdBy: "Forged", version: 90 }, task, user, false, false, now);
  assert.equal(result.assignedByEmail, admin.email);
  assert.equal(result.version, 2);
  assert.equal(result.updatedBy, user.name);
});
test("invalid dates and external recipients are rejected", () => {
  assert.throws(() => prepareTask({ ...task, dueDate: "2026-02-30" }, task, admin, true, false, now), expectStatus(400));
  assert.throws(() => prepareTask({ ...task, assignedToEmail: "outside@example.com" }, task, admin, true, false, now), expectStatus(400));
});
test("atomic save records one email; duplicate request does not mutate again", async () => {
  const db = database();
  const body = { action: "create", task, requestId: "request1", boardId: "test" };
  const first = await mutateTask(db, admin, body, config);
  const second = await mutateTask(db, admin, body, config);
  assert.equal(first.receiptRef.id, second.receiptRef.id);
  assert.equal(db.data.size, 2);
  assert.equal(second.receipt.result.version, 1);
  assert.equal(second.receipt.message.to[0], user.email);
  await assert.rejects(mutateTask(db, admin, { ...body, task: { ...task, title: "Different" } }, config), expectStatus(409));
});
test("wrong boards, unverified users, unauthorized reassignment and stale writes fail", async () => {
  const db = database({ "taskBoards/test/tasks/task1": task });
  const body = { action: "update", task, expectedVersion: 1, requestId: "request1", boardId: "test" };
  await assert.rejects(mutateTask(db, user, { ...body, boardId: "production" }, config), expectStatus(400));
  await assert.rejects(mutateTask(db, { ...user, email_verified: false }, body, config), expectStatus(403));
  await assert.rejects(mutateTask(db, user, { ...body, expectedVersion: 0 }, config), expectStatus(409));
  await assert.rejects(mutateTask(db, user, { ...body, task: { ...task, assignedToEmail: admin.email } }, config), expectStatus(403));
  await assert.rejects(mutateTask(db, { ...user, email: "other@jcmchcorp.com" }, body, config), expectStatus(403));
  assert.equal(db.data.size, 1);
});
test("only administrators can delete; reordering cannot bypass status review", async () => {
  const db = database({ "taskBoards/test/tasks/task1": task });
  await assert.rejects(mutateTask(db, user, { action: "delete", task, expectedVersion: 1, requestId: "delete1", boardId: "test" }, config), expectStatus(403));
  await assert.rejects(mutateTask(db, user, { action: "reorder", entries: [{ id: task.id, status: "done", position: 0, version: 1 }], requestId: "move1", boardId: "test" }, config), expectStatus(400));
  assert.equal(db.data.get("taskBoards/test/tasks/task1").status, "todo");
});
test("preview email suppression still saves task", async () => {
  const saved = await mutateTask(database(), admin, { action: "create", task, requestId: "request1", boardId: "test" }, { ...config, emailEnabled: false });
  assert.equal(saved.receipt.emailStatus, "skipped");
  assert.equal(saved.receipt.message, null);
});
test("delivery failures preserve save and retries reuse the exact payload and idempotency key", async () => {
  const db = database();
  const saved = await mutateTask(db, admin, { action: "create", task, requestId: "request1", boardId: "test" }, config);
  const requests = [];
  const send = async (_url, request) => { requests.push(request); return { ok: requests.length > 1 }; };
  assert.equal(await deliverNotification(saved.receiptRef, saved.receipt, "fake-key", send), "pending");
  assert.ok(db.data.has("taskBoards/test/tasks/task1"));
  assert.equal(await deliverNotification(saved.receiptRef, saved.receipt, "fake-key", send), "sent");
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  await deliverNotification(saved.receiptRef, db.data.get(saved.receiptRef.path), "fake-key", send);
  assert.equal(requests.length, 2);
});
test("expired pending notifications do not resend beyond deduplication window", async () => {
  const ref = { update: async () => {} };
  const status = await deliverNotification(ref, { emailStatus: "pending", createdAt: "2020-01-01T00:00:00Z" }, "fake-key", () => assert.fail("Must not send"));
  assert.equal(status, "expired");
});
test("API rejects unsupported methods and unauthenticated requests before loading credentials", async () => {
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; } };
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 405);
  await handler({ method: "POST", headers: {} }, res);
  assert.equal(res.code, 401);
});
