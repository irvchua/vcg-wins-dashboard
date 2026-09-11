import { timingSafeEqual } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runOverdueDigests } from "../server/overdue-digests.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "Reminder schedule is not configured." });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(req.headers.authorization || "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).json({ error: "Unauthorized." });
  if (process.env.TASK_EMAIL_ENABLED !== "true") return res.status(200).json({ skipped: "Email delivery is disabled." });
  try {
    const config = { boardId: process.env.TASKS_BOARD_ID, sender: process.env.TASK_EMAIL_FROM, appUrl: process.env.TASK_APP_URL, apiKey: process.env.RESEND_API_KEY };
    if (Object.values(config).some((value) => !value) || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return res.status(503).json({ error: "Reminder server configuration is incomplete." });
    const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    const dryRun = new URL(req.url, "https://localhost").searchParams.get("dryRun") === "1";
    const summary = await runOverdueDigests(getFirestore(app), config, { dryRun });
    console.info("Overdue reminder summary", summary);
    return res.status(summary.pending || summary.deferred || summary.expired ? 503 : 200).json(summary);
  } catch (error) {
    console.error("Overdue reminder job failed", error.code || error.name);
    return res.status(500).json({ error: "Reminder run failed. Check logs and retry." });
  }
}
