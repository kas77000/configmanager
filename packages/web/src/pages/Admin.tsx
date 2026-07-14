import { useEffect, useState } from 'react';
import { api, isAdmin, type Environment, type InstanceInfo, type User } from '../api';
import { Skeleton } from '../components';
import { IconChevron, IconPlus, IconTrash, IconX } from '../icons';

export default function Admin({ me }: { me: User | null }) {
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setInstances(await api.instances());
  }
  useEffect(() => { refresh().catch(() => setInstances([])); }, []);

  if (me && !isAdmin(me.roles)) {
    return <div className="page"><div className="panel"><div className="empty">Admin only.</div></div></div>;
  }

  async function run<T>(p: Promise<T>) {
    setErr(null);
    try { await p; await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1>Instances</h1>
          <p>Add, edit, or remove instances and the config files managed for each. New instances branch from an existing one, inheriting its files.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}><IconPlus />Add instance</button>
      </div>

      {err && <div style={{ marginBottom: 12 }}><span className="badge error">{err}</span></div>}

      {adding && instances && (
        <AddInstance instances={instances} onDone={() => { setAdding(false); refresh(); }} onError={setErr} />
      )}

      {!instances ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        <div className="panel">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Instance</th>
                <th style={{ width: 150 }}>Environment</th>
                <th style={{ width: 70 }}>UAT</th>
                <th>Managed files</th>
                <th style={{ width: 110, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <InstanceRow key={i.code} inst={i} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InstanceRow({ inst, run }: { inst: InstanceInfo; run: <T>(p: Promise<T>) => Promise<void> }) {
  const [addingFile, setAddingFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [server, setServer] = useState(inst.serverAddress ?? '');

  return (
    <>
      <tr>
        <td className="mono" style={{ fontWeight: 600 }}>
          <button className="btn-ghost" style={{ border: 0, background: 'none', padding: 0, marginRight: 6, cursor: 'pointer', color: 'var(--faint)', display: 'inline-flex', verticalAlign: 'middle' }} onClick={() => setExpanded((v) => !v)}>
            <IconChevron style={{ width: 13, height: 13, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms var(--ease)' }} />
          </button>
          {inst.code}
        </td>
        <td>
          <select className="input" style={{ height: 28, padding: '0 8px' }} value={inst.environment}
            onChange={(e) => run(api.updateInstance(inst.code, { environment: e.target.value as Environment }))}>
            <option value="pilot">pilot</option>
            <option value="production">production</option>
          </select>
        </td>
        <td>
          <input type="checkbox" checked={inst.uat} title="Set as UAT instance"
            onChange={(e) => run(api.updateInstance(inst.code, { uat: e.target.checked }))} />
        </td>
        <td>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {inst.files.map((f) => (
              <span key={f} className="chip">
                {f}
                <button className="btn-ghost" title="Stop managing this file"
                  style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'var(--faint)' }}
                  onClick={() => run(api.removeInstanceFile(inst.code, f))}>
                  <IconX style={{ width: 12, height: 12 }} />
                </button>
              </span>
            ))}
            {addingFile ? (
              <span className="hstack" style={{ gap: 4 }}>
                <input className="input" style={{ height: 26, width: 180 }} placeholder="filename.properties" autoFocus
                  value={fileName} onChange={(e) => setFileName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && fileName.trim()) { run(api.addInstanceFile(inst.code, fileName.trim())); setFileName(''); setAddingFile(false); } }} />
                <button className="btn btn-sm btn-primary" disabled={!fileName.trim()}
                  onClick={() => { run(api.addInstanceFile(inst.code, fileName.trim())); setFileName(''); setAddingFile(false); }}>Add</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setAddingFile(false)}>Cancel</button>
              </span>
            ) : (
              <button className="btn btn-sm btn-ghost" onClick={() => setAddingFile(true)}><IconPlus style={{ width: 13, height: 13 }} />file</button>
            )}
          </div>
        </td>
        <td style={{ textAlign: 'right' }}>
          {confirmDel ? (
            <span className="hstack" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-danger" onClick={() => run(api.deleteInstance(inst.code))}>Confirm</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(false)}>No</button>
            </span>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmDel(true)}><IconTrash style={{ width: 14, height: 14 }} />Delete</button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--raised)' }}>
            <div className="stack" style={{ gap: 12, padding: '6px 4px 10px' }}>
              <label className="hstack" style={{ gap: 8 }}>
                <span className="faint" style={{ fontSize: 12, width: 120 }}>Server address</span>
                <input className="input mono" style={{ height: 28, maxWidth: 420 }} placeholder="\\APIA\config or api-a.firm.com" value={server}
                  onChange={(e) => setServer(e.target.value)} onBlur={() => { if (server !== (inst.serverAddress ?? '')) run(api.updateInstance(inst.code, { serverAddress: server })); }} />
              </label>
              {inst.files.length > 0 && <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>File paths on the server</div>}
              {inst.files.map((f) => <PathRow key={f} code={inst.code} file={f} path={inst.paths?.[f] ?? ''} run={run} />)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PathRow({ code, file, path, run }: { code: string; file: string; path: string; run: <T>(p: Promise<T>) => Promise<void> }) {
  const [value, setValue] = useState(path);
  return (
    <label className="hstack" style={{ gap: 8 }}>
      <span className="mono" style={{ fontSize: 12, width: 180, color: 'var(--muted)' }}>{file}</span>
      <input className="input mono" style={{ height: 28, flex: 1, maxWidth: 520 }} placeholder="path to this file on the server" value={value}
        onChange={(e) => setValue(e.target.value)} onBlur={() => { if (value !== path) run(api.setInstanceFilePath(code, file, value)); }} />
    </label>
  );
}

function AddInstance({ instances, onDone, onError }: { instances: InstanceInfo[]; onDone: () => void; onError: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [environment, setEnvironment] = useState<Environment>('production');
  const [uat, setUat] = useState(false);
  const [copyFrom, setCopyFrom] = useState(instances[0]?.code ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!code.trim()) return onError('Instance code required.');
    setBusy(true);
    try {
      await api.createInstance({ code: code.trim().toUpperCase(), environment, uat, copyFrom: copyFrom || undefined });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'failed');
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="APIN" spellCheck={false} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Environment</span>
          <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
            <option value="pilot">pilot</option>
            <option value="production">production</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Copy files from</span>
          <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {instances.map((i) => <option key={i.code} value={i.code}>{i.code}</option>)}
          </select>
        </label>
        <label className="hstack" style={{ cursor: 'pointer', height: 34 }}>
          <input type="checkbox" checked={uat} onChange={(e) => setUat(e.target.checked)} />
          <span>UAT instance</span>
        </label>
      </div>
      <div className="hstack" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <span className="spinner" /> : <IconPlus />}Create</button>
        <button className="btn btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
