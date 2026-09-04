import { BrowserRouter, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/Dashboard/DashboardPage";
import TaskAccessPage from "./pages/TaskAccess/TaskAccessPage";
import TasksPage from "./pages/Tasks/TasksPage";
import WinsBoardPage from "./pages/WinsBoard/WinsBoardPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/wins-board" element={<WinsBoardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/task-access" element={<TaskAccessPage />} />
      </Routes>
    </BrowserRouter>
  );
}
