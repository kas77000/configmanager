import { useEffect, useState } from 'react';
import { api, isAdmin, type Environment, type InstanceInfo, type LocationType, type User } from '../api';
import { InfoTip, Skeleton, Tooltip } from '../components';
import { IconChevron, IconPlus, IconTrash, IconX } from '../icons';

const LOCATION_LABEL: Record<LocationType, string> = { local: 'Local folder', shared: 'Shared drive', server: 'Server' };
const LOCATION_PLACEHOLDER: Record<LocationType, string> = {
  local: 'C:\\configs\\APIA',
  shared: '\\\\fileserver\\algo\\APIA',
  server: 'api-a.firm.com',
};

/** Joins an instance location with a file's relative path, inferring the separator from the base. */
function joinLocation(base: string, rel: string): string {
  const b = base.trim().replace(/[\\/]+$/, '');
  const r = rel.trim().replace(/^[\\/]+/, '');
  if (!b) return r;
  if (!r) return b;
  const sep = /\\/.test(b) || /^[a-zA-Z]:/.test(b) ? '\\' : '/';
  return `${b}${sep}${r}`;
}

type PickResult = { ok: true; name: string } | { ok: false; reason: string };

/** Best-effort folder picker. Browsers can't expose a full filesystem path, so this only ever
 *  returns the chosen folder's NAME. Uses the File System Access API when available, else a
 *  directory <input> fallback (which needs the folder to contain at least one file). */
async function pickFolder(): Promise<PickResult> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> };
  if (typeof w.showDirectoryPicker === 'function') {
    try { return { ok: true, name: (await w.showDirectoryPicker()).name }; }
    catch (e) { return { ok: false, reason: (e as DOMException)?.name === 'AbortError' ? '' : 'The folder picker was blocked by the browser.' }; }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (r: PickResult) => { input.remove(); resolve(r); };
    input.addEventListener('change', () => {
      const rel = (input.files?.[0] as unknown as { webkitRelativePath?: string })?.webkitRelativePath ?? '';
      done(rel ? { ok: true, name: rel.split('/')[0] } : { ok: false, reason: 'Could not read that folder (it may be empty). Type the path instead.' });
    });
    input.addEventListener('cancel', () => done({ ok: false, reason: '' }));
    input.click();
  });
}

