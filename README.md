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

## Firebase persistence

The board persists to Firestore when Firebase environment variables are configured. It still writes a local backup to `localStorage`, so the app can run before Firebase is connected or during a temporary Firebase outage.

1. Create a Firebase project.
2. Create a Web app in Firebase project settings.
3. Enable Firestore Database.
4. Copy `.env.example` to `.env`.
5. Fill in the `VITE_FIREBASE_*` values from the Firebase Web app config.
6. Run the app with `npm run dev`.

The app stores one document at:

```txt
winsBoards/main-board
```

You can change `main-board` by setting `VITE_FIREBASE_BOARD_ID`.

For simple internal use, start Firestore rules with your preferred access model. During development only, an open rule looks like:

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /winsBoards/{boardId} {
      allow read, write: if true;
    }
  }
}
```

Before deploying publicly, replace that with authenticated or domain-restricted access.
