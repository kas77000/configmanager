import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, canApprove, canEdit, isAdmin, getDevUser, setDevUser, roleSummary, type User } from './api';
import { currentTheme, toggleTheme } from './theme';
import { IconBranch, IconHistory, IconInbox, IconMoon, IconServer, IconSettings, IconSun, IconUsers } from './icons';
import Dashboard from './pages/Dashboard';
import InstancePage from './pages/InstancePage';
import Changes from './pages/Changes';
import ChangeDetail from './pages/ChangeDetail';
import History from './pages/History';
import CommitPage from './pages/CommitPage';
import Admin from './pages/Admin';
import People from './pages/People';
import Requests from './pages/Requests';

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [theme, setTheme] = useState(currentTheme());
  const [devUser, setDev] = useState(getDevUser());

  useEffect(() => { api.me().then(setMe).catch(() => setMe(null)); }, [devUser]);

  function changeDevUser(v: string) { setDevUser(v); setDev(v); }

  const editor = canEdit(me?.roles);
  const approver = canApprove(me?.roles);
  const admin = isAdmin(me?.roles);
  const nav = { instances: editor, changes: editor, history: editor, requests: approver, people: admin, admin };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-dot" />Config Manager</div>
        {nav.instances && <NavLink to="/" end className="nav-link"><IconServer />Instances</NavLink>}
        {nav.changes && <NavLink to="/changes" className="nav-link"><IconBranch />Changes</NavLink>}
        {nav.requests && <NavLink to="/requests" className="nav-link"><IconInbox />Requests</NavLink>}
        {nav.history && <NavLink to="/history" className="nav-link"><IconHistory />History</NavLink>}
        {nav.people && <NavLink to="/people" className="nav-link"><IconUsers />People</NavLink>}
        {nav.admin && <NavLink to="/admin" className="nav-link"><IconSettings />Instances admin</NavLink>}

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(toggleTheme())}>
            {theme === 'dark' ? <IconSun /> : <IconMoon />}{theme === 'dark' ? 'Light' : 'Dark'} theme
          </button>
          <label className="field" style={{ margin: 0 }}>
            <span>Signed in as (dev)</span>
            <input className="input" value={devUser} onChange={(e) => changeDevUser(e.target.value)} spellCheck={false} />
          </label>
          {me && <div className="faint" style={{ fontSize: 11 }}>{roleSummary(me.roles)}</div>}
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={editor ? <Dashboard me={me} /> : approver ? <Navigate to="/requests" replace /> : <div className="page"><div className="panel"><div className="empty">Your account is pending role assignment.</div></div></div>} />
          <Route path="/instances/:code" element={<InstancePage />} />
          <Route path="/changes" element={<Changes me={me} />} />
          <Route path="/changes/:id" element={<ChangeDetail me={me} />} />
          <Route path="/requests" element={<Requests me={me} />} />
          <Route path="/history" element={<History />} />
          <Route path="/commits/:hash" element={<CommitPage />} />
          <Route path="/people" element={<People me={me} />} />
          <Route path="/admin" element={<Admin me={me} />} />
        </Routes>
      </main>
    </div>
  );
}
