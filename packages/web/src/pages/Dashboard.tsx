import { useEffect, useState } from 'react';
import { api, type InstanceInfo, type User } from '../api';
import { EnvTag, Skeleton, UatTag } from '../components';

export default function Dashboard(_props: { me: User | null }) {
  const [instances, setInstances] = useState<InstanceInfo[] | null>(null);

  useEffect(() => {
    api.instances().then(setInstances).catch(() => setInstances([]));
  }, []);

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
                      <th style={{ width: 160 }}>Instance</th>
                      <th>Environment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.code}>
                        <td className="mono" style={{ fontWeight: 600 }}>{i.code}</td>
                        <td><span className="hstack"><EnvTag info={i} />{i.uat && <UatTag />}</span></td>
                      </tr>
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
