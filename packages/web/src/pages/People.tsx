import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABEL, api, isAdmin, roleSummary, type Role, type User } from '../api';
import { Skeleton } from '../components';
import { IconPlus, IconTrash } from '../icons';

export default function People({ me }: { me: User | null }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dist, setDist] = useState('');
  const [epic, setEpic] = useState('');
  const [saved, setSaved] = useState({ dist: '', epic: '' });

  async function refresh() { setUsers(await api.users()); }
  useEffect(() => {
    refresh().catch(() => setUsers([]));
    api.settings().then((s) => { setDist(s.quantDistributionEmail); setEpic(s.jiraEpicKey); setSaved({ dist: s.quantDistributionEmail, epic: s.jiraEpicKey }); }).catch(() => {});
  }, []);

  const settingsDirty = dist.trim() !== saved.dist || epic.trim() !== saved.epic;
  async function saveSettings() {
    setErr(null);
    try {
      const s = await api.updateSettings({ quantDistributionEmail: dist.trim(), jiraEpicKey: epic.trim() });
      setDist(s.quantDistributionEmail); setEpic(s.jiraEpicKey); setSaved({ dist: s.quantDistributionEmail, epic: s.jiraEpicKey });
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  if (me && !isAdmin(me.roles)) {
    return <div className="page"><div className="panel"><div className="empty">Admin only.</div></div></div>;
  }

  async function run<T>(p: Promise<T>) {
    setErr(null);
    try { await p; await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1>People</h1>
          <p>Add team members by Windows ID and assign one or more roles. Quant (editor) creates and reviews changes; Stakeholder approves or rejects requests. A "boss" is simply someone who is both. No roles means the account is pending.</p>
        </div>
      </div>

      {err && <div style={{ marginBottom: 12 }}><span className="badge error">{err}</span></div>}

      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <div className="stack" style={{ gap: 12 }}>
          <label className="hstack" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, width: 150 }}>Quant distribution email</span>
            <input className="input" style={{ maxWidth: 320 }} value={dist} onChange={(e) => setDist(e.target.value)} placeholder="quant-team@firm.com" />
            <span className="faint" style={{ fontSize: 12 }}>CC'd on every approval-request email.</span>
          </label>
          <label className="hstack" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, width: 150 }}>JIRA epic</span>
            <input className="input mono" style={{ maxWidth: 320 }} value={epic} onChange={(e) => setEpic(e.target.value)} placeholder="BSGPTALGO-550" />
            <span className="faint" style={{ fontSize: 12 }}>Config-change tickets are created under this epic.</span>
          </label>
          <div><button className="btn btn-sm" disabled={!settingsDirty} onClick={saveSettings}>Save settings</button></div>
        </div>
      </div>

      <AddPerson onDone={refresh} onError={setErr} />

      {!users ? (
        <div className="panel"><Skeleton rows={5} /></div>
      ) : (
        <div className="panel">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Windows ID</th>
                <th>Name</th>
                <th>Email</th>
                <th style={{ width: 300 }}>Roles</th>
                <th style={{ width: 70, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.windowsId}>
                  <td className="mono" style={{ fontWeight: 600 }}>{u.windowsId}</td>
                  <td>{u.displayName}</td>
                  <td className="faint">{u.email || '—'}</td>
                  <td>
                    <RoleToggles roles={u.roles} disabled={u.windowsId === me?.windowsId}
                      onChange={(roles) => run(api.updateUser(u.windowsId, { roles }))} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-danger" disabled={u.windowsId === me?.windowsId}
                      onClick={() => run(api.deleteUser(u.windowsId))}><IconTrash style={{ width: 14, height: 14 }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RoleToggles({ roles, disabled, onChange }: { roles: Role[]; disabled?: boolean; onChange: (roles: Role[]) => void }) {
  function toggle(r: Role) {
    onChange(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  }
  return (
    <span className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
      {ROLES.map((r) => (
        <button key={r} type="button" className="btn btn-sm" disabled={disabled}
          style={roles.includes(r) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          onClick={() => toggle(r)}>{ROLE_LABEL[r]}</button>
      ))}
      {roles.length === 0 && <span className="faint" style={{ fontSize: 12 }}>pending</span>}
    </span>
  );
}

function AddPerson({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [windowsId, setWindowsId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Role[]>(['editor']);
  const [busy, setBusy] = useState(false);

  function toggle(r: Role) {
    setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  }

  const valid = windowsId.trim().length > 0 && displayName.trim().length > 0 && email.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      await api.createUser({ windowsId: windowsId.trim(), displayName: displayName.trim(), email: email.trim(), roles });
      setWindowsId(''); setDisplayName(''); setEmail(''); setRoles(['editor']);
      onDone();
    } catch (e) { onError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <label className="field" style={{ margin: 0 }}><span>Windows ID</span><input className="input" value={windowsId} onChange={(e) => setWindowsId(e.target.value)} placeholder="salavat" spellCheck={false} /></label>
        <label className="field" style={{ margin: 0 }}><span>Name</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Salavat Example" /></label>
        <label className="field" style={{ margin: 0 }}><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="salavat@firm.com" /></label>
      </div>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="faint" style={{ fontSize: 12 }}>Roles</span>
          {ROLES.map((r) => (
            <button key={r} type="button" className="btn btn-sm" style={roles.includes(r) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => toggle(r)}>{ROLE_LABEL[r]}</button>
          ))}
          <span className="faint" style={{ fontSize: 12 }}>{roleSummary(roles)}</span>
        </div>
        <div className="hstack">
          {!valid && <span className="faint" style={{ fontSize: 12 }}>Windows ID, name, and email are required.</span>}
          <button className="btn btn-primary" onClick={submit} disabled={busy || !valid}>{busy ? <span className="spinner" /> : <IconPlus />}Add person</button>
        </div>
      </div>
    </div>
  );
}
