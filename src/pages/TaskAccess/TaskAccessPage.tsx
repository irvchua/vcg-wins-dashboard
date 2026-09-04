import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import "../../styles/shared.css";
import "./TaskAccessPage.css";
import {
  authorizedDomains,
  canUserEdit,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  type AuthUser,
} from "../../lib/firebase/auth";
import {
  BOOTSTRAP_TASK_ADMIN_EMAIL,
  grantTaskAdmin,
  isTasksFirebaseConfigured,
  revokeTaskAdmin,
  subscribeToTaskAdminStatus,
  subscribeToTaskAdmins,
} from "../../lib/firebase/tasks";

export default function TaskAccessPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isTasksFirebaseConfigured);
  const [authError, setAuthError] = useState("");
  const [isTaskAdmin, setIsTaskAdmin] = useState(!isTasksFirebaseConfigured);
  const [isAdminStatusLoading, setIsAdminStatusLoading] = useState(isTasksFirebaseConfigured);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [isAdminsLoading, setIsAdminsLoading] = useState(isTasksFirebaseConfigured);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [grantError, setGrantError] = useState("");
  const [isGranting, setIsGranting] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const canUseAccessPage = canUserEdit(authUser);
  const showAuthGate = isTasksFirebaseConfigured && (!authUser || !canUseAccessPage);
  const updaterName = authUser?.name.trim() || "Local user";

  useEffect(() => {
    if (!isTasksFirebaseConfigured) return;

    const unsubscribe = subscribeToAuth((user) => {
      const hasTaskAccess = Boolean(user && canUserEdit(user));
      setAuthUser(user);
      setIsTaskAdmin(false);
      setIsAdminStatusLoading(hasTaskAccess);
      setAdminEmails([]);
      setIsAdminsLoading(hasTaskAccess);
      setConfirmingRevoke(null);
      setActionMessage("");
      setGrantError("");
      setIsAuthLoading(false);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser || !canUserEdit(authUser)) return;

    const unsubscribe = subscribeToTaskAdminStatus(
      authUser.email,
      (isAdmin) => {
        setAdminEmails([]);
        setIsAdminsLoading(isAdmin);
        setIsTaskAdmin(isAdmin);
        setIsAdminStatusLoading(false);
      },
      (error) => {
        console.error("Task admin status check failed:", error);
        setAdminEmails([]);
        setIsAdminsLoading(false);
        setIsTaskAdmin(false);
        setIsAdminStatusLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [authUser]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !isTaskAdmin) return;

    const unsubscribe = subscribeToTaskAdmins(
      (emails) => {
        setAdminEmails(emails);
        setIsAdminsLoading(false);
      },
      (error) => {
        console.error("Task admin list sync failed:", error);
        setIsAdminsLoading(false);
      }
    );
    return () => unsubscribe?.();
  }, [isTaskAdmin]);

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

  async function submitGrantAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newAdminEmail.trim().toLowerCase();
    setGrantError("");
    setActionMessage("");

    if (!email || !email.includes("@")) {
      setGrantError("Enter a valid email address.");
      return;
    }
    const domain = email.split("@")[1] ?? "";
    if (!authorizedDomains.includes(domain)) {
      setGrantError(`Use an approved work email (${authorizedDomains.join(" or ")}).`);
      return;
    }
    if (email === BOOTSTRAP_TASK_ADMIN_EMAIL || adminEmails.includes(email)) {
      setGrantError("This account is already a task administrator.");
      return;
    }

    setIsGranting(true);
    try {
      await grantTaskAdmin(email, updaterName);
      setAdminEmails((current) => (current.includes(email) ? current : [...current, email]));
      setNewAdminEmail("");
      setActionMessage(`Granted access to ${email}.`);
    } catch (error) {
      console.error("Grant admin failed:", error);
      setGrantError("Could not grant access. Check your connection and try again.");
    } finally {
      setIsGranting(false);
    }
  }

  async function handleRevoke(email: string) {
    setActionMessage("");
    try {
      await revokeTaskAdmin(email);
      setAdminEmails((current) => current.filter((adminEmail) => adminEmail !== email));
      setActionMessage(`Revoked access for ${email}.`);
    } catch (error) {
      console.error("Revoke admin failed:", error);
      setActionMessage(`Could not revoke access for ${email}.`);
    } finally {
      setConfirmingRevoke(null);
    }
  }

  return (
    <main className="tasks-shell">
      <div className="tasks-top-bar">
        <Link to="/" className="tasks-back-link">
          ← Dashboard
        </Link>
        {authUser ? (
          <div className="tasks-account">
            <span>{authUser.name}</span>
            {isTaskAdmin ? <span className="tasks-admin-badge">Admin</span> : null}
            <button className="nav-button" onClick={handleSignOut}>Sign Out</button>
          </div>
        ) : null}
      </div>

      <h1>Manage Task Access</h1>

      {!isTasksFirebaseConfigured ? (
        <p className="tasks-config-warning">
          Task storage is not configured for this environment (missing VITE_FIREBASE_TASKS_BOARD_ID). Changes here will not be saved.
        </p>
      ) : null}

      {isAuthLoading ? (
        <p className="tasks-loading">Loading…</p>
      ) : showAuthGate ? (
        <div className="tasks-auth-gate">
          <p>Sign in with an approved Google account to continue.</p>
          <button className="primary-action-button" onClick={handleSignIn}>Sign in with Google</button>
          {authError ? <p className="tasks-auth-error" role="alert">{authError}</p> : null}
        </div>
      ) : isAdminStatusLoading ? (
        <p className="tasks-loading">Checking access…</p>
      ) : !isTaskAdmin ? (
        <div className="tasks-auth-gate">
          <p>Only task administrators can manage access. Ask an existing administrator to grant you access.</p>
        </div>
      ) : (
        <>
          <section className="task-access-section">
            <h2>Task administrators</h2>
            <ul className="task-access-list">
              <li className="task-access-row">
                <span>{BOOTSTRAP_TASK_ADMIN_EMAIL}</span>
                <span className="task-access-permanent">Permanent</span>
              </li>
              {isAdminsLoading ? (
                <li className="task-access-row">
                  <span>Loading…</span>
                </li>
              ) : (
                adminEmails.map((email) => (
                  <li className="task-access-row" key={email}>
                    <span>{email}</span>
                    {confirmingRevoke === email ? (
                      <span className="task-access-confirm">
                        <button type="button" className="secondary-action-button" onClick={() => setConfirmingRevoke(null)}>
                          Cancel
                        </button>
                        <button type="button" className="danger-confirm-button" onClick={() => handleRevoke(email)}>
                          Confirm Revoke
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="secondary-action-button" onClick={() => setConfirmingRevoke(email)}>
                        Revoke
                      </button>
                    )}
                  </li>
                ))
              )}
              {!isAdminsLoading && !adminEmails.length ? (
                <li className="task-access-row task-access-empty">No additional administrators yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="task-access-section">
            <h2>Grant access</h2>
            <form className="task-access-grant-form" onSubmit={submitGrantAdmin}>
              <input
                type="email"
                required
                placeholder="name@veteranschoiceglobal.com"
                value={newAdminEmail}
                onChange={(event) => setNewAdminEmail(event.target.value)}
              />
              <button type="submit" className="primary-action-button" disabled={isGranting}>
                {isGranting ? "Granting…" : "Grant Access"}
              </button>
            </form>
            {grantError ? <p className="tasks-auth-error" role="alert">{grantError}</p> : null}
          </section>

          {actionMessage ? <p className="tasks-sync-message" role="alert">{actionMessage}</p> : null}
        </>
      )}
    </main>
  );
}
