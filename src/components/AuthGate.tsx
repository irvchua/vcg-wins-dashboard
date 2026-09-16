import { useEffect, useState, type ReactNode } from "react";
import "./AuthGate.css";
import { AuthUserContext } from "./authContext";
import {
  canUserEdit,
  isFirebaseAppConfigured,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  type AuthUser,
} from "../lib/firebase/auth";

function GoogleLogo() {
  return (
    <svg className="google-logo" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2582h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.6151z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8064 5.9564-2.1805l-2.9087-2.2582c-.8064.5405-1.8368.8636-3.0477.8636-2.3446 0-4.3282-1.5832-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <path fill="#FBBC05" d="M3.9641 10.71c-.18-.5405-.2823-1.1177-.2823-1.71s.1023-1.1695.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z" />
      <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5814-2.5814C13.4632.8918 11.43 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6555 3.5795 9 3.5795z" />
    </svg>
  );
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(isFirebaseAppConfigured);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!isFirebaseAppConfigured) return;

    const unsubscribe = subscribeToAuth((user) => {
      setAuthUser(user);
      setIsLoading(false);
    });
    return () => unsubscribe?.();
  }, []);

  function handleSignIn() {
    setAuthError("");
    signInWithGoogle().catch((error) => {
      console.error("Google sign-in failed:", error);
      setAuthError("Sign-in failed. Please try again.");
    });
  }

  function handleSignOut() {
    setAuthError("");
    signOutUser().catch((error) => {
      console.error("Sign-out failed:", error);
      setAuthError("Sign-out failed. Please try again.");
    });
  }

  // With no Firebase project configured at all (local/offline dev), there's no auth to
  // check — every page's own canUserEdit(null) already treats this as "editing allowed".
  if (!isFirebaseAppConfigured) {
    return <AuthUserContext.Provider value={null}>{children}</AuthUserContext.Provider>;
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <p className="auth-loading">Loading…</p>
      </main>
    );
  }

  if (!authUser || !canUserEdit(authUser)) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <img src="/vcg-logo.png" alt="Veterans Choice Global" className="auth-logo" />
          <h1>VCG Dashboard</h1>
          {authUser ? (
            <>
              <p>This Google account does not have access. Please sign in with an approved work account.</p>
              <button className="auth-button secondary" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <p>Sign in with an approved Google account to continue.</p>
              <button className="auth-button" onClick={handleSignIn}>
                <GoogleLogo />
                Sign in with Google
              </button>
            </>
          )}
          {authError ? <div className="auth-error">{authError}</div> : null}
        </section>
      </main>
    );
  }

  return <AuthUserContext.Provider value={authUser}>{children}</AuthUserContext.Provider>;
}
