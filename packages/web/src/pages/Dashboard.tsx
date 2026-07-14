import { useEffect, useState } from 'react';
import { ApiError, api, type InstanceInfo, type User } from '../api';
import { EnvTag, Skeleton, UatTag } from '../components';
import { IconCheck, IconSync } from '../icons';

type SyncState = 'idle' | 'checking' | 'insync' | 'drift' | 'unreachable';
interface RowState { state: SyncState; note?: string }

export default function Dashboard({ me }: { me: User | null }) {
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  useEffect(() => {
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

  function set(code: string, s: RowState) {
    setRows((r) => ({ ...r, [code]: s }));
  }

  async function verify(code: string) {
    set(code, { state: 'checking' });
    try {
      const r = await api.verify(code);
      set(code, { state: r.inSync ? 'insync' : 'drift' });
    } catch (e) {
      set(code, { state: 'unreachable', note: e instanceof ApiError && e.status === 502 ? 'live check unavailable' : 'error' });
    }
  }

  async function sync(code: string) {
    set(code, { state: 'checking' });
    try {
      const r = await api.sync(code);
      set(code, { state: 'insync', note: r.updated ? 'pulled live version' : 'already current' });
    } catch (e) {
      set(code, { state: 'unreachable', note: e instanceof ApiError && e.status === 502 ? 'live check unavailable' : 'error' });
    }
  }

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
          <p>Each instance keeps its own version of the config. Verify compares the live file against what we hold; sync pulls it in only if it differs.</p>
        </div>
      </div>

      {!instances ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : (
        groups.map((g) => {
          const items = instances.filter((i) => i.environment === g.env);
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
                      <th style={{ width: 120 }}>Instance</th>
                      <th>Environment</th>
                      <th>Live status</th>
                      <th style={{ width: 190, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const st = rows[i.code] ?? { state: 'idle' as SyncState };
                      return (
                        <tr key={i.code}>
                          <td className="mono" style={{ fontWeight: 600 }}>{i.code}</td>
                          <td><span className="hstack"><EnvTag info={i} />{i.uat && <UatTag />}</span></td>
                          <td><StatusCell st={st} /></td>
                          <td style={{ textAlign: 'right' }}>
                            <span className="hstack" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn btn-sm" onClick={() => verify(i.code)} disabled={st.state === 'checking'}>Verify</button>
                              <button className="btn btn-sm" onClick={() => sync(i.code)} disabled={st.state === 'checking' || me?.role === 'pending'}>
                                <IconSync />Sync
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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

function StatusCell({ st }: { st: RowState }) {
  if (st.state === 'idle') return <span className="status unknown"><span className="dot" />not checked</span>;
  if (st.state === 'checking') return <span className="status unknown"><span className="spinner" />checking</span>;
  if (st.state === 'insync') return <span className="status insync"><IconCheck style={{ width: 14, height: 14 }} />in sync{st.note ? ` · ${st.note}` : ''}</span>;
  if (st.state === 'drift') return <span className="status drift"><span className="dot" />drift detected</span>;
  return <span className="status unknown"><span className="dot" />{st.note ?? 'unreachable'}</span>;
}
