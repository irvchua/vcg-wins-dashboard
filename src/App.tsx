import { useEffect, useMemo, useState } from "react";
import "./App.css";

type StatusLabel = "" | "ON PROCESS" | "FOR CHECKING" | "APPEALS" | "CLAIMS";
type StageKey = "appeals" | "claims526" | "reviewSignature" | "faxing" | "faxed";

type BoardEntry = {
  id: number;
  name: string;
  assignedTo: string;
  adminInCharge: string;
  status: StatusLabel;
};

type BoardState = Record<StageKey, BoardEntry[]>;

type StageConfigItem = {
  key: StageKey;
  title: string;
  metaTitle: string;
};

const STORAGE_KEY = "vcg-wins-board-data";
const WINS_STORAGE_KEY = "vcg-total-wins";

const emptyBoard: BoardState = {
  appeals: [],
  claims526: [],
  reviewSignature: [],
  faxing: [],
  faxed: [],
};

const stageConfig: StageConfigItem[] = [
  { key: "appeals", title: "APPEALS", metaTitle: "STATUS" },
  { key: "claims526", title: "526EZ/CLAIMS", metaTitle: "STATUS" },
  { key: "reviewSignature", title: "FOR REVIEW AND SIGNATURE", metaTitle: "PROCESS" },
  { key: "faxing", title: "FOR FAXING", metaTitle: "PROCESS" },
  { key: "faxed", title: "FAXED", metaTitle: "PROCESS" },
];

const statusOptions: StatusLabel[] = ["", "ON PROCESS", "FOR CHECKING", "APPEALS", "CLAIMS"];

