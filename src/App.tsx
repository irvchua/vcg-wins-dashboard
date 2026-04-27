import { useEffect, useMemo, useState } from "react";
import "./App.css";

type StatusLabel = "" | "ON PROCESS" | "FOR CHECKING" | "APPEALS" | "CLAIMS";
type StageKey = "appeals" | "claims526" | "reviewSignature" | "faxing" | "faxed";

type BoardEntry = {
  id: number;
  name: string;
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
  { key: "claims526", title: "526EZ / CLAIMS", metaTitle: "STATUS" },
  { key: "reviewSignature", title: "FOR REVIEW & SIGNATURE", metaTitle: "PROCESS" },
  { key: "faxing", title: "FOR FAXING", metaTitle: "PROCESS" },
  { key: "faxed", title: "FAXED", metaTitle: "COMPLETED" },
];

const statusOptions: StatusLabel[] = ["", "ON PROCESS", "FOR CHECKING", "APPEALS", "CLAIMS"];

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

function loadInitialBoard(): BoardState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : emptyBoard;
  } catch {
    return emptyBoard;
  }
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [board, setBoard] = useState<BoardState>(loadInitialBoard);
  const [wins, setWins] = useState<number>(() => {
    const savedWins = localStorage.getItem(WINS_STORAGE_KEY);
    return savedWins ? Number(savedWins) : 0;
  });
  const [previousWins, setPreviousWins] = useState(wins);
  const [winFlash, setWinFlash] = useState(false);
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

  useEffect(() => {
    if (wins > previousWins) {
      setWinFlash(true);
      window.setTimeout(() => setWinFlash(false), 1500);
    }

    setPreviousWins(wins);
  }, [wins, previousWins]);

  const totalEntries = useMemo(() => getTotalEntries(board), [board]);
  const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" }).format(now);
  const dayNumber = now.getDate();

  function addRow(stage: StageKey) {
    const name = window.prompt("Enter name:");
    if (!name?.trim()) return;

    setBoard((current) => ({
      ...current,
      [stage]: [...current[stage], { id: getNextId(current), name: name.trim(), status: "" }],
    }));
  }

  function updateEntry(stage: StageKey, id: number, field: keyof BoardEntry, value: string) {
    setBoard((current) => ({
      ...current,
      [stage]: current[stage].map((entry) =>
        entry.id === id ? { ...entry, [field]: value as StatusLabel } : entry
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

  function resetBoard() {
    const confirmReset = window.confirm("Clear all rows and reset Total Wins to 0?");
    if (!confirmReset) return;

    setBoard(emptyBoard);
    setWins(0);
    setPreviousWins(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyBoard));
    localStorage.setItem(WINS_STORAGE_KEY, "0");
  }

  return (
    <div className="app-shell">
      <div className="top-actions">
        <button
          className={page === "tv" ? "nav-button active" : "nav-button"}
          onClick={() => setPage("tv")}
        >
          TV Board
        </button>
        <button
          className={page === "admin" ? "nav-button active" : "nav-button"}
          onClick={() => setPage("admin")}
        >
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
            <h1 className={winFlash ? "wins-title win-flash" : "wins-title"}>
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
              <p>Drag rows between columns, update statuses, and adjust total wins.</p>
            </div>

            <div className="admin-actions">
              <label className="wins-editor">
                Total Wins
                <input
                  type="number"
                  value={wins}
                  onChange={(event) => setWins(Number(event.target.value))}
                />
              </label>

              <button className="reset-button" onClick={resetBoard}>
                Reset Board
              </button>
            </div>
          </div>

          <div className="drag-admin-board">
            {stageConfig.map((stage) => (
              <section
                className="drag-column"
                key={stage.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.currentTarget.classList.add("drag-over");
                }}
                onDragLeave={(event) => {
                  event.currentTarget.classList.remove("drag-over");
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.currentTarget.classList.remove("drag-over");

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

                      <input
                        value={entry.name}
                        onChange={(event) =>
                          updateEntry(stage.key, entry.id, "name", event.target.value)
                        }
                      />

                      <div className="controls-row">
                        <select
                          value={entry.status}
                          onChange={(event) =>
                            updateEntry(stage.key, entry.id, "status", event.target.value)
                          }
                        >
                          {statusOptions.map((status) => (
                            <option key={status || "blank"} value={status}>
                              {status || "Blank"}
                            </option>
                          ))}
                        </select>

                        <button
                          className="delete-button"
                          onClick={() => deleteEntry(stage.key, entry.id)}
                        >
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
                  <div
                    className={entry ? "stage-row" : "stage-row empty-row"}
                    key={`${stage.key}-${index}`}
                  >
                    <span className="person-name">{entry?.name ?? ""}</span>
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