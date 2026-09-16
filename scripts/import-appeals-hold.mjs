// One-time import: load the "Appeals On Hold Status" data (originally tracked in a Google
// Sheet) into appealsHoldBoards/{boardId}/records so the /appeals-hold dashboard page has
// something to show. This mirrors scripts/backfill-task-members.mjs: it uses the Firebase
// Admin SDK (bypasses firestore.rules entirely) and writes directly to Firestore. Run it
// once, then delete the service account key if it isn't already in use elsewhere.
//
// Usage:
//   node scripts/import-appeals-hold.mjs <path-to-service-account.json> <appealsHoldBoardId> <path-to-data.csv> [--apply]
//
// <path-to-data.csv> should be the sheet exported as CSV (File -> Download -> Comma
// Separated Values) or a tab-separated paste of the rows, WITHOUT a header row, in column
// order: Vet Name, On Hold Status, Reason On Hold, Instruction Date, Decision Letter
// Link/Date, Notes, Action Needed, Notes On Hold Status. A header row is auto-detected and
// skipped if present.
//
// Without --apply this only PRINTS what it would write (dry run, default and safe).
// Pass --apply to actually write to Firestore.
//
// Get the service account key from: Firebase Console -> Project Settings ->
// Service Accounts -> Generate new private key. That file grants full admin access to your
// Firebase project — keep it outside this repo and delete it once you're done running this.

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLUMNS = [
  "vetName",
  "holdStatus",
  "reasonOnHold",
  "instructionDate",
  "decisionLetterLinkOrDate",
  "notes",
  "actionNeeded",
  "notesOnHoldStatus",
];

const KNOWN_STATUSES = new Set([
  "UNRESPONSIVE",
  "REINSTATED",
  "DONE",
  "ACTION NEEDED",
  "WAITING/REEVALUATION",
  "NOT INTERESTED",
]);

const [, , serviceAccountPath, boardId, dataPath, ...flags] = process.argv;
const shouldApply = flags.includes("--apply");

if (!serviceAccountPath || !boardId || !dataPath) {
  console.error("Usage: node scripts/import-appeals-hold.mjs <service-account.json> <appealsHoldBoardId> <data.csv> [--apply]");
  process.exit(1);
}

// Minimal RFC4126-ish CSV/TSV parser: handles quoted fields (with embedded delimiters,
// newlines, and "" escaped quotes) and plain tab-separated paste alike.
function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // skip; \r\n is handled by the following \n
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

function normalizeHoldStatus(raw) {
  const normalized = raw.trim().toUpperCase();
  return KNOWN_STATUSES.has(normalized) ? normalized : "";
}

function main() {
  const rawText = readFileSync(dataPath, "utf8");
  const delimiter = rawText.split("\n")[0]?.includes("\t") ? "\t" : ",";
  const rows = parseDelimitedText(rawText, delimiter);

  const warnings = [];
  const entries = rows
    .filter((cells) => {
      const first = (cells[0] ?? "").trim().toUpperCase();
      return first && first !== "VET NAME" && first !== "NAME";
    })
    .map((cells, index) => {
      const entry = {};
      COLUMNS.forEach((column, columnIndex) => {
        const raw = (cells[columnIndex] ?? "").trim();
        if (column === "holdStatus") {
          const normalized = normalizeHoldStatus(raw);
          if (raw && !normalized) warnings.push(`Row ${index + 1} (${cells[0]}): unrecognized status "${raw}" — left blank, fix manually after import.`);
          entry.holdStatus = normalized;
        } else {
          entry[column] = raw;
        }
      });
      return entry;
    })
    .filter((entry) => entry.vetName);

  console.log(`Parsed ${entries.length} row(s) from ${dataPath}.\n`);
  entries.slice(0, 10).forEach((entry, index) => {
    console.log(`  ${index + 1}. ${entry.vetName}  [${entry.holdStatus || "—"}]  ${entry.reasonOnHold || ""}`.trim());
  });
  if (entries.length > 10) console.log(`  …and ${entries.length - 10} more`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }

  if (!entries.length) {
    console.log("\nNothing to write.");
    return;
  }

  if (!shouldApply) {
    console.log(`\nDry run only -- no writes made. Re-run with --apply to write ${entries.length} record(s) to appealsHoldBoards/${boardId}/records.`);
    return;
  }

  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const recordsRef = db.collection("appealsHoldBoards").doc(boardId).collection("records");

  const updatedAt = new Date().toISOString();
  const baseId = Date.now() * 1000;
  const chunkSize = 450;

  (async () => {
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const batch = db.batch();
      chunk.forEach((entry, chunkIndex) => {
        const index = i + chunkIndex;
        batch.set(recordsRef.doc(String(baseId + index)), {
          ...entry,
          id: baseId + index,
          position: index,
          updatedAt,
          updatedBy: "Spreadsheet Import",
          version: 1,
        });
      });
      await batch.commit();
      console.log(`Wrote ${Math.min(i + chunkSize, entries.length)}/${entries.length}`);
    }
    console.log(`\nDone. ${entries.length} record(s) written to appealsHoldBoards/${boardId}/records.`);
  })().catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
}

main();
