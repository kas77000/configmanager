import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, getDevUser, setDevUser, type User } from './api';
import { currentTheme, toggleTheme } from './theme';
import { IconBranch, IconHistory, IconMoon, IconServer, IconSun } from './icons';
import Dashboard from './pages/Dashboard';
import Changes from './pages/Changes';
import ChangeDetail from './pages/ChangeDetail';
import History from './pages/History';

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [theme, setTheme] = useState(currentTheme());
  const [devUser, setDev] = useState(getDevUser());

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, [devUser]);

  function changeDevUser(v: string) {
    setDevUser(v);
    setDev(v);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-dot" />Config Manager</div>
        <NavLink to="/" end className="nav-link"><IconServer />Instances</NavLink>
        <NavLink to="/changes" className="nav-link"><IconBranch />Changes</NavLink>
        <NavLink to="/history" className="nav-link"><IconHistory />History</NavLink>

        <div className="sidebar-foot">
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(toggleTheme())}>
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
            {theme === 'dark' ? 'Light' : 'Dark'} theme
          </button>
          <label className="field" style={{ margin: 0 }}>
            <span>Signed in as (dev)</span>
            <input className="input" value={devUser} onChange={(e) => changeDevUser(e.target.value)} spellCheck={false} />
          </label>
          {me && (
            <div className="faint" style={{ fontSize: 11 }}>
              role: <span className="mono">{me.role}</span>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard me={me} />} />
          <Route path="/changes" element={<Changes me={me} />} />
          <Route path="/changes/:id" element={<ChangeDetail me={me} />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </div>
  );
}
