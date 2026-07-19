import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, type InstanceInfo, type User } from '../api';
import { EnvTag, Skeleton, UatTag } from '../components';
import { IconAlertTriangle, IconCheck, IconChevron, IconSync } from '../icons';

/** Outcome of the last sync attempt for one instance, shown inline in its row. */
type SyncOutcome =
  | { kind: 'updated' }
  | { kind: 'insync' }
  | { kind: 'error'; message: string };

export default function Dashboard(_props: { me: User | null }) {
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, SyncOutcome>>({});
  const nav = useNavigate();

  useEffect(() => {
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  function toggleMany(codes: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
      return next;
    });
  }

  // Sync one instance: pull the live file, diff it against what we recorded, and update
  // only if they differ. The button stays disabled (spinner) for the duration.
  async function syncOne(code: string) {
    if (busy.has(code)) return;
    setBusy((b) => new Set(b).add(code));
    setResults((r) => { const n = { ...r }; delete n[code]; return n; });
    try {
      const res = await api.sync(code);
      setResults((r) => ({ ...r, [code]: { kind: res.updated ? 'updated' : 'insync' } }));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Sync failed';
      setResults((r) => ({ ...r, [code]: { kind: 'error', message } }));
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(code); return n; });
    }
  }

  async function syncSelected() {
    const codes = (instances ?? []).map((i) => i.code).filter((c) => selected.has(c));
    await Promise.all(codes.map(syncOne));
  }

  const selectedBusy = useMemo(() => [...selected].some((c) => busy.has(c)), [selected, busy]);

  const groups: { title: string; env: 'pilot' | 'production' }[] = [
    { title: 'Pilot', env: 'pilot' },
    { title: 'Production', env: 'production' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Environments</div>
          <h1>Instances</h1>
          <p>Each instance keeps its own version of the config. Changes are branched and merged per instance; pilots roll out ahead of production.</p>
        </div>
        <div className="hstack">
          <button
            className="btn btn-primary"
            disabled={selected.size === 0 || selectedBusy}
            onClick={syncSelected}
          >
            {selectedBusy ? <span className="spinner" /> : <IconSync />}
            Sync selected{selected.size ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>

      {!instances ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        groups.map((g) => {
          const items = instances.filter((i) => i.environment === g.env);
          if (items.length === 0) return null;
          const codes = items.map((i) => i.code);
          const allSelected = codes.every((c) => selected.has(c));
          const someSelected = codes.some((c) => selected.has(c));
          return (
            <section key={g.env}>
              <div className="group-title">
                <h2>{g.title}</h2>
                <span className="count-chip">{items.length}</span>
              </div>
              <div className="panel">
                <table className="list">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label={`Select all ${g.title} instances`}
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={(e) => toggleMany(codes, e.target.checked)}
                        />
                      </th>
                      <th style={{ width: 150 }}>Instance</th>
                      <th>Environment</th>
                      <th style={{ width: 230 }}>Sync</th>
                      <th style={{ width: 90, textAlign: 'right' }}>Config</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <InstanceRow
                        key={i.code}
                        info={i}
                        selected={selected.has(i.code)}
                        busy={busy.has(i.code)}
                        result={results[i.code]}
                        onToggle={() => toggle(i.code)}
                        onSync={() => syncOne(i.code)}
                        onOpen={() => nav(`/instances/${i.code}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function InstanceRow({
  info, selected, busy, result, onToggle, onSync, onOpen,
}: {
  info: InstanceInfo;
  selected: boolean;
  busy: boolean;
  result?: SyncOutcome;
  onToggle: () => void;
  onSync: () => void;
  onOpen: () => void;
}) {
  // Interactive cells sit inside a clickable row; stop the click from also opening the instance.
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <tr className="rowlink" onClick={onOpen}>
      <td onClick={stop(() => {})}>
        <input type="checkbox" aria-label={`Select ${info.code}`} checked={selected} onChange={onToggle} />
      </td>
      <td className="mono" style={{ fontWeight: 600 }}>{info.code}</td>
      <td><span className="hstack"><EnvTag info={info} />{info.uat && <UatTag />}</span></td>
      <td>
        <span className="hstack" style={{ gap: 10 }}>
          <button className="btn btn-sm" onClick={stop(onSync)} disabled={busy}>
            {busy ? <span className="spinner" /> : <IconSync />}
            {busy ? 'Syncing…' : 'Sync'}
          </button>
          {!busy && result && <SyncStatus result={result} />}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <span className="faint hstack" style={{ justifyContent: 'flex-end', fontSize: 12 }}>view<IconChevron style={{ width: 13, height: 13 }} /></span>
      </td>
    </tr>
  );
}

function SyncStatus({ result }: { result: SyncOutcome }) {
  if (result.kind === 'updated') return <span className="badge success"><IconCheck />Updated</span>;
  if (result.kind === 'insync') return <span className="badge neutral"><IconCheck />In sync</span>;
  return <span className="badge error" title={result.message}><IconAlertTriangle />{result.message}</span>;
}
