import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "../../styles/shared.css";
import "./DashboardPage.css";
import { useAuthUser } from "../../components/authContext";
import { canUserEdit, signOutUser } from "../../lib/firebase/auth";
import { isTasksFirebaseConfigured, registerTaskMember, subscribeToTaskAdminStatus } from "../../lib/firebase/tasks";
import { AdminAccessIcon, CrmIcon, OnHoldIcon, ProgressBoardIcon, TasksIcon } from "./icons";

type ToolTile = {
  description: string;
  icon: ReactNode;
  name: string;
  openInNewTab?: boolean;
  to: string;
};

const tools: ToolTile[] = [
  {
    name: "Progress Board",
    description: "Track claims and appeals as they move through each workflow stage.",
    icon: <ProgressBoardIcon />,
    openInNewTab: true,
    to: "/wins-board",
  },
  {
    name: "Tasks",
    description: "Assign and track team tasks on a shared Kanban board.",
    icon: <TasksIcon />,
    to: "/tasks",
  },
  {
    name: "Appeals On Hold Status",
    description: "Track appeals that are currently on hold.",
    icon: <OnHoldIcon />,
    to: "/appeals-hold",
  },
  {
    name: "Zoho CRM",
    description: "Open VCG's Zoho CRM.",
    icon: <CrmIcon />,
    openInNewTab: true,
    to: "https://crm.zoho.com/crm/org911880922/",
  },
];

const taskAccessTile: ToolTile = {
  name: "Manage Admin Access",
  description: "Grant or revoke admin access for Tasks.",
  icon: <AdminAccessIcon />,
  to: "/task-access",
};

export default function DashboardPage() {
  const authUser = useAuthUser();
  const [isTaskAdmin, setIsTaskAdmin] = useState(!isTasksFirebaseConfigured);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    // Register anyone who's signed in anywhere on the dashboard as a task member, not just
    // people who've specifically visited /tasks, so the assignee directory fills in sooner.
    if (!isTasksFirebaseConfigured || !authUser || !canUserEdit(authUser)) return;

    registerTaskMember(authUser).catch((error) => {
      console.error("Task member registration failed:", error);
    });
  }, [authUser]);

  useEffect(() => {
    if (!isTasksFirebaseConfigured || !authUser || !canUserEdit(authUser)) return;

    const unsubscribe = subscribeToTaskAdminStatus(
      authUser.email,
      setIsTaskAdmin,
      (error) => {
        console.error("Task admin status check failed:", error);
        setIsTaskAdmin(false);
      }
    );
    return () => unsubscribe?.();
  }, [authUser]);

  const visibleTools = isTaskAdmin ? [...tools, taskAccessTile] : tools;

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    try {
      await signOutUser();
    } catch {
      setSignOutError("Couldn't sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <img src="/vcg-logo.png" alt="Veterans Choice Global" className="dashboard-logo" />
        <h1>VCG Dashboard</h1>
        {authUser ? (
          <button type="button" className="nav-button dashboard-signout" onClick={handleSignOut} disabled={isSigningOut}>
            {isSigningOut ? "Signing Out…" : "Sign Out"}
          </button>
        ) : null}
      </header>

      {signOutError ? <p className="dashboard-auth-error" role="alert">{signOutError}</p> : null}

      <div className="dashboard-grid">
        {visibleTools.map((tool) => {
          const tileContent = (
            <>
              <span className="dashboard-tile-icon">{tool.icon}</span>
              <span className="dashboard-tile-name">{tool.name}</span>
              <span className="dashboard-tile-description">{tool.description}</span>
            </>
          );

          // react-router's Link resolves `to` as an internal path, so absolute external
          // URLs (e.g. Zoho CRM) need a plain anchor tag instead.
          return /^https?:\/\//.test(tool.to) ? (
            <a
              key={tool.to}
              href={tool.to}
              className="dashboard-tile"
              target={tool.openInNewTab ? "_blank" : undefined}
              rel={tool.openInNewTab ? "noopener noreferrer" : undefined}
            >
              {tileContent}
            </a>
          ) : (
            <Link
              key={tool.to}
              to={tool.to}
              className="dashboard-tile"
              target={tool.openInNewTab ? "_blank" : undefined}
              rel={tool.openInNewTab ? "noopener noreferrer" : undefined}
            >
              {tileContent}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
