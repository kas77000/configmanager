import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AuditEvent, type Commit, type InstanceInfo } from '../api';
import { Skeleton, relTime } from '../components';
import { IconChevron } from '../icons';

type Range = 'all' | '24h' | '7d' | '30d';
const RANGE_MS: Record<Range, number> = { all: Infinity, '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
const LANE_COLORS = ['var(--accent)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--uat)', 'var(--error)'];
const ROW_H = 36;
const LW = 16;

export default function History() {
  const [data, setData] = useState<{ commits: Commit[]; audit: AuditEvent[] } | null>(null);
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<Range>('24h');

  useEffect(() => {
    api.history().then(setData).catch(() => setData({ commits: [], audit: [] }));
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  const cutoff = range === 'all' ? 0 : Date.now() - RANGE_MS[range];

  const audit = useMemo(() => {
    if (!data) return [];
    return [...data.audit].reverse().filter((e) => new Date(e.timestamp).getTime() >= cutoff && matchInstances(auditInstances(e), selected));
  }, [data, cutoff, selected]);

  const commits = useMemo(() => {
    if (!data) return [];
    return data.commits.filter((c) => new Date(c.date).getTime() >= cutoff && matchInstances(c.instances, selected));
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
          <p>The commit graph across all instances, with who did what and when. Filter by instance and time; open a commit to see exactly what changed.</p>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instances</span>
            {instances.map((i) => (
              <button key={i.code} className="btn btn-sm" style={selected.has(i.code) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => toggle(i.code)}>{i.code}</button>
            ))}
            {selected.size > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>clear</button>}
          </div>
          <div className="hstack">
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range</span>
            <select className="input" style={{ height: 28, width: 120, padding: '0 8px' }} value={range} onChange={(e) => setRange(e.target.value as Range)}>
              <option value="all">All time</option><option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
            </select>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <Collapsible title="Activity" count={audit.length} defaultOpen>
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
          </Collapsible>

          <Collapsible title="Commit graph" count={commits.length} defaultOpen>
            <div className="panel" style={{ overflowX: 'auto' }}>
              {commits.length === 0 ? <div className="empty">No commits in this filter.</div> : <CommitGraph commits={commits} />}
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

function Collapsible({ title, count, defaultOpen, children }: { title: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section style={{ minWidth: 0 }}>
      <div className="group-title rowlink" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen((o) => !o)}>
        <IconChevron style={{ width: 16, height: 16, color: 'var(--faint)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms var(--ease)' }} />
        <h2>{title}</h2>
        <span className="count-chip">{count}</span>
      </div>
      {open && children}
    </section>
  );
}

interface GRow { commit: Commit; lane: number; inLanes: (string | null)[]; out: (string | null)[]; mine: number[]; parentLanes: Record<string, number>; }

function layout(commits: Commit[]): { rows: GRow[]; width: number } {
  const visible = new Set(commits.map((c) => c.hash));
  const firstFree = (arr: (string | null)[]) => { const i = arr.indexOf(null); return i !== -1 ? i : arr.length; };
  let lanes: (string | null)[] = [];
  let width = 1;
  const rows: GRow[] = [];
  for (const c of commits) {
    const inLanes = lanes.slice();
    const mine: number[] = [];
    inLanes.forEach((h, idx) => { if (h === c.hash) mine.push(idx); });
    const lane = mine.length > 0 ? mine[0] : firstFree(inLanes);
    const out = inLanes.slice();
    mine.forEach((idx) => (out[idx] = null));
    out[lane] = null;
    const parentLanes: Record<string, number> = {};
    const vps = c.parents.filter((p) => visible.has(p));
    vps.forEach((p, k) => {
      if (k === 0) { out[lane] = p; parentLanes[p] = lane; }
      else { let pl = out.indexOf(p); if (pl === -1) pl = firstFree(out); out[pl] = p; parentLanes[p] = pl; }
    });
    while (out.length && out[out.length - 1] === null) out.pop();
    lanes = out;
    width = Math.max(width, inLanes.length, out.length, lane + 1);
    rows.push({ commit: c, lane, inLanes, out, mine, parentLanes });
  }
  return { rows, width };
}

function CommitGraph({ commits }: { commits: Commit[] }) {
  const nav = useNavigate();
  const { rows, width } = useMemo(() => layout(commits), [commits]);
  const gw = width * LW + 10;
  const laneX = (l: number) => l * LW + LW / 2 + 5;
  const color = (l: number) => LANE_COLORS[l % LANE_COLORS.length];
  const mid = ROW_H / 2;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--faint)', fontWeight: 600 }}>
        <span style={{ width: gw, flex: 'none' }}>Graph</span>
        <span style={{ flex: 1 }}>Description</span>
        <span style={{ width: 110, flex: 'none' }}>Author</span>
        <span style={{ width: 78, flex: 'none', textAlign: 'right' }}>When</span>
      </div>
      {rows.map((r) => {
        const cx = laneX(r.lane);
        return (
          <div key={r.commit.hash} className="rowlink" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => nav(`/commits/${r.commit.hash}`)}>
            <svg width={gw} height={ROW_H} style={{ flex: 'none' }}>
              {r.inLanes.map((h, j) => (h && j !== r.lane && !r.mine.includes(j) && r.out[j] ? (
                <line key={`p${j}`} x1={laneX(j)} y1={0} x2={laneX(j)} y2={ROW_H} stroke={color(j)} strokeWidth={2} />
              ) : null))}
              {r.mine.filter((j) => j !== r.lane).map((j) => (
                <path key={`m${j}`} d={`M ${laneX(j)} 0 C ${laneX(j)} ${mid}, ${cx} ${mid}, ${cx} ${mid}`} stroke={color(j)} strokeWidth={2} fill="none" />
              ))}
              {Object.values(r.parentLanes).map((pl) => (
                <path key={`e${pl}`} d={`M ${cx} ${mid} C ${cx} ${mid + ROW_H / 4}, ${laneX(pl)} ${mid + ROW_H / 4}, ${laneX(pl)} ${ROW_H}`} stroke={color(pl)} strokeWidth={2} fill="none" />
              ))}
              <circle cx={cx} cy={mid} r={5} fill={color(r.lane)} stroke="var(--surface)" strokeWidth={1.5} />
            </svg>
            <div className="hstack" style={{ flex: 1, minWidth: 0, gap: 8, padding: '0 8px 0 2px', overflow: 'hidden' }}>
              <RefList refs={parseRefs(r.commit.refs)} color={color(r.lane)} />
              <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 40 }}>{r.commit.subject}</span>
              <span className="mono faint" style={{ fontSize: 11, flex: 'none' }}>{r.commit.hash.slice(0, 7)}</span>
            </div>
            <span className="faint" style={{ width: 110, flex: 'none', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.commit.authorName}</span>
            <span className="faint" style={{ width: 78, flex: 'none', fontSize: 12, textAlign: 'right', paddingRight: 12 }}>{relTime(r.commit.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

interface Ref { name: string; kind: 'instance' | 'change' | 'tag' | 'other'; head: boolean }

function parseRefs(refs: string): Ref[] {
  if (!refs) return [];
  return refs.split(',').map((s) => s.trim()).filter(Boolean).map((raw) => {
    let head = false;
    let name = raw;
    if (name.startsWith('HEAD -> ')) { head = true; name = name.slice(8); }
    if (name === 'HEAD') { head = true; }
    if (name.startsWith('tag: ')) return { name: name.slice(5), kind: 'tag' as const, head };
    const kind = name.startsWith('instance/') ? 'instance' as const : name.startsWith('change/') ? 'change' as const : 'other' as const;
    return { name, kind, head };
  }).filter((r) => r.name !== 'HEAD');
}

function RefList({ refs, color }: { refs: Ref[]; color: string }) {
  const MAX = 1;
  const shown = refs.slice(0, MAX);
  const extra = refs.slice(MAX);
  return (
    <span className="hstack" style={{ gap: 4, flex: 'none' }}>
      {shown.map((r, i) => <RefPill key={i} ref_={r} color={color} />)}
      {extra.length > 0 && (
        <span className="mono" title={extra.map((x) => x.name).join(', ')}
          style={{ flex: 'none', fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid var(--border-strong)', color: 'var(--muted)', whiteSpace: 'nowrap', cursor: 'default' }}>
          +{extra.length}
        </span>
      )}
    </span>
  );
}

function RefPill({ ref_, color }: { ref_: Ref; color: string }) {
  const instance = ref_.kind === 'instance';
  return (
    <span className="mono" style={{
      flex: 'none', fontSize: 10, padding: '1px 7px', borderRadius: 20, whiteSpace: 'nowrap',
      border: `1px solid ${color}`, color,
      background: instance ? `color-mix(in oklch, ${color} 18%, transparent)` : 'transparent',
      fontWeight: instance ? 600 : 400,
    }}>
      {ref_.head && <span style={{ opacity: 0.7 }}>● </span>}{ref_.name}
    </span>
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

function matchInstances(codes: string[], selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  return codes.some((c) => selected.has(c));
}

function actionText(action: string): string {
  const map: Record<string, string> = {
    'create-change': 'opened change', 'create-branch': 'created branch', 'edit': 'edited',
    'merge': 'merged into', 'sync-import': 'synced live version into', 'submit-change': 'submitted',
    'approve-change': 'approved', 'reject-change': 'rejected', 'create-instance': 'created instance',
    'update-instance': 'updated instance', 'delete-instance': 'deleted instance', 'add-file': 'added file to',
    'remove-file': 'unmanaged a file on', 'add-user': 'added user', 'update-user': 'updated user', 'remove-user': 'removed user',
  };
  return map[action] ?? action;
}

function renderDetails(e: AuditEvent) {
  const d = e.details ?? {};
  const bits: string[] = [];
  if (typeof d.changeId === 'string') bits.push(d.changeId);
  if (typeof d.file === 'string') bits.push(d.file);
  if (typeof d.user === 'string') bits.push(d.user as string);
  if (d.override) bits.push('override');
  if (typeof d.overrideReason === 'string') bits.push(`"${d.overrideReason}"`);
  if (typeof d.reason === 'string' && d.reason) bits.push(`"${d.reason}"`);
  if (!bits.length) return null;
  return <span className="faint" style={{ fontSize: 12 }}> · {bits.join(' · ')}</span>;
}

