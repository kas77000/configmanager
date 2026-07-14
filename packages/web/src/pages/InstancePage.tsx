import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type InstanceInfo } from '../api';
import { Skeleton } from '../components';
import { IconChevron, IconCheck } from '../icons';

export default function InstancePage() {
  const { code = '' } = useParams();
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});

  useEffect(() => {
    api.instances().then((list) => {
      const i = list.find((x) => x.code === code) ?? null;
      setInfo(i);
      (i?.files ?? []).forEach((f) => {
        api.instanceFile(code, f).then((r) => setContents((m) => ({ ...m, [f]: r.content }))).catch(() => setContents((m) => ({ ...m, [f]: '' })));
      });
    }).catch(() => setInfo(null));
  }, [code]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/" className="hstack" style={{ display: 'inline-flex', gap: 4 }}><IconChevron style={{ width: 12, height: 12, transform: 'rotate(180deg)' }} />Instances</Link>
            {' · '}Current config
          </div>
          <h1 className="mono">{code}</h1>
          <p>The latest merged config for every file managed on this instance. Copy each to apply it manually on the server.</p>
          {info?.serverAddress && <p style={{ marginTop: 6 }}><span className="faint">Server:</span> <span className="mono">{info.serverAddress}</span></p>}
        </div>
      </div>

      {!info ? (
        <div className="panel"><Skeleton rows={6} /></div>
      ) : info.files.length === 0 ? (
        <div className="panel"><div className="empty">No files are managed for this instance yet.</div></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {info.files.map((f) => (
            <FileView key={f} name={f} path={info.paths?.[f]} content={contents[f]} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileView({ name, path, content }: { name: string; path?: string; content?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (content == null) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="stack">
          <span className="mono" style={{ fontWeight: 600 }}>{name}</span>
          {path && <span className="faint mono" style={{ fontSize: 11 }}>{path}</span>}
        </div>
        <div className="hstack">
          {content != null && <span className="faint" style={{ fontSize: 12 }}>{content.split('\n').length} lines</span>}
          <button className="btn btn-sm" onClick={copy} disabled={content == null}>{copied ? <IconCheck style={{ width: 14, height: 14, color: 'var(--success)' }} /> : null}{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
      {content == null ? <Skeleton rows={4} /> : (
        <pre className="mono" style={{ margin: 0, padding: '12px 16px', fontSize: 12, lineHeight: 1.6, overflow: 'auto', maxHeight: '55vh', whiteSpace: 'pre' }}>{content || '(empty)'}</pre>
      )}
    </div>
  );
}
