import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { approvedEmail } from "./task-policy.js";
import { deliverNotification } from "./task-service.js";

export function manilaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function groupOverdueTasks(tasks, today) {
  const groups = new Map();
  for (const task of tasks) {
    const email = typeof task.assignedToEmail === "string" ? task.assignedToEmail.trim().toLowerCase() : "";
    const due = task.dueDate;
    if (!approvedEmail(email) || !["todo", "inProgress", "blocked"].includes(task.status)
      || typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due) || due >= today
      || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(task);
  }
  for (const tasks of groups.values()) tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));
  return groups;
}

export function buildOverdueDigest(email, tasks, today, config) {
  const statuses = { todo: "To Do", inProgress: "In Progress", blocked: "Blocked" };
  const lines = tasks.slice(0, 100).map((task) => {
    const days = Math.round((Date.parse(today) - Date.parse(task.dueDate)) / 86400000);
    const title = String(task.title || "Untitled task").replace(/[\r\n]/g, " ").slice(0, 300);
    return `• ${title}\n  Due ${task.dueDate} · ${days} ${days === 1 ? "day" : "days"} overdue · ${statuses[task.status]}`;
  });
  return {
    from: config.sender, to: [email],
    subject: `VCG Tasks: ${tasks.length} overdue ${tasks.length === 1 ? "task" : "tasks"} — ${today}`,
    text: [
      `Your overdue tasks as of ${today} (Manila time)`,
      "Please review these tasks and update their status or due date. For To Do deadlines, contact the assigner.",
      ...lines,
      ...(tasks.length > 100 ? [`Plus ${tasks.length - 100} more overdue tasks on the board.`] : []),
      `Open Tasks: ${new URL("/tasks", config.appUrl).href}`,
      "You receive one daily summary while you have overdue tasks. Completed tasks are excluded.",
    ].join("\n\n"),
  };
}

export async function runOverdueDigests(db, config, { dryRun = false, now = new Date(), send = fetch, pause = sleep, clock = Date.now } = {}) {
  const startedAt = clock();
  const today = manilaDate(now);
  const snapshot = await db.collection("taskBoards").doc(config.boardId).collection("tasks")
    .where("dueDate", "<", today).select("title", "dueDate", "status", "assignedToEmail").get();
  const groups = groupOverdueTasks(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })), today);
  const summary = { date: today, dryRun, assignees: groups.size, overdueTasks: [...groups.values()].reduce((count, tasks) => count + tasks.length, 0), sent: 0, alreadySent: 0, pending: 0, expired: 0, deferred: 0 };
  if (dryRun) return summary;

  let processed = 0;
  for (const [email, tasks] of groups) {
    // Leave room to return a useful failure response before Vercel's time limit.
    if (clock() - startedAt > 250000) { summary.deferred = groups.size - processed; break; }
    const id = createHash("sha256").update(`overdue:${config.boardId}:${today}:${email}`).digest("hex");
    const ref = db.collection("taskOverdueDigests").doc(id);
    const receipt = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return existing.data();
      // First invocation freezes the payload. Concurrent runs and retries must
      // reuse it with the same Resend idempotency key, even if tasks have changed.
      const created = { boardId: config.boardId, date: today, createdAt: now.toISOString(), emailStatus: "pending", message: buildOverdueDigest(email, tasks, today, config) };
      tx.set(ref, created);
      return created;
    });
    if (receipt.emailStatus === "sent") { summary.alreadySent++; processed++; continue; }
    let status = receipt.emailStatus;
    for (let attempt = 0; attempt < 3 && status === "pending"; attempt++) {
      // Pace sends below Resend's default rate limit, with bounded retries.
      await pause(attempt === 0 ? 800 : attempt * 2000);
      status = await deliverNotification(ref, receipt, config.apiKey, send);
    }
    if (status === "sent") summary.sent++;
    else if (status === "expired") summary.expired++;
    else summary.pending++;
    processed++;
  }
  return summary;
}
