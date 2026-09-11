# VCG Dashboard

React + Vite dashboard for internal VCG tools. More tools can be added as new routes.

## Routes

| Route | Tool |
|---|---|
| `/` | Dashboard — launcher tiles linking to each tool |
| `/wins-board` | Progress Board — tracks wins across workflow stages (see below) |
| `/tasks` | Task management — Kanban board, see "Tasks: Firebase persistence" below |
| `/task-access` | Grant or revoke task administrator access. The dashboard tile is shown only to task administrators, and Firestore rules protect the underlying data and mutations |

**TV / kiosk displays:** point the office TV's browser directly at `/wins-board`, not `/` — the root path now shows the dashboard launcher instead of the board.

## Local demo mode

To test with fictional placeholder records and no Firebase access, create `.env.local` with:

```txt
VITE_DEMO_MODE=true
```

Demo mode disables Firebase initialization even when Firebase credentials are available. Its changes are saved only in the browser under separate demo-specific `localStorage` keys, so production data and the normal local backup are untouched. Set the value to `false` or remove `.env.local` to leave demo mode.

## Deploy to Vercel from GitHub

1. Push this project to a GitHub repository.
2. In Vercel, choose **Add New > Project**.
3. Import the GitHub repository.
4. Keep the default Vite settings:
   - Build command: `npm run build`
   - Output directory: `dist`
5. Add the environment variables from `.env.example` in **Project Settings > Environment Variables**.
6. Deploy.

Do not commit your real `.env` file. Vercel needs the same `VITE_FIREBASE_*` values configured in its dashboard so the deployed app can connect to Firestore.

Set `VITE_FIREBASE_BOARD_ID` separately for each Vercel environment:

- Production: use the real board document, for example `main-board`.
- Preview and Development: use a separate document, for example `preview-board` or `local-board`.

This keeps test deployments and local changes from writing to the production records. The app will not connect to Firebase unless `VITE_FIREBASE_BOARD_ID` is set explicitly.

To protect editing, enable Google sign-in in Firebase Authentication. The app only allows Google accounts from these two domains:

```txt
jcmchcorp.com
veteranschoiceglobal.com
```

Keep the matching environment value in Vercel for configuration visibility:

```txt
VITE_AUTHORIZED_DOMAINS=jcmchcorp.com,veteranschoiceglobal.com
```

The TV board remains viewable. The Edit Board view requires Google sign-in when Firebase is configured. Individual email exceptions and other domains are not accepted.

## Progress Board: Firebase persistence

Board metadata is stored in `winsBoards/{boardId}` and each record is stored independently in the `winsBoards/{boardId}/records` subcollection. Existing single-document board data is migrated automatically the first time an approved editor opens the board after this version is deployed. It still writes a local backup to `localStorage`.

Record edits use version-checked Firestore transactions. If another editor updates the same record while an edit modal is open, the stale save is rejected and the editor is prompted to reload the latest version.

1. Create a Firebase project.
2. Create a Web app in Firebase project settings.
3. Enable Firestore Database.
4. Copy `.env.example` to `.env`.
5. Fill in the `VITE_FIREBASE_*` values from the Firebase Web app config.
6. Set `VITE_FIREBASE_BOARD_ID` to the Firestore document you want this environment to use.
7. Deploy the included Firestore rules with `firebase deploy --only firestore:rules`, or paste `firestore.rules` into the Firebase Console Rules tab and publish them.
8. Run the app with `npm run dev`.

The app stores board metadata and individual record documents at:

```txt
winsBoards/main-board
winsBoards/main-board/records/{recordId}
```

You can change `main-board` by setting `VITE_FIREBASE_BOARD_ID`.

By default, the app will not create a missing Firebase board document from local or bundled data on first load. If you intentionally want to seed a brand-new board from the current local state, set:

```txt
VITE_FIREBASE_ALLOW_INITIAL_SEED=true
```

Leave this off in normal production and preview deployments.

The included `firestore.rules` keeps board reads public for the TV display and restricts all writes to authenticated accounts from the approved company domains.

## Tasks: Firebase persistence

Task data is stored at `taskBoards/{boardId}/tasks/{taskId}`. Unlike the wins board, there is no public read — the whole `/tasks` route requires Google sign-in from an approved domain.

Access is role-based, not just domain-based:

- **Task administrators** can read and manage every task. `admin@veteranschoiceglobal.com` is the permanent bootstrap administrator. Additional administrators are stored as documents at `taskBoards/{boardId}/admins/{email}`, granted and revoked from `/task-access` by an existing administrator (the bootstrap administrator cannot be removed).
- **Everyone else** can only read, create, and update tasks where `assignedToEmail` matches their own verified Google account email. They can create new tasks, but only assigned to themselves.
- `firestore.rules` enforces task read access. Task writes go through the authenticated Vercel API, which enforces the same ownership and administrator boundaries server-side.

Because Firestore security rules aren't filters, the client scopes its own query: administrators subscribe to the full `tasks` collection, everyone else subscribes with `where("assignedToEmail", "==", theirEmail)`.

Approved users register a lightweight directory profile at `taskBoards/{boardId}/members/{uid}` as soon as they're signed in anywhere on the dashboard, not only on the Tasks page. Administrators use this Firestore-backed directory to select an assignee. The list contains users who have signed in at least once; it is not a complete export of Firebase Authentication users, so a teammate who has never signed into the site won't appear until they do.

