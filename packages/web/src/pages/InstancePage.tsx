import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type InstanceInfo } from '../api';
import { Skeleton } from '../components';
import { IconChevron, IconCheck } from '../icons';

export default function InstancePage() {
  const { code = '' } = useParams();
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [activeFile, setActiveFile] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.instances().then((list) => {
      const i = list.find((x) => x.code === code) ?? null;
      setInfo(i);
      setActiveFile(i?.files[0] ?? '');
    }).catch(() => setInfo(null));
  }, [code]);

  useEffect(() => {
    if (!activeFile) return;
    setContent(null);
    api.instanceFile(code, activeFile).then((r) => setContent(r.content)).catch(() => setContent(''));
  }, [code, activeFile]);

  async function copy() {
    if (content == null) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/" className="hstack" style={{ display: 'inline-flex', gap: 4 }}><IconChevron style={{ width: 12, height: 12, transform: 'rotate(180deg)' }} />Instances</Link>
            {' · '}Current config
          </div>
          <h1 className="mono">{code}</h1>
          <p>The latest merged config on this instance. Copy it to apply manually on the server.</p>
        </div>
        <button className="btn" onClick={copy} disabled={content == null}>{copied ? <IconCheck style={{ width: 15, height: 15, color: 'var(--success)' }} /> : null}{copied ? 'Copied' : 'Copy file'}</button>
      </div>

      {info && info.files.length > 1 && (
        <div className="hstack" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Files</span>
          {info.files.map((f) => (
            <button key={f} className="btn btn-sm mono" style={activeFile === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => setActiveFile(f)}>{f}</button>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><span className="mono" style={{ fontWeight: 600 }}>{activeFile}</span>{content != null && <span className="faint" style={{ fontSize: 12 }}>{content.split('\n').length} lines</span>}</div>
        {content == null ? <Skeleton rows={8} /> : (
          <pre className="mono" style={{ margin: 0, padding: '12px 16px', fontSize: 12, lineHeight: 1.6, overflow: 'auto', maxHeight: '65vh', whiteSpace: 'pre' }}>{content || '(empty)'}</pre>
        )}
      </div>
    </div>
  );
}
