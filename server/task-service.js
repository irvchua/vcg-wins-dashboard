import { createHash } from "node:crypto";
import { buildNotification } from "./notification.js";
import { TaskApiError, assertActor, assertOwner, assertVersion, prepareTask, validId } from "./task-policy.js";

// Task mutation and its immutable email payload commit together. Receipt IDs belong
// to one authenticated user, making client/network retries safe.
export async function mutateTask(db, user, body, config) {
  assertActor(user);
  if (!body || !validId(body.requestId) || body.boardId !== config.boardId) throw new TaskApiError(400, "Invalid task request or board.");
  const board = db.collection("taskBoards").doc(config.boardId);
  const receiptId = createHash("sha256").update(`${config.boardId}:${user.uid}:${body.requestId}`).digest("hex");
  const receiptRef = db.collection("taskApiRequests").doc(receiptId);
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const now = new Date().toISOString();
  const receipt = await db.runTransaction(async (tx) => {
    const existing = await tx.get(receiptRef);
    if (existing.exists) {
      const previous = existing.data();
      if (previous.fingerprint !== fingerprint) throw new TaskApiError(409, "This request ID has already been used.");
      return previous;
    }
    const isAdmin = user.email === "admin@veteranschoiceglobal.com" || (await tx.get(board.collection("admins").doc(user.email))).exists;
    let result;
    let message = null;
    if (body.action === "reorder") {
      if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 400 || body.entries.some((entry) => !validId(entry.id)) || new Set(body.entries.map((entry) => entry.id)).size !== body.entries.length) throw new TaskApiError(400, "Invalid reorder request.");
      const refs = body.entries.map((entry) => board.collection("tasks").doc(entry.id));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      result = body.entries.map((entry, i) => {
        const before = snapshots[i].data();
        assertOwner(before, user, isAdmin);
        assertVersion(before, entry.version);
        if (before.status !== entry.status || !Number.isInteger(entry.position) || entry.position < 0) throw new TaskApiError(400, "Reordering cannot change task status.");
        const change = { position: entry.position, version: entry.version + 1, updatedAt: now, updatedBy: user.name || user.email };
        tx.update(refs[i], change);
        return { ...entry, ...change };
      });
    } else {
      if (!validId(body.task?.id)) throw new TaskApiError(400, "Invalid task ID.");
      const ref = board.collection("tasks").doc(body.task.id);
      const snapshot = await tx.get(ref);
      const before = snapshot.data();
      if (body.action === "delete") {
        if (!isAdmin) throw new TaskApiError(403, "Only administrators can delete tasks.");
        assertVersion(before, body.expectedVersion);
        tx.delete(ref);
        result = null;
      } else {
        if (!["create", "update"].includes(body.action)) throw new TaskApiError(400, "Invalid action.");
        if (body.action === "create" && snapshot.exists) throw new TaskApiError(409, "This task already exists.");
        if (body.action === "update") {
          assertOwner(before, user, isAdmin);
          assertVersion(before, body.expectedVersion);
        }
        result = prepareTask(body.task, before, user, isAdmin, body.dueDateConfirmed, now);
        message = config.emailEnabled ? buildNotification(before, result, config.appUrl) : null;
        tx.set(ref, result);
      }
    }
    const saved = { uid: user.uid, boardId: config.boardId, fingerprint, result, message: message ? { from: config.sender, ...message } : null, emailStatus: message ? "pending" : "skipped", createdAt: now };
    tx.set(receiptRef, saved);
    return saved;
  });
  return { receiptRef, receipt };
}

export async function deliverNotification(receiptRef, receipt, apiKey, send = fetch) {
  if (receipt.emailStatus !== "pending") return receipt.emailStatus;
  // Stable payload and key across attempts, bounded by Resend's 24-hour window.
  if (Date.now() - Date.parse(receipt.createdAt) > 23 * 60 * 60 * 1000) {
    await receiptRef.update({ emailStatus: "expired" });
    return "expired";
  }
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": receiptRef.id },
      body: JSON.stringify(receipt.message), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await receiptRef.update({ emailStatus: "sent", sentAt: new Date().toISOString() });
    return "sent";
  } catch {
    console.error("Task email pending; retry required", receiptRef.id);
    return "pending";
  }
}
