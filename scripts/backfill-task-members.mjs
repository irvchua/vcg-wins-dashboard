// One-time backfill: seed the Tasks assignee directory (taskBoards/{boardId}/members)
// from existing Firebase Authentication users, so people who signed in before this
// feature existed don't have to sign in again just to show up in the assignee dropdown.
//
// This is a standalone operational script, not part of the app itself — it uses the
// Firebase Admin SDK (which can list all Auth users; the app's own client-side code
// deliberately can't, see README) and writes directly to Firestore with full admin
// privileges, bypassing firestore.rules entirely. Run it once, then delete the service
// account key.
//
// Usage:
//   node scripts/backfill-task-members.mjs <path-to-service-account.json> <tasksBoardId> [--apply]
//
// Without --apply this only PRINTS what it would write (dry run, default and safe).
// Pass --apply to actually write to Firestore.
//
// Get the service account key from: Firebase Console -> Project Settings ->
// Service Accounts -> Generate new private key. That file grants full admin access
// to your Firebase project — keep it outside this repo (the repo's .gitignore also
// blocks common service-account filename patterns as a backstop) and delete it once
// you're done running this.

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Mirrors src/lib/firebase/auth.ts's authorizedDomains.
const AUTHORIZED_DOMAINS = ["jcmchcorp.com", "veteranschoiceglobal.com"];

const [, , serviceAccountPath, tasksBoardId, ...flags] = process.argv;
const shouldApply = flags.includes("--apply");

if (!serviceAccountPath || !tasksBoardId) {
  console.error("Usage: node scripts/backfill-task-members.mjs <service-account.json> <tasksBoardId> [--apply]");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const db = getFirestore();

// Mirrors the fallback name logic in src/lib/firebase/auth.ts's toAuthUser, so
// backfilled entries look the same as ones the app writes itself.
function fallbackName(email) {
  const derived = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return derived || "Team member";
}

function isApprovedEmail(email) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return AUTHORIZED_DOMAINS.includes(domain);
}

async function listAllUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function main() {
  console.log("Scanning Firebase Authentication users...");
  const users = await listAllUsers();

  const candidates = users
    .filter((user) => user.email && user.emailVerified && isApprovedEmail(user.email))
    .map((user) => ({
      uid: user.uid,
      email: user.email,
      name: user.displayName?.trim() || fallbackName(user.email),
    }));

  const skipped = users.length - candidates.length;
  console.log(`Found ${users.length} total auth user(s); ${candidates.length} match an approved domain with a verified email; ${skipped} skipped.`);

  if (!candidates.length) {
    console.log("Nothing to write.");
    return;
  }

  console.log(`\nTarget: taskBoards/${tasksBoardId}/members\n`);
  candidates.forEach((candidate) => console.log(`  ${candidate.email}  (${candidate.name})`));

  if (!shouldApply) {
    console.log(`\nDry run only -- no writes made. Re-run with --apply to write ${candidates.length} member document(s).`);
    return;
  }

  const membersRef = db.collection("taskBoards").doc(tasksBoardId).collection("members");
  const chunkSize = 450; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const batch = db.batch();
    chunk.forEach((candidate) => {
      batch.set(membersRef.doc(candidate.uid), {
        email: candidate.email,
        name: candidate.name,
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
    console.log(`Wrote ${Math.min(i + chunkSize, candidates.length)}/${candidates.length}`);
  }

  console.log(`\nDone. ${candidates.length} member document(s) written to taskBoards/${tasksBoardId}/members.`);
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
