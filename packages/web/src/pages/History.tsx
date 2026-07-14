import { useEffect, useState } from 'react';
import { api, type AuditEvent, type Commit } from '../api';
import { Skeleton, relTime } from '../components';

export default function History() {
  const [data, setData] = useState<{ commits: Commit[]; audit: AuditEvent[] } | null>(null);

  useEffect(() => {
    api.history().then(setData).catch(() => setData({ commits: [], audit: [] }));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Traceability</div>
          <h1>History</h1>
          <p>Every branch, edit, review, and merge, with who did it and when.</p>
        </div>
      </div>

      {!data ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <section>
            <div className="group-title"><h2>Activity</h2><span className="count-chip">{data.audit.length}</span></div>
            <div className="panel">
              {data.audit.length === 0 ? <div className="empty">No activity yet.</div> : (
                <div className="stack">
                  {[...data.audit].reverse().map((e) => (
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
            <div className="group-title"><h2>Commits</h2><span className="count-chip">{data.commits.length}</span></div>
            <div className="panel">
              {data.commits.length === 0 ? <div className="empty">No commits yet.</div> : (
                <div className="stack">
                  {data.commits.map((c) => (
                    <div key={c.hash} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div className="hstack" style={{ justifyContent: 'space-between' }}>
                        <span className="mono" style={{ color: 'var(--accent)' }}>{c.hash.slice(0, 8)}</span>
                        {c.refs && <RefBadges refs={c.refs} />}
                      </div>
                      <div style={{ marginTop: 2 }}>{c.subject}</div>
                      <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                        {c.authorName} · {relTime(c.date)}{c.parents.length > 1 ? ' · merge' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function actionText(action: string): string {
  switch (action) {
    case 'create-change': return 'opened change';
    case 'create-branch': return 'created branch';
    case 'edit': return 'edited';
    case 'merge': return 'merged into';
    case 'sync-import': return 'synced live version into';
    case 'verify-instance': return 'verified';
    default: return action;
  }
}

function renderDetails(e: AuditEvent) {
  const d = e.details ?? {};
  const bits: string[] = [];
  if (typeof d.changeId === 'string') bits.push(d.changeId);
  if (d.override) bits.push('override');
  if (typeof d.overrideReason === 'string') bits.push(`"${d.overrideReason}"`);
  if (typeof d.inSync === 'boolean') bits.push(d.inSync ? 'in sync' : 'drift');
  if (!bits.length) return null;
  return <span className="faint" style={{ fontSize: 12 }}> · {bits.join(' · ')}</span>;
}

function RefBadges({ refs }: { refs: string }) {
  const parts = refs.split(',').map((r) => r.trim().replace(/^HEAD -> /, '')).filter(Boolean);
  return (
    <span className="hstack" style={{ gap: 4 }}>
      {parts.slice(0, 3).map((r) => (
        <span key={r} className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>{r}</span>
      ))}
    </span>
  );
}
