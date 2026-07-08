import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { BoardState } from "./types";

type PersistedBoardData = {
  board: BoardState;
  wins: number;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseBoardId = import.meta.env.VITE_FIREBASE_BOARD_ID;
export const shouldSeedMissingFirebaseBoard =
  import.meta.env.VITE_FIREBASE_ALLOW_INITIAL_SEED === "true";
export const authorizedEmails = (import.meta.env.VITE_AUTHORIZED_EMAILS ?? "")
  .split(",")
  .map((email: string) => email.trim().toLowerCase())
  .filter(Boolean);
export const authorizedDomains = (import.meta.env.VITE_AUTHORIZED_DOMAINS ?? "")
  .split(",")
  .map((domain: string) => domain.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean) && Boolean(firebaseBoardId);

function getFirebaseApp() {
  if (!isFirebaseConfigured) return null;

  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

function getBoardDocRef() {
  const app = getFirebaseApp();
  if (!app) return null;

  const database = getFirestore(app);

  return doc(database, "winsBoards", firebaseBoardId);
}

function getAuthInstance() {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user?.email) return null;

  return {
    id: user.uid,
    email: user.email,
    name: user.displayName ?? user.email,
  };
}

export function canUserEdit(user: AuthUser | null) {
  if (!isFirebaseConfigured) return true;
  if (!user) return false;

  const email = user.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";

  if (!authorizedEmails.length && !authorizedDomains.length) return true;

  return authorizedEmails.includes(email) || authorizedDomains.includes(domain);
}

export function subscribeToAuth(onChange: (user: AuthUser | null) => void) {
  const auth = getAuthInstance();
  if (!auth) {
    onChange(null);
    return null;
  }

  return onAuthStateChanged(auth, (user) => onChange(toAuthUser(user)));
}

export async function signInWithGoogle() {
  const auth = getAuthInstance();
  if (!auth) return null;

  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return toAuthUser(result.user);
}

export async function signOutUser() {
  const auth = getAuthInstance();
  if (!auth) return;

  await signOut(auth);
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
