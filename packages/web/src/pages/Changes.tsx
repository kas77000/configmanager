import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canEdit, api, type Change, type InstanceInfo, type User } from '../api';
import { Banner, ChangeStatusBadge, Skeleton, relTime } from '../components';
import { IconBranch, IconPlus } from '../icons';

export default function Changes({ me }: { me: User | null }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.changes().then(setChanges).catch(() => setChanges([]));
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  const canCreate = canEdit(me?.role);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workflow</div>
          <h1>Changes</h1>
          <p>A change is one methodology applied across instances. Each targeted instance gets its own edit and its own review.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)} disabled={!canCreate}>
          <IconPlus />New change
        </button>
      </div>

      {creating && canCreate && (
        <NewChange instances={instances} onCancel={() => setCreating(false)} />
      )}

      {!changes ? (
        <div className="panel"><Skeleton rows={4} /></div>
      ) : changes.length === 0 ? (
        <div className="panel"><div className="empty">
          <IconBranch style={{ width: 22, height: 22, opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>No changes yet. Start one to edit a config across instances.</div>
        </div></div>
      ) : (
        <div className="panel">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 70 }}>ID</th>
                <th>Description</th>
                <th style={{ width: 160 }}>Instances</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 120 }}>Created</th>
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
  return (
    <tr className="rowlink" onClick={() => nav(`/changes/${c.id}`)}>
      <td className="mono" style={{ fontWeight: 600 }}>{c.id}</td>
      <td>{c.description}</td>
      <td className="mono faint" style={{ fontSize: 12 }}>{c.targets.map((t) => t.instance).join(', ')}</td>
      <td><ChangeStatusBadge status={c.status} /></td>
      <td className="faint" style={{ fontSize: 12 }}>{relTime(c.createdAt)}</td>
    </tr>
  );
}

function NewChange({ instances, onCancel }: { instances: InstanceInfo[]; onCancel: () => void }) {
  const nav = useNavigate();
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedFiles, setPickedFiles] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Files a change can target = those managed by EVERY selected instance.
  const availableFiles = useMemo(() => {
    const chosen = instances.filter((i) => picked.has(i.code));
    if (chosen.length === 0) return [];
    return chosen.reduce<string[]>((acc, i, idx) => (idx === 0 ? [...i.files] : acc.filter((f) => i.files.includes(f))), []);
  }, [instances, picked]);

  // Keep the file selection valid as instances change; default-select ai.fixmsg.properties.
  useEffect(() => {
    setPickedFiles((prev) => {
      const next = new Set([...prev].filter((f) => availableFiles.includes(f)));
      if (next.size === 0 && availableFiles.includes('ai.fixmsg.properties')) next.add('ai.fixmsg.properties');
      return next;
    });
  }, [availableFiles]);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  }

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const change = await api.createChange(description.trim(), [...picked], [...pickedFiles]);
      nav(`/changes/${change.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the change.');
      setBusy(false);
    }
  }

  const groups: ('pilot' | 'production')[] = ['pilot', 'production'];
  const sel = { borderColor: 'var(--accent)', color: 'var(--accent)' };
  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--text)', fontWeight: 600, marginBottom: 8 } as const;
  const valid = description.trim().length > 0 && picked.size > 0 && pickedFiles.size > 0;

  return (
    <div className="panel" style={{ padding: 24, marginBottom: 24 }}>
      <div className="stack" style={{ gap: 22 }}>
        <label style={{ display: 'block' }}>
          <span style={labelStyle}>Description</span>
          <textarea className="input" style={{ minHeight: 76 }} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Restrict Post order layering to 1 in Korea (add 144=1)" />
        </label>

        <div>
          <div style={labelStyle}>Target instances{picked.size > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {picked.size} selected</span>}</div>
          <div className="stack" style={{ gap: 14 }}>
            {groups.map((g) => (
              <div key={g}>
                <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{g}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {instances.filter((i) => i.environment === g).map((i) => (
                    <button key={i.code} type="button" className="btn btn-sm" style={picked.has(i.code) ? sel : undefined}
                      onClick={() => toggle(picked, setPicked, i.code)}>{i.code}{i.uat ? ' · UAT' : ''}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Config files{pickedFiles.size > 0 && <span className="faint" style={{ fontWeight: 400 }}> · {pickedFiles.size} selected</span>}</div>
          {picked.size === 0 ? (
            <div className="faint" style={{ fontSize: 12 }}>Select one or more instances first.</div>
          ) : availableFiles.length === 0 ? (
            <div className="faint" style={{ fontSize: 12 }}>The selected instances share no managed files.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availableFiles.map((f) => (
                <button key={f} type="button" className="btn btn-sm mono" style={pickedFiles.has(f) ? sel : undefined}
                  onClick={() => toggle(pickedFiles, setPickedFiles, f)}>{f}</button>
              ))}
            </div>
          )}
        </div>

        {err && <Banner kind="error">{err}</Banner>}

        <div className="hstack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !valid}>
            {busy ? <span className="spinner" /> : <IconPlus />}Create change
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {!valid && !busy && <span className="faint" style={{ fontSize: 12 }}>Add a description, pick instances, and choose files.</span>}
        </div>
      </div>
    </div>
  );
}
