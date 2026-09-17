// Local-only dev replacement for `vercel dev`'s /api/* functions.
//
// `vercel dev` sources server env vars (FIREBASE_SERVICE_ACCOUNT_JSON, TASKS_BOARD_ID,
// etc.) from the linked Vercel project's cloud "Development" environment, not from local
// .env files - see https://vercel.com/docs/cli/dev. If those vars aren't registered there,
// vercel dev returns "Task server configuration is incomplete." even when .env.local has
// them. This script runs the same api/tasks.js and api/overdue-reminders.js handlers
// directly in plain Node, reading env vars from .env.local instead.
//
// Usage:
//   node --env-file=.env.local scripts/local-api-server.mjs
//
// Then run `npm run dev` in another terminal (its vite.config.ts proxy already forwards
// /api/* to this server's port) and use the app at http://localhost:5173 as normal.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import tasksHandler from "../api/tasks.js";
import overdueRemindersHandler from "../api/overdue-reminders.js";

const routes = {
  "/api/tasks": tasksHandler,
  "/api/overdue-reminders": overdueRemindersHandler,
};

function withVercelStyleResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (res.destroyed || res.writableEnded) return;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };
  return res;
}

export async function handleLocalApiRequest(req, res) {
  withVercelStyleResponse(res);
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const handler = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (!handler) return res.status(404).json({ error: "Not found." });

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
    await handler(req, res);
  } catch (error) {
    if (req.aborted || res.destroyed || res.writableEnded) return;
    console.error("Local API handler failed:", error);
    res.status(500).json({ error: "Internal error." });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(handleLocalApiRequest);
  const port = Number(process.env.LOCAL_API_PORT) || 3000;
  server.listen(port, () => {
    console.log(`Local API shim listening on http://localhost:${port} (routes: ${Object.keys(routes).join(", ")})`);
  });
}
