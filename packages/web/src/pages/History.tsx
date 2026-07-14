import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AuditEvent, type Commit, type InstanceInfo } from '../api';
import { Skeleton, relTime } from '../components';
import { IconChevron } from '../icons';

type Range = 'all' | '24h' | '7d' | '30d';
const RANGE_MS: Record<Range, number> = { all: Infinity, '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };

export default function History() {
  const [data, setData] = useState<{ commits: Commit[]; audit: AuditEvent[] } | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<Range>('all');

  useEffect(() => {
    api.history().then(setData).catch(() => setData({ commits: [], audit: [] }));
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  const cutoff = range === 'all' ? 0 : Date.now() - RANGE_MS[range];

  const audit = useMemo(() => {
    if (!data) return [];
    return [...data.audit].reverse().filter((e) =>
      new Date(e.timestamp).getTime() >= cutoff && matchInstances(auditInstances(e), selected));
  }, [data, cutoff, selected]);

  const commits = useMemo(() => {
    if (!data) return [];
    return data.commits.filter((c) =>
      new Date(c.date).getTime() >= cutoff && matchInstances(refInstances(c.refs), selected));
  }, [data, cutoff, selected]);

  function toggle(code: string) {
    setSelected((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Traceability</div>
          <h1>History</h1>
          <p>Every branch, edit, review, and merge, with who did it and when. Filter by instance and time, and open a commit to see exactly what changed.</p>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instances</span>
            {instances.map((i) => (
              <button key={i.code} className="btn btn-sm"
                style={selected.has(i.code) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => toggle(i.code)}>{i.code}</button>
            ))}
            {selected.size > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>clear</button>}
          </div>
          <div className="hstack">
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range</span>
            <select className="input" style={{ height: 28, width: 120, padding: '0 8px' }} value={range} onChange={(e) => setRange(e.target.value as Range)}>
              <option value="all">All time</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <section>
            <div className="group-title"><h2>Activity</h2><span className="count-chip">{audit.length}</span></div>
            <div className="panel">
              {audit.length === 0 ? <div className="empty">No activity in this filter.</div> : (
                <div className="stack">
                  {audit.map((e) => (
                    <div key={e.id} className="row-between" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span className="mono" style={{ fontWeight: 600 }}>{e.windowsId}</span>
                        <span className="muted"> {actionText(e.action)} </span>
                        {e.branch && <span className="mono faint" style={{ fontSize: 12 }}>{e.branch}</span>}
                        {renderDetails(e)}
                      </div>
                      <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{relTime(e.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="group-title"><h2>Commits</h2><span className="count-chip">{commits.length}</span></div>
            <div className="panel">
              {commits.length === 0 ? <div className="empty">No commits in this filter.</div> : (
                <div className="stack">
                  {commits.map((c) => <CommitRow key={c.hash} c={c} />)}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function CommitRow({ c }: { c: Commit }) {
  const nav = useNavigate();
  return (
    <div className="rowlink" style={{ padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
      onClick={() => nav(`/commits/${c.hash}`)}>
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <span className="hstack">
          <IconChevron style={{ width: 14, height: 14, color: 'var(--faint)' }} />
          <span className="mono" style={{ color: 'var(--accent)' }}>{c.hash.slice(0, 8)}</span>
        </span>
        {c.refs && <RefBadges refs={c.refs} />}
      </div>
      <div style={{ marginTop: 2, marginLeft: 22 }}>{c.subject}</div>
      <div className="faint" style={{ fontSize: 12, marginTop: 2, marginLeft: 22 }}>
        {c.authorName} · {relTime(c.date)}{c.parents.length > 1 ? ' · merge' : ''}
      </div>
    </div>
  );
}

function auditInstances(e: AuditEvent): string[] {
  const d = e.details as Record<string, unknown> | undefined;
  const out: string[] = [];
  if (typeof d?.instance === 'string') out.push(d.instance);
  if (Array.isArray(d?.instances)) out.push(...(d!.instances as string[]));
  if (e.branch) { const p = e.branch.split('/'); out.push(p[p.length - 1]); }
  return out;
}

function refInstances(refs: string): string[] {
  return refs.split(',').map((r) => r.trim().replace(/^HEAD -> /, '').split('/').pop() ?? '').filter(Boolean);
}

function matchInstances(codes: string[], selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  return codes.some((c) => selected.has(c));
}

function actionText(action: string): string {
  switch (action) {
    case 'create-change': return 'opened change';
    case 'create-branch': return 'created branch';
    case 'edit': return 'edited';
    case 'merge': return 'merged into';
    case 'sync-import': return 'synced live version into';
    case 'create-instance': return 'created instance';
    case 'update-instance': return 'updated instance';
    case 'delete-instance': return 'deleted instance';
    case 'add-file': return 'added managed file to';
    case 'remove-file': return 'stopped managing a file on';
    default: return action;
  }
}

function renderDetails(e: AuditEvent) {
  const d = e.details ?? {};
  const bits: string[] = [];
  if (typeof d.changeId === 'string') bits.push(d.changeId);
  if (typeof d.file === 'string') bits.push(d.file);
  if (d.override) bits.push('override');
  if (typeof d.overrideReason === 'string') bits.push(`"${d.overrideReason}"`);
  if (!bits.length) return null;
  return <span className="faint" style={{ fontSize: 12 }}> · {bits.join(' · ')}</span>;
}

function RefBadges({ refs }: { refs: string }) {
  const parts = refs.split(',').map((r) => r.trim().replace(/^HEAD -> /, '')).filter(Boolean);
  return (
    <span className="hstack" style={{ gap: 4 }}>
      {parts.slice(0, 3).map((r) => <span key={r} className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>{r}</span>)}
    </span>
  );
}
