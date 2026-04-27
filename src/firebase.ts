import { initializeApp, getApps } from "firebase/app";
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { BoardState } from "./types";

type PersistedBoardData = {
  board: BoardState;
  wins: number;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

function getBoardDocRef() {
  if (!isFirebaseConfigured) return null;

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const database = getFirestore(app);
  const boardId = import.meta.env.VITE_FIREBASE_BOARD_ID || "main-board";

  return doc(database, "winsBoards", boardId);
}

export function subscribeToBoard(
  onData: (data: PersistedBoardData | null) => void,
  onError: (error: Error) => void
) {
  const boardDocRef = getBoardDocRef();
  if (!boardDocRef) return null;

  return onSnapshot(
    boardDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      const data = snapshot.data();
      onData({
        board: data.board as BoardState,
        wins: typeof data.wins === "number" ? data.wins : 0,
      });
    },
    onError
  );
}

export async function saveBoardData(board: BoardState, wins: number) {
  const boardDocRef = getBoardDocRef();
  if (!boardDocRef) return false;

  await setDoc(
    boardDocRef,
    {
      board,
      wins,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}
