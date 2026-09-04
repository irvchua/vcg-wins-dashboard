import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export class FirestoreConflictError extends Error {
  constructor() {
    super("This record was changed by another editor.");
    this.name = "FirestoreConflictError";
  }
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseAppConfigured = Object.values(firebaseConfig).every(Boolean);
export const authorizedDomains = ["jcmchcorp.com", "veteranschoiceglobal.com"];

export function cleanFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cleanFirestoreData(item)) as T;
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanFirestoreData(item)])
    ) as T;
  }

  return value;
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseAppConfigured) return null;

  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

function getAuthInstance() {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user?.email) return null;

  const fallbackName = user.email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    id: user.uid,
    email: user.email,
    name: user.displayName?.trim() || fallbackName || "Team member",
  };
}

export function canUserEdit(user: AuthUser | null) {
  if (!isFirebaseAppConfigured) return true;
  if (!user) return false;

  const domain = user.email.trim().toLowerCase().split("@")[1] ?? "";
  return authorizedDomains.includes(domain);
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
