import { Link } from "react-router-dom";
import "./DashboardPage.css";

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

export default function DashboardPage() {
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <img src="/vcg-logo.png" alt="Veterans Choice Global" className="dashboard-logo" />
        <h1>VCG Dashboard</h1>
      </header>

      <div className="dashboard-grid">
        {tools.map((tool) => (
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
