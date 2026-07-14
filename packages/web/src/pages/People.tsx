import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABEL, api, type Role, type User } from '../api';
import { Skeleton } from '../components';
import { IconPlus, IconTrash } from '../icons';

export default function People({ me }: { me: User | null }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() { setUsers(await api.users()); }
  useEffect(() => { refresh().catch(() => setUsers([])); }, []);

  if (me && me.role !== 'admin') {
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
          <p>Add team members by Windows ID and give them a role. Quant (editor) creates and reviews changes; Boss (approver) also approves; Stakeholders only approve or reject requests.</p>
        </div>
      </div>

      {err && <div style={{ marginBottom: 12 }}><span className="badge error">{err}</span></div>}

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
                <th style={{ width: 180 }}>Role</th>
                <th style={{ width: 90, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.windowsId}>
                  <td className="mono" style={{ fontWeight: 600 }}>{u.windowsId}</td>
                  <td>{u.displayName}</td>
                  <td className="faint">{u.email || '—'}</td>
                  <td>
                    <select className="input" style={{ height: 28, padding: '0 8px' }} value={u.role}
                      disabled={u.windowsId === me?.windowsId}
                      onChange={(e) => run(api.updateUser(u.windowsId, { role: e.target.value as Role }))}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
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

function AddPerson({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [windowsId, setWindowsId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!windowsId.trim()) return onError('Windows ID required.');
    setBusy(true);
    try {
      await api.createUser({ windowsId: windowsId.trim(), displayName: displayName.trim() || undefined, email: email.trim() || undefined, role });
      setWindowsId(''); setDisplayName(''); setEmail(''); setRole('editor');
      onDone();
    } catch (e) { onError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}><span>Windows ID</span><input className="input" value={windowsId} onChange={(e) => setWindowsId(e.target.value)} placeholder="salavat" spellCheck={false} /></label>
        <label className="field" style={{ margin: 0 }}><span>Name</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optional" /></label>
        <label className="field" style={{ margin: 0 }}><span>Email</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></label>
        <label className="field" style={{ margin: 0 }}><span>Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.filter((r) => r !== 'pending').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <span className="spinner" /> : <IconPlus />}Add</button>
      </div>
    </div>
  );
}
