import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/overdue-reminders.js";
import { manilaDate, groupOverdueTasks, buildOverdueDigest, runOverdueDigests } from "../server/overdue-digests.js";

const email = "person@veteranschoiceglobal.com";
const task = { id: "one", title: "Review proposal", dueDate: "2000-01-01", status: "todo", assignedToEmail: email };
const config = { boardId: "test", sender: "VCG Tasks <tasks@updates.veteranschoiceglobal.com>", appUrl: "https://example.com", apiKey: "fake-key" };
function database(tasks = [task]) {
  const receipts = new Map();
  let tail = Promise.resolve();
  function collection(path) {
    return {
      doc(id) {
        const key = `${path}/${id}`;
        return { id, key, collection: (name) => collection(`${key}/${name}`), update: async (data) => receipts.set(key, { ...receipts.get(key), ...data }) };
      },
      where(field, operation, value) {
        assert.equal(path, "taskBoards/test/tasks");
        assert.equal(field, "dueDate");
        assert.equal(operation, "<");
        return { select: () => ({ get: async () => ({ docs: tasks.filter((task) => task.dueDate < value).map((task) => ({ id: task.id, data: () => task })) }) }) };
      },
    };
  }
  return {
    receipts, collection,
    runTransaction(fn) {
      const run = tail.then(async () => fn({
        get: async (ref) => ({ exists: receipts.has(ref.key), data: () => receipts.get(ref.key) }),
        set: (ref, data) => receipts.set(ref.key, data),
      }));
      tail = run.catch(() => {});
      return run;
    },
  };
}
const pause = async () => {};

test("Manila day changes at 16:00 UTC including month and year boundaries", () => {
  assert.equal(manilaDate(new Date("2026-09-11T15:59:59Z")), "2026-09-11");
  assert.equal(manilaDate(new Date("2026-09-11T16:00:00Z")), "2026-09-12");
  assert.equal(manilaDate(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
});
test("only active, genuinely overdue company tasks are grouped", () => {
  const tasks = [task, { ...task, id: "two", status: "blocked", assignedToEmail: email.toUpperCase() },
    { ...task, id: "done", status: "done" }, { ...task, dueDate: "2026-09-11" },
    { ...task, dueDate: "2026-09-12" }, { ...task, dueDate: "" }, { ...task, dueDate: "2026-02-30" },
    { ...task, assignedToEmail: "outside@example.com" }, { ...task, status: "unknown" }];
  const groups = groupOverdueTasks(tasks, "2026-09-11");
  assert.equal(groups.size, 1);
  assert.equal(groups.get(email).length, 2);
});
test("digest is private, includes deadlines and days overdue, and bounds message size", () => {
  const tasks = Array.from({ length: 101 }, (_, id) => ({ ...task, id, dueDate: "2026-09-10" }));
  const message = buildOverdueDigest(email, tasks, "2026-09-11", config);
  assert.deepEqual(message.to, [email]);
  assert.match(message.text, /1 day overdue/);
  assert.match(message.text, /Plus 1 more/);
  assert.match(message.text, /https:\/\/example.com\/tasks/);
  assert.equal((message.text.match(/Review proposal/g) || []).length, 100);
});
test("dry run reads counts without sending or writing receipts", async () => {
  const db = database();
  const summary = await runOverdueDigests(db, config, { dryRun: true, send: () => assert.fail("Must not send"), pause });
  assert.equal(summary.assignees, 1);
  assert.equal(summary.overdueTasks, 1);
  assert.equal(db.receipts.size, 0);
});
test("no overdue work results in no emails", async () => {
  const db = database([{ ...task, status: "done" }]);
  const summary = await runOverdueDigests(db, config, { send: () => assert.fail("Must not send"), pause });
  assert.equal(summary.assignees, 0);
  assert.equal(db.receipts.size, 0);
});
test("one digest per assignee, repeat run skips success, next day allows a new digest", async () => {
  const db = database([task, { ...task, id: "two" }, { ...task, id: "three", assignedToEmail: "other@jcmchcorp.com" }]);
  const requests = [];
  const send = async (_url, request) => { requests.push(request); return { ok: true }; };
  const now = new Date();
  assert.equal((await runOverdueDigests(db, config, { send, pause, now })).sent, 2);
  assert.equal((await runOverdueDigests(db, config, { send, pause, now })).alreadySent, 2);
  assert.equal(requests.length, 2);
  assert.equal((await runOverdueDigests(db, config, { send, pause, now: new Date(now.getTime() + 86400000) })).sent, 2);
  assert.notEqual(requests[0].headers["Idempotency-Key"], requests[2].headers["Idempotency-Key"]);
});
test("failure retries reuse the exact message and idempotency key", async () => {
  const db = database();
  const requests = [];
  const send = async (_url, request) => { requests.push(request); return { ok: requests.length > 1 }; };
  const summary = await runOverdueDigests(db, config, { send, pause });
  assert.equal(summary.sent, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
});
test("concurrent calls share an immutable receipt and provider deduplication key", async () => {
  const db = database();
  const requests = [];
  const send = async (_url, request) => { requests.push(request); return { ok: true }; };
  await Promise.all([runOverdueDigests(db, config, { send, pause }), runOverdueDigests(db, config, { send, pause })]);
  assert.equal(db.receipts.size, 1);
  assert.equal(new Set(requests.map((r) => r.headers["Idempotency-Key"])).size, 1);
  assert.equal(new Set(requests.map((r) => r.body)).size, 1);
});
test("persistent delivery failure is reported after three attempts", async () => {
  const db = database();
  let attempts = 0;
  const summary = await runOverdueDigests(db, config, { send: async () => { attempts++; return { ok: false }; }, pause });
  assert.equal(attempts, 3);
  assert.equal(summary.pending, 1);
  assert.equal([...db.receipts.values()][0].emailStatus, "pending");
});
test("runtime budget reports deferred recipients without silently dropping them", async () => {
  const db = database();
  let calls = 0;
  const summary = await runOverdueDigests(db, config, { clock: () => calls++ === 0 ? 0 : 260000, pause });
  assert.equal(summary.deferred, 1);
  assert.equal(summary.sent, 0);
});
test("cron endpoint fails closed without a secret or with wrong authorization", async () => {
  const previous = process.env.CRON_SECRET;
  const enabled = process.env.TASK_EMAIL_ENABLED;
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.body = data; } };
  try {
    delete process.env.CRON_SECRET;
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.code, 503);
    process.env.CRON_SECRET = "test-cron-secret";
    await handler({ method: "GET", headers: { authorization: "Bearer wrong" } }, res);
    assert.equal(res.code, 401);
    await handler({ method: "POST", headers: {} }, res);
    assert.equal(res.code, 405);
    process.env.TASK_EMAIL_ENABLED = "false";
    await handler({ method: "GET", headers: { authorization: "Bearer test-cron-secret" } }, res);
    assert.equal(res.code, 200);
    assert.match(res.body.skipped, /disabled/);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    if (enabled === undefined) delete process.env.TASK_EMAIL_ENABLED; else process.env.TASK_EMAIL_ENABLED = enabled;
  }
});
