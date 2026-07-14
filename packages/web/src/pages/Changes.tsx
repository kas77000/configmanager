import { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canEdit, api, type Change, type InstanceInfo, type User } from '../api';
import { Banner, ChangeStatusBadge, Skeleton, relTime } from '../components';
import { IconBranch, IconPlus, IconX } from '../icons';

export default function Changes({ me }: { me: User | null }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.changes().then(setChanges).catch(() => setChanges([]));
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  const canCreate = canEdit(me?.roles);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workflow</div>
          <h1>Changes</h1>
          <p>A change bundles one or more modifications. Each modification is a config file with its own description and the instances it applies to.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)} disabled={!canCreate}><IconPlus />New change</button>
      </div>

      {creating && canCreate && <NewChange instances={instances} onCancel={() => setCreating(false)} />}

      {!changes ? (
        <div className="panel"><Skeleton rows={4} /></div>
      ) : changes.length === 0 ? (
        <div className="panel"><div className="empty">
          <IconBranch style={{ width: 22, height: 22, opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>No changes yet.</div>
        </div></div>
      ) : (
        <div className="panel">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 70 }}>ID</th>
                <th>Change</th>
                <th style={{ width: 110 }}>Effective</th>
                <th style={{ width: 70 }}>Files</th>
                <th style={{ width: 180 }}>Instances</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 100 }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {[...changes].reverse().map((c) => <ChangeRow key={c.id} c={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChangeRow({ c }: { c: Change }) {
  const nav = useNavigate();
  const files = [...new Set(c.items.map((i) => i.file))];
  return (
    <tr className="rowlink" onClick={() => nav(`/changes/${c.id}`)}>
      <td className="mono" style={{ fontWeight: 600 }}>{c.id}</td>
      <td>{c.description}</td>
      <td className="mono" style={{ fontSize: 12 }}>{c.effectiveDate ?? <span className="faint">—</span>}</td>
      <td className="mono faint" style={{ fontSize: 12 }}>{files.length}</td>
      <td className="mono faint" style={{ fontSize: 12 }}>{c.targets.map((t) => t.instance).join(', ')}</td>
      <td><ChangeStatusBadge status={c.status} /></td>
      <td className="faint" style={{ fontSize: 12 }}>{relTime(c.createdAt)}</td>
    </tr>
  );
}

interface DraftItem { file: string; description: string; instances: string[] }

function NewChange({ instances, onCancel }: { instances: InstanceInfo[]; onCancel: () => void }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [items, setItems] = useState<DraftItem[]>([{ file: '', description: '', instances: [] }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allFiles = useMemo(() => [...new Set(instances.flatMap((i) => i.files))].sort(), [instances]);
  const eligible = (file: string) => instances.filter((i) => i.files.includes(file));

  function setItem(idx: number, patch: Partial<DraftItem>) {
    setItems((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function setFile(idx: number, file: string) {
    // keep only instances that manage the newly-chosen file
    const keep = items[idx].instances.filter((c) => eligible(file).some((i) => i.code === c));
    setItem(idx, { file, instances: keep });
  }
  function toggleInst(idx: number, code: string) {
    const cur = items[idx].instances;
    setItem(idx, { instances: cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code] });
  }

  const valid = title.trim().length > 0 && effectiveDate.length > 0 && items.length > 0 &&
    items.every((it) => it.file && it.description.trim() && it.instances.length > 0);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const change = await api.createChange(title.trim(), items.map((it) => ({ file: it.file, description: it.description.trim(), instances: it.instances })), effectiveDate);
      nav(`/changes/${change.id}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not create the change.'); setBusy(false); }
  }

  const label = { display: 'block', fontSize: 13, color: 'var(--text)', fontWeight: 600, marginBottom: 8 } as const;
  const sub = { display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 } as const;
  const sel = { borderColor: 'var(--accent)', color: 'var(--accent)' };

  return (
    <div className="panel" style={{ padding: 24, marginBottom: 24 }}>
      <div className="stack" style={{ gap: 24 }}>
        <div className="hstack" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <label style={{ display: 'block', flex: 1, minWidth: 300 }}>
            <span style={label}>Change title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Korea rollout: restrict Post layering" />
            <span className="faint" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>A short name for the whole change. Each file gets its own description below.</span>
          </label>
          <label style={{ display: 'block', flex: '0 0 190px' }}>
            <span style={label}>Effective date</span>
            <input className="input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            <span className="faint" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>When it takes effect for trading.</span>
          </label>
        </div>

        <div>
          <div className="row-between" style={{ marginBottom: 14 }}>
            <span style={label}>Modifications<span className="faint" style={{ fontWeight: 400 }}> · {items.length}</span></span>
          </div>

          {items.map((it, idx) => (
            <div key={idx} style={{ paddingTop: idx === 0 ? 0 : 18, marginTop: idx === 0 ? 0 : 18, borderTop: idx === 0 ? undefined : '1px solid var(--border)' }}>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Modification {idx + 1}</span>
                {items.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}><IconX style={{ width: 13, height: 13 }} />Remove</button>}
              </div>

              <div className="hstack" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
                <label style={{ flex: '0 0 240px' }}>
                  <span style={sub}>Config file</span>
                  <select className="input mono" value={it.file} onChange={(e) => setFile(idx, e.target.value)}>
                    <option value="">Select a file</option>
                    {allFiles.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label style={{ flex: 1, minWidth: 260 }}>
                  <span style={sub}>Description</span>
                  <input className="input" placeholder="What this change does to the file" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                </label>
              </div>

              <div>
                <span style={sub}>Applies to instances{it.instances.length > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {it.instances.length} selected</span>}</span>
                {!it.file ? (
                  <div className="faint" style={{ fontSize: 12 }}>Select a file first; only instances that manage it can be chosen.</div>
                ) : eligible(it.file).length === 0 ? (
                  <div className="faint" style={{ fontSize: 12 }}>No instance manages this file yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {eligible(it.file).map((i) => (
                      <button key={i.code} type="button" className="btn btn-sm" style={it.instances.includes(i.code) ? sel : undefined} onClick={() => toggleInst(idx, i.code)}>
                        {i.code}{i.uat ? ' · UAT' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          <button className="btn btn-sm btn-ghost" style={{ marginTop: 16 }} onClick={() => setItems((a) => [...a, { file: '', description: '', instances: [] }])}><IconPlus style={{ width: 13, height: 13 }} />Add modification</button>
        </div>

        {err && <Banner kind="error">{err}</Banner>}

        <div className="hstack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !valid}>{busy ? <span className="spinner" /> : <IconPlus />}Create change</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {!valid && !busy && <span className="faint" style={{ fontSize: 12 }}>Give the change a title and effective date, and each modification a file, a description, and at least one instance.</span>}
        </div>
      </div>
    </div>
  );
}
