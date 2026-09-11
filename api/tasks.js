import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { TaskApiError, assertActor, validId } from "../server/task-policy.js";
import { deliverNotification, mutateTask } from "../server/task-service.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
  if (!token) return res.status(401).json({ error: "Sign in to manage tasks." });
  try {
    const boardId = process.env.TASKS_BOARD_ID;
    const emailEnabled = process.env.TASK_EMAIL_ENABLED === "true";
    const sender = process.env.TASK_EMAIL_FROM;
    const appUrl = process.env.TASK_APP_URL;
    const apiKey = process.env.RESEND_API_KEY;
    if (!boardId || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON || (emailEnabled && (!sender || !appUrl || !apiKey))) throw new TaskApiError(503, "Task server configuration is incomplete.");
    const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    let user;
    try { user = await getAuth(app).verifyIdToken(token, true); }
    catch { throw new TaskApiError(401, "Your session has expired. Sign in again."); }
    assertActor(user);
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 100000) throw new TaskApiError(400, "Invalid request.");
    const db = getFirestore(app);
    let delivery;
    if (body.action === "retryEmail") {
      if (!validId(body.receiptId)) throw new TaskApiError(400, "Invalid notification.");
      const receiptRef = db.collection("taskApiRequests").doc(body.receiptId);
      const receipt = (await receiptRef.get()).data();
      if (!receipt || receipt.uid !== user.uid || receipt.boardId !== boardId) throw new TaskApiError(403, "Notification unavailable.");
      if (!emailEnabled) throw new TaskApiError(503, "Email delivery is disabled.");
      delivery = { receiptRef, receipt };
    } else {
      delivery = await mutateTask(db, user, body, { boardId, sender, appUrl, emailEnabled });
    }
    const emailStatus = await deliverNotification(delivery.receiptRef, delivery.receipt, apiKey);
    return res.status(200).json({ result: delivery.receipt.result, emailStatus, receiptId: delivery.receiptRef.id });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON request." });
    if (error instanceof TaskApiError) return res.status(error.status).json({ error: error.message });
    console.error("Task API failed", error.code || error.name);
    return res.status(500).json({ error: "Task could not be saved. Please try again." });
  }
}