const initialBoard: BoardState = {
  appeals: [
    { id: 1, name: "Alan Cain", assignedTo: "", adminInCharge: "", status: "" },
    { id: 2, name: "Reginald Mccoy", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 3, name: "Derek Kelly", assignedTo: "", adminInCharge: "", status: "" },
    { id: 4, name: "Christopher Cheramie", assignedTo: "", adminInCharge: "", status: "" },
    { id: 5, name: "Suphakit Areeyat", assignedTo: "", adminInCharge: "", status: "" },
    { id: 6, name: "Lavalle Jenkins", assignedTo: "", adminInCharge: "", status: "" },
    { id: 7, name: "Gavriel Hudson", assignedTo: "", adminInCharge: "", status: "" },
    { id: 8, name: "Mercedes Pratt", assignedTo: "", adminInCharge: "", status: "" },
    { id: 9, name: "Thomas Dezell", assignedTo: "", adminInCharge: "", status: "" },
  ],
  claims526: [
    { id: 10, name: "Douglas Kramer", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 11, name: "Aurelio Cuervo", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 12, name: "Gary Watson", assignedTo: "", adminInCharge: "", status: "FOR CHECKING" },
    { id: 13, name: "Freddie Gonzales", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 14, name: "Juan Ocampo", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 15, name: "Elvis Thien", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 16, name: "Michael Johnson", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 17, name: "Jeffrey Mota", assignedTo: "", adminInCharge: "", status: "ON PROCESS" },
    { id: 18, name: "Dennis Robinson", assignedTo: "", adminInCharge: "", status: "" },
    { id: 19, name: "Jamar Harrison", assignedTo: "", adminInCharge: "", status: "" },
    { id: 20, name: "Rey Thompson", assignedTo: "", adminInCharge: "", status: "" },
  ],
  reviewSignature: [
    { id: 21, name: "Wilson Warner", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 22, name: "Shing-Chit Chuang", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 23, name: "Isaac Contreras", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 24, name: "Quinn Lacey", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 25, name: "Anthony Davis", assignedTo: "", adminInCharge: "", status: "APPEALS" },
  ],
  faxing: [{ id: 26, name: "Issiah Johnson", assignedTo: "", adminInCharge: "", status: "CLAIMS" }],
  faxed: [
    { id: 27, name: "Louis Collins", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 28, name: "Jason Moore", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 29, name: "Dennis Robinson", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 30, name: "Anthony Hale", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 31, name: "Antiuwan Jones", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 32, name: "Philip Edgar", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 33, name: "Tristian Blaney", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 34, name: "Brandon Black", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 35, name: "Keith Genereux", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 36, name: "Dake Hamilton", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 37, name: "Eddian Edwards", assignedTo: "", adminInCharge: "", status: "APPEALS" },
    { id: 38, name: "Irving Scales Sr.", assignedTo: "", adminInCharge: "", status: "CLAIMS" },
    { id: 39, name: "Elijah Stroh", assignedTo: "", adminInCharge: "", status: "" },
  ],
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getTotalEntries(board: BoardState): number {
  return Object.values(board).reduce((sum, group) => sum + group.length, 0);
}

function getNextId(board: BoardState): number {
  const ids = Object.values(board).flat().map((entry) => entry.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function getBadgeClass(status: StatusLabel): string {
  switch (status) {
    case "ON PROCESS":
      return "badge badge-green";
    case "FOR CHECKING":
      return "badge badge-yellow";
    case "APPEALS":
      return "badge badge-blue";
    case "CLAIMS":
      return "badge badge-sky";
    default:
      return "badge badge-empty";
  }
}

function normalizeBoard(board: BoardState): BoardState {
  const normalizeEntry = (entry: any): BoardEntry => ({
    ...entry,
    assignedTo: "",
    adminInCharge: entry.adminInCharge ?? entry.assignedTo ?? "",
  });

  return {
    appeals: board.appeals.map(normalizeEntry),
    claims526: board.claims526.map(normalizeEntry),
    reviewSignature: board.reviewSignature.map(normalizeEntry),
    faxing: board.faxing.map(normalizeEntry),
    faxed: board.faxed.map(normalizeEntry),
  };
}

function loadInitialBoard(): BoardState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeBoard(JSON.parse(saved)) : initialBoard;
  } catch {
    return initialBoard;
  }
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [board, setBoard] = useState<BoardState>(loadInitialBoard);
  const [wins, setWins] = useState<number>(() => {
    const savedWins = localStorage.getItem(WINS_STORAGE_KEY);
    return savedWins ? Number(savedWins) : 104;
  });
  const [page, setPage] = useState<"tv" | "admin">("tv");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  }, [board]);

  useEffect(() => {
    localStorage.setItem(WINS_STORAGE_KEY, String(wins));
  }, [wins]);

  const totalEntries = useMemo(() => getTotalEntries(board), [board]);
  const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" }).format(now);
  const dayNumber = now.getDate();

  function addRow(stage: StageKey) {
    const name = window.prompt("Enter veteran name:");
    if (!name?.trim()) return;

    setBoard((current) => ({
      ...current,
      [stage]: [
        ...current[stage],
        {
          id: getNextId(current),
          name: name.trim(),
          assignedTo: "",
          adminInCharge: "",
          status: "",
        },
      ],
    }));
  }

  function updateEntry(stage: StageKey, id: number, field: keyof BoardEntry, value: string) {
    setBoard((current) => ({
      ...current,
      [stage]: current[stage].map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function deleteEntry(stage: StageKey, id: number) {
    setBoard((current) => ({
      ...current,
      [stage]: current[stage].filter((entry) => entry.id !== id),
    }));
  }

  function moveEntry(fromStage: StageKey, toStage: StageKey, id: number) {
    if (fromStage === toStage) return;

    setBoard((current) => {
      const entryToMove = current[fromStage].find((entry) => entry.id === id);
      if (!entryToMove) return current;

      return {
        ...current,
        [fromStage]: current[fromStage].filter((entry) => entry.id !== id),
        [toStage]: [...current[toStage], entryToMove],
      };
    });
  }

  function clearFaxedBoard() {
    const confirmClear = window.confirm("Clear only the FAXED column and keep everything else?");
    if (!confirmClear) return;

    setBoard((current) => ({
      ...current,
      faxed: [],
    }));
  }

  function resetBoard() {
    const confirmReset = window.confirm("Clear all rows and reset Total Wins to 0?");
    if (!confirmReset) return;

    setBoard(emptyBoard);
    setWins(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyBoard));
    localStorage.setItem(WINS_STORAGE_KEY, "0");
  }

  return (
    <div className="app-shell">
      <div className="top-actions">
        <button className={page === "tv" ? "nav-button active" : "nav-button"} onClick={() => setPage("tv")}>
          TV Board
        </button>
        <button className={page === "admin" ? "nav-button active" : "nav-button"} onClick={() => setPage("admin")}>
          Edit Board
        </button>
      </div>

      {page === "tv" ? (
        <div className="tv-layout">
          <aside className="left-panel">
            <img src="/vcg-logo.png" alt="Veterans Choice Global" className="logo" />

            <div className="clock-block">
              <div className="date-small">
                {weekdayShort} {monthShort}
              </div>
              <div className="day-number">{dayNumber}</div>
              <div className="clock-time">{formatTime(now)}</div>
            </div>
          </aside>

          <main className="board-panel">
            <h1 className="wins-title">
              TOTAL WINS: <span>{wins}</span>
            </h1>
            <BoardTable board={board} />
            <div className="entries-line">Entries: {totalEntries}</div>
          </main>
        </div>
      ) : (
        <div className="admin-page">
          <div className="admin-header">
            <div>
              <h1>Edit Wins Board</h1>
              <p>Drag rows between columns, update statuses, and assign who is in charge.</p>
            </div>

            <div className="admin-actions">
              <label className="wins-editor">
                Total Wins
                <input type="number" value={wins} onChange={(event) => setWins(Number(event.target.value))} />
              </label>

              <button className="reset-keep-button" onClick={clearFaxedBoard}>
                Clear Faxed
              </button>

              <button className="reset-button" onClick={resetBoard}>
                Reset All
              </button>
            </div>
          </div>

          <div className="drag-admin-board">
            {stageConfig.map((stage) => (
              <section
                className="drag-column"
                key={stage.key}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const entryId = Number(event.dataTransfer.getData("entryId"));
                  const fromStage = event.dataTransfer.getData("fromStage") as StageKey;
                  moveEntry(fromStage, stage.key, entryId);
                }}
              >
                <div className="drag-column-header">
                  <div>
                    <h2>{stage.title}</h2>
                    <p>{stage.metaTitle}</p>
                  </div>
                  <div className="drag-column-actions">
                    <span>{board[stage.key].length}</span>
                    <button onClick={() => addRow(stage.key)}>+ Add</button>
                  </div>
                </div>

                <div className="drag-list">
                  {board[stage.key].map((entry) => (
                    <div
                      className="drag-row"
                      key={entry.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("entryId", String(entry.id));
                        event.dataTransfer.setData("fromStage", stage.key);
                      }}
                    >
                      <div className="drag-handle">⋮⋮</div>

                      <label className="entry-field">
                        <span className="entry-field-label">Veteran</span>
                        <input
                          value={entry.name}
                          placeholder="Veteran's Name"
                          onChange={(event) => updateEntry(stage.key, entry.id, "name", event.target.value)}
                        />
                      </label>

                      <label className="entry-field owner-field">
                        <span className="entry-field-label">Admin</span>
                        <input
                          className="owner-input"
                          value={entry.adminInCharge}
                          placeholder="Admin"
                          onChange={(event) => updateEntry(stage.key, entry.id, "adminInCharge", event.target.value)}
                        />
                      </label>

                      <div className="controls-row">
                        <select
                          value={entry.status}
                          onChange={(event) => updateEntry(stage.key, entry.id, "status", event.target.value)}
                        >
                          {statusOptions.map((status) => (
                            <option key={status || "blank"} value={status}>
                              {status || "Blank"}
                            </option>
                          ))}
                        </select>

                        <button className="delete-button" onClick={() => deleteEntry(stage.key, entry.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BoardTable({ board }: { board: BoardState }) {
  return (
    <div className="modern-board">
      {stageConfig.map((stage) => {
        const entries = board[stage.key];
        const rowCount = Math.max(8, entries.length);

        return (
          <section className="stage-card" key={stage.key}>
            <div className="stage-header">
              <div>
                <h2>{stage.title}</h2>
                <p>{stage.metaTitle}</p>
              </div>
              <span className="stage-count">{entries.length}</span>
            </div>

            <div className="stage-list">
              {Array.from({ length: rowCount }).map((_, index) => {
                const entry = entries[index];
                const status = entry?.status ?? "";

                return (
                  <div className={entry ? "stage-row" : "stage-row empty-row"} key={`${stage.key}-${index}`}>
                    <div className="person-details">
                      <span className="person-name">{entry?.name ?? ""}</span>
                      {entry?.adminInCharge ? (
                        <span className="person-owner">Admin: {entry.adminInCharge}</span>
                      ) : null}
                    </div>
                    <span className={getBadgeClass(status)}>{status || " "}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}