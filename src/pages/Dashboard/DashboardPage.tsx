import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./DashboardPage.css";
import { canUserEdit, subscribeToAuth, type AuthUser } from "../../lib/firebase/auth";
import { isTasksFirebaseConfigured, registerTaskMember, subscribeToTaskAdminStatus } from "../../lib/firebase/tasks";

type ToolTile = {
  description: string;
  name: string;
  openInNewTab?: boolean;
  to: string;
};

const tools: ToolTile[] = [
  {
    name: "Progress Board",
    description: "Track claims and appeals as they move through each workflow stage.",
    openInNewTab: true,
    to: "/wins-board",
  },
  {
    name: "Tasks",
    description: "Assign and track team tasks on a shared Kanban board.",
    to: "/tasks",
  },
  {
    name: "APPEALS ON HOLD STATUS",
    description: "Track appeals that are currently on hold.",
    openInNewTab: true,
    to: "https://docs.google.com/spreadsheets/d/1vSUP63XYMbGtQi2RHzAIfgZikPGr43PFpT2GwcEr7qg/edit?pli=1&gid=0#gid=0",
  },
];

const taskAccessTile: ToolTile = {
  name: "Manage Task Access",
  description: "Grant or revoke task administrator access.",
  to: "/task-access",
};

export default function DashboardPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isTaskAdmin, setIsTaskAdmin] = useState(!isTasksFirebaseConfigured);

  useEffect(() => {
    if (!isTasksFirebaseConfigured) return;

    const unsubscribe = subscribeToAuth((user) => {
      setAuthUser(user);
      setIsTaskAdmin(false);
      // Register anyone who's signed in anywhere on the dashboard as a task member, not just
      // people who've specifically visited /tasks, so the assignee directory fills in sooner.
      if (user && canUserEdit(user)) {
        registerTaskMember(user).catch((error) => {
          console.error("Task member registration failed:", error);
        });
      }
    });
    return () => unsubscribe?.();
  }, []);

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

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <img src="/vcg-logo.png" alt="Veterans Choice Global" className="dashboard-logo" />
        <h1>VCG Dashboard</h1>
      </header>

      <div className="dashboard-grid">
        {visibleTools.map((tool) => (
          <Link
            key={tool.to}
            to={tool.to}
            className="dashboard-tile"
            target={tool.openInNewTab ? "_blank" : undefined}
            rel={tool.openInNewTab ? "noopener noreferrer" : undefined}
          >
            <span className="dashboard-tile-name">{tool.name}</span>
            <span className="dashboard-tile-description">{tool.description}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
