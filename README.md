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
- `firestore.rules` enforces this boundary server-side (`taskAdmin()` plus per-task `assignedToEmail` ownership checks) — the app's UI only reflects the same rule for convenience, it isn't the security boundary.

Because Firestore security rules aren't filters, the client scopes its own query: administrators subscribe to the full `tasks` collection, everyone else subscribes with `where("assignedToEmail", "==", theirEmail)`.

Set `VITE_FIREBASE_TASKS_BOARD_ID` the same way you set `VITE_FIREBASE_BOARD_ID` — a separate Firestore document id per environment (e.g. `main-tasks`, `preview-tasks`, `local-tasks`) so test deployments don't write to production task data. The app will not connect to the tasks board unless this variable is set explicitly.

Task edits use the same version-checked Firestore transaction pattern as the wins board: a stale save (someone else edited the same task first) is rejected rather than silently overwritten.

The parent task-board document's `updatedAt` value describes board configuration and initialization only. Task activity timestamps live on each task document; task mutations intentionally do not write the parent document because regular users are authorized only for their own task documents.
