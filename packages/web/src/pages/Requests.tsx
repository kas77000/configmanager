import { useEffect, useState } from 'react';
import { canApprove, api, type Change, type User } from '../api';
import { Banner, ChangeStatusBadge, Skeleton, relTime } from '../components';
import { IconCheck, IconX } from '../icons';

export default function Requests({ me }: { me: User | null }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() { setChanges(await api.changes()); }
  useEffect(() => { refresh().catch(() => setChanges([])); }, []);

  const decide = canApprove(me?.roles);

  async function run<T>(p: Promise<T>) {
    setErr(null);
    try { await p; await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
  }

  const pending = (changes ?? []).filter((c) => c.status === 'submitted');
  const decided = (changes ?? []).filter((c) => c.status !== 'submitted' && c.status !== 'draft');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Approvals</div>
          <h1>Requests</h1>
          <p>Change requests awaiting a decision. Each shows what is being changed and the instances it targets. You approve or reject the request; the quant team handles the config itself.</p>
        </div>
      </div>

      {err && <div style={{ marginBottom: 12 }}><span className="badge error">{err}</span></div>}

      {!changes ? (
        <div className="panel"><Skeleton rows={4} /></div>
      ) : (
        <>
          <div className="group-title"><h2>Awaiting decision</h2><span className="count-chip">{pending.length}</span></div>
          {pending.length === 0 ? (
            <div className="panel"><div className="empty">Nothing awaiting a decision.</div></div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {pending.map((c) => <RequestCard key={c.id} c={c} decide={decide} run={run} />)}
            </div>
          )}

          {decided.length > 0 && (
            <>
              <div className="group-title" style={{ marginTop: 28 }}><h2>Decided</h2><span className="count-chip">{decided.length}</span></div>
              <div className="panel">
                <table className="list">
                  <thead><tr><th style={{ width: 70 }}>ID</th><th>Description</th><th style={{ width: 160 }}>Instances</th><th style={{ width: 100 }}>Status</th><th style={{ width: 160 }}>Decision</th></tr></thead>
                  <tbody>
                    {[...decided].reverse().map((c) => (
                      <tr key={c.id}>
                        <td className="mono" style={{ fontWeight: 600 }}>{c.id}</td>
                        <td>{c.description}</td>
                        <td className="mono faint" style={{ fontSize: 12 }}>{c.targets.map((t) => t.instance).join(', ')}</td>
                        <td><ChangeStatusBadge status={c.status} /></td>
                        <td className="faint" style={{ fontSize: 12 }}>{c.decision ? `${c.decision.by} · ${relTime(c.decision.at)}` : c.status === 'merged' ? 'applied' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function RequestCard({ c, decide, run }: { c: Change; decide: boolean; run: <T>(p: Promise<T>) => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="hstack" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontWeight: 600 }}>{c.id}</span>
            <ChangeStatusBadge status={c.status} />
            {(c.jiraTickets ?? []).map((t) => <a key={t.key} className="tag mono" href={t.url} target="_blank" rel="noreferrer" title={t.file} style={{ color: 'var(--accent)' }}>{t.key}</a>)}
          </div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>{c.description}{c.effectiveDate && <span className="faint" style={{ fontWeight: 400 }}> · effective {c.effectiveDate}</span>}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            Requested by <span className="mono">{c.submittedBy ?? c.createdBy}</span>{c.submittedAt ? ` · ${relTime(c.submittedAt)}` : ''}
          </div>
          <div className="hstack" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instances</span>
            {c.targets.map((t) => <span key={t.instance} className="tag mono">{t.instance}</span>)}
          </div>
        </div>
        {decide && (
          <div className="hstack">
            <button className="btn btn-sm" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} onClick={() => run(api.approveChange(c.id))}>
              <IconCheck style={{ width: 14, height: 14 }} />Approve
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => setRejecting((v) => !v)}><IconX style={{ width: 14, height: 14 }} />Reject</button>
          </div>
        )}
      </div>
      {rejecting && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="warning">Rejecting sends the request back to the quant team.</Banner>
          <div className="hstack" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
            <button className="btn btn-sm btn-danger" onClick={() => run(api.rejectChange(c.id, reason))}>Confirm reject</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