export default function Admin({ me }: { me: User | null }) {
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saUser, setSaUser] = useState('');
  const [saConfigured, setSaConfigured] = useState(false);

  async function refresh() {
    setInstances(await api.instances());
  }
  useEffect(() => {
    refresh().catch(() => setInstances([]));
    api.settings().then((s) => { setSaUser(s.serviceAccountUser); setSaConfigured(s.serviceAccountConfigured); }).catch(() => {});
  }, []);

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

      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="hstack" style={{ gap: 5, fontWeight: 600, fontSize: 13 }}>
              Service account
              <InfoTip text={<>Used to connect to <strong>server</strong>-type instances. Local folders and shared drives are read directly, without it. Configured on the server via the <span className="mono">.env</span> file (<span className="mono">SERVICE_ACCOUNT_USER</span> and <span className="mono">SERVICE_ACCOUNT_PASSWORD</span>); the password never leaves the server.</>} />
            </span>
            {saConfigured
              ? <span className="badge success" style={{ fontSize: 11 }}>configured</span>
              : <span className="badge warning" style={{ fontSize: 11 }}>not configured</span>}
          </div>
          <div className="hstack" style={{ gap: 8 }}>
            <span className="faint" style={{ fontSize: 12, width: 110 }}>Username</span>
            <span className="mono" style={{ fontSize: 13 }}>{saUser || <span className="faint">not set</span>}</span>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>Used only to reach server-type instances. Local folders and shared drives need no credentials.</div>
        </div>
      </div>

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
                <InstanceRow key={i.code} inst={i} run={run} sa={{ user: saUser, configured: saConfigured }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InstanceRow({ inst, run, sa }: { inst: InstanceInfo; run: <T>(p: Promise<T>) => Promise<void>; sa: { user: string; configured: boolean } }) {
  const [addingFile, setAddingFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [server, setServer] = useState(inst.serverAddress ?? '');
  const [locType, setLocType] = useState<LocationType>(inst.locationType ?? 'server');
  const [browseMsg, setBrowseMsg] = useState('');
  const saveServer = () => { if (server !== (inst.serverAddress ?? '')) run(api.updateInstance(inst.code, { serverAddress: server })); };

  async function browse() {
    const r = await pickFolder();
    if (r.ok) {
      const full = joinLocation(server, r.name); // append the folder name to whatever's already typed
      setServer(full);
      setBrowseMsg(`Added folder "${r.name}". Complete the full path if needed, then click away to save.`);
      run(api.updateInstance(inst.code, { serverAddress: full }));
    } else if (r.reason) {
      setBrowseMsg(r.reason);
    }
  }

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
                <span className="faint" style={{ fontSize: 12, width: 120 }}>Location type</span>
                <select className="input" style={{ height: 28, padding: '0 8px', width: 160 }} value={locType}
                  onChange={(e) => { const v = e.target.value as LocationType; setLocType(v); run(api.updateInstance(inst.code, { locationType: v })); }}>
                  <option value="local">{LOCATION_LABEL.local}</option>
                  <option value="shared">{LOCATION_LABEL.shared}</option>
                  <option value="server">{LOCATION_LABEL.server}</option>
                </select>
              </label>
              <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="faint" style={{ fontSize: 12, width: 120 }}>{locType === 'server' ? 'Server address' : 'Location'}</span>
                <input className="input mono" style={{ height: 28, flex: 1, minWidth: 220, maxWidth: 420 }} placeholder={LOCATION_PLACEHOLDER[locType]} value={server}
                  onChange={(e) => setServer(e.target.value)} onBlur={saveServer} />
                {locType !== 'server' && (
                  <button className="btn btn-sm" title="The browser only exposes the folder name, not its full path — you may need to complete it"
                    onClick={browse}>Browse…</button>
                )}
              </div>
              {browseMsg && <div className="faint" style={{ fontSize: 12, paddingLeft: 128 }}>{browseMsg}</div>}
              <div className="hstack" style={{ gap: 8 }}>
                <span className="faint" style={{ fontSize: 12, width: 120 }}>Access</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {locType === 'server'
                    ? (sa.configured
                        ? <>Connects via the service account <span className="mono">{sa.user}</span>.</>
                        : <span style={{ color: 'var(--warning)' }}>Server access needs a service account — none is configured (set it in <span className="mono">.env</span>).</span>)
                    : 'Read directly from this location — no service account needed.'}
                </span>
              </div>
              {inst.files.length > 0 && (
                <div className="faint" style={{ fontSize: 11 }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>File paths</span> — relative to the location; leave blank if the file sits directly in it.
                </div>
              )}
              {inst.files.map((f) => <PathRow key={f} code={inst.code} file={f} path={inst.paths?.[f] ?? ''} base={server} run={run} />)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PathRow({ code, file, path, base, run }: { code: string; file: string; path: string; base: string; run: <T>(p: Promise<T>) => Promise<void> }) {
  const [value, setValue] = useState(path);
  const effective = joinLocation(base, value.trim() || file);
  return (
    <div className="stack" style={{ gap: 3 }}>
      <label className="hstack" style={{ gap: 8 }}>
        <span className="mono" style={{ fontSize: 12, width: 180, color: 'var(--muted)' }}>{file}</span>
        <input className="input mono" style={{ height: 28, flex: 1, maxWidth: 520 }} placeholder={file} value={value}
          onChange={(e) => setValue(e.target.value)} onBlur={() => { if (value !== path) run(api.setInstanceFilePath(code, file, value)); }} />
      </label>
      <div className="faint mono" style={{ fontSize: 11, paddingLeft: 188, wordBreak: 'break-all' }}>→ {effective}</div>
    </div>
  );
}

function AddInstance({ instances, onDone, onError }: { instances: InstanceInfo[]; onDone: () => void; onError: (m: string) => void }) {
  const [code, setCode] = useState('');
  const [environment, setEnvironment] = useState<Environment>('production');
  const [uat, setUat] = useState(false);
  const [copyFrom, setCopyFrom] = useState(instances[0]?.code ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!code.trim()) return;
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
        <Tooltip content={!code.trim() && !busy ? 'Enter an instance code first' : undefined}>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !code.trim()}>{busy ? <span className="spinner" /> : <IconPlus />}Create</button>
        </Tooltip>
        <button className="btn btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
