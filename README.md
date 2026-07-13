# VCG Wins Board

React + Vite board for tracking wins across workflow stages.

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

## Firebase persistence

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