Set `VITE_FIREBASE_TASKS_BOARD_ID` the same way you set `VITE_FIREBASE_BOARD_ID` — a separate Firestore document id per environment (e.g. `main-tasks`, `preview-tasks`, `local-tasks`) so test deployments don't write to production task data. The app will not connect to the tasks board unless this variable is set explicitly.

Task edits use the same version-checked Firestore transaction pattern as the wins board: a stale save (someone else edited the same task first) is rejected rather than silently overwritten.

The parent task-board document's `updatedAt` value describes board configuration and initialization only. Task activity timestamps live on each task document; task mutations intentionally do not write the parent document because regular users are authorized only for their own task documents.

## Task due dates and email notifications

New To Do tasks suggest a deadline three calendar days from today, editable by the assigner. Only the assigner can change a To Do deadline. For older tasks without an assigner email, administrators can change it. Reassignment records the administrator as the new assigner.

Moving between columns opens the edit dialog. Assignees must choose and confirm a due date when moving to In Progress or Blocked; they can keep an existing date after reviewing it. Changes by another administrator leave a persistent review request. Done does not require a new deadline.

### Vercel API and Resend (no Firebase Blaze requirement)

Task creation, edits, reordering and deletion go through `POST /api/tasks`. Firebase still handles sign-in, live subscriptions and task storage. The Vercel function verifies Firebase ID tokens and enforces company domains, task ownership, administrator access, deadlines and version conflicts. Clients cannot supply notification recipients or email content. The supplied Firestore rules deny direct task writes; admin access and member-directory writes retain their existing rules.

The API saves each task mutation and an immutable notification receipt in one Firestore transaction. Resend emails the current assignee for creation, reassignment, status and deadline changes. Reordering and unrelated edits do not send email. Failed delivery does not undo a saved task: the UI shows a Retry email action for pending notifications during the current session. Each receipt uses a stable Resend idempotency key; retries expire after 23 hours to stay within Resend's 24-hour deduplication window. Receipts remain in the server-only `taskApiRequests` collection for diagnosis. Task-change emails have no scheduled retry worker; overdue summaries run separately as described below.

Configure these **server-only** variables in Vercel:

| Variable | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Entire Firebase service-account JSON, stored as a sensitive variable |
| `TASKS_BOARD_ID` | Must match `VITE_FIREBASE_TASKS_BOARD_ID` for that environment; production is `main-tasks` |
| `TASK_EMAIL_ENABLED` | `true` for production; `false` for preview/development unless intentionally testing email |
| `RESEND_API_KEY` | Resend sending key, stored as a sensitive variable |
| `TASK_EMAIL_FROM` | `VCG Tasks <tasks@updates.veteranschoiceglobal.com>` |
| `TASK_APP_URL` | `https://vcg-progress-board.vercel.app` |

Store local credentials only in ignored `.env.local`. Never prefix secrets with `VITE_`. Scope preview credentials and board IDs deliberately; do not connect previews to the production board.

Deploy the Vercel app, verify `/api/tasks` returns 401 for an unauthenticated POST, then deploy Firestore rules with `firebase deploy --only firestore:rules --project vcg-progress-board`. Open tabs on older versions must reload after the rules change. Do not roll back to a frontend that writes directly to Firestore without restoring compatible rules.

Use `vercel dev` for local full-stack development: plain `npm run dev` serves only the frontend and does not provide `/api/tasks`. Local email is disabled by default. Run `npm test`, `npm run lint`, and `npm run build` before deployment. Tests cover authorization, due-date policy, atomic receipts, duplicate requests, stale writes, notification selection, and retry behavior without sending live mail.

See [Vercel Vite functions](https://vercel.com/docs/frameworks/frontend/vite), [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), and [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

The backend uses Node 24. A scoped `jwks-rsa` → `jose` 5 override avoids the Firebase Admin 14 CommonJS/ESM startup error on Vercel ([upstream issue](https://github.com/firebase/firebase-admin-node/issues/3181)). Recheck the deployed API before removing this compatibility override.

### Daily overdue reminders

Vercel Cron calls `GET /api/overdue-reminders` daily at `0 1 * * *` (9 AM Asia/Manila; on Hobby, execution can occur anywhere in the 9–10 AM window). Runs include weekends. Each assignee with overdue work receives one private summary from the existing sender, listing titles, deadlines, days overdue and statuses, with a link to Tasks. Dates are compared in Manila time; tasks due today, missing/invalid deadlines, completed tasks and non-company recipients are excluded.

Set `CRON_SECRET` to a random secret of at least 32 characters in the production Vercel environment. Vercel supplies it as the Bearer authorization header. The job also requires the existing Firebase and Resend settings and respects `TASK_EMAIL_ENABLED`. Cron runs only for production; keep email disabled locally and on previews. No additional Firebase plan or Firestore indexes are required.

Each daily recipient digest is recorded in server-only `taskOverdueDigests`, using a deterministic board/date/recipient ID. The stored payload and Resend idempotency key are reused on repeated or concurrent calls; successful recipients are skipped. Summaries include at most 100 task details plus the remaining count. The job spaces requests and retries failures up to three times. Persistent failures or a nearly exhausted runtime return a non-success response for investigation; Vercel does not automatically retry failed cron invocations. An administrator can rerun the job from Vercel's Cron Jobs page on the same day without resending successful digests. The next day's run uses a fresh view of overdue work.

To verify without sending messages or writing delivery receipts, call `/api/overdue-reminders?dryRun=1` with the cron Bearer secret. The response contains counts only. Never place the secret in a URL. Monitor the `Overdue reminder summary` log and pending/expired/deferred counts.
