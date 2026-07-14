import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type CommitDetail } from '../api';
import { DiffLines, Skeleton, relTime } from '../components';
import { IconChevron } from '../icons';

export default function CommitPage() {
  const { hash = '' } = useParams();
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.commit(hash).then(setCommit).catch(() => setNotFound(true));
  }, [hash]);

  if (notFound) return <div className="page"><div className="panel"><div className="empty">Commit not found.</div></div></div>;
  if (!commit) return <div className="page"><div className="panel"><Skeleton rows={6} /></div></div>;

  const totalAdd = commit.files.reduce((s, f) => s + f.additions, 0);
  const totalDel = commit.files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/history" className="hstack" style={{ display: 'inline-flex', gap: 4 }}>
              <IconChevron style={{ width: 12, height: 12, transform: 'rotate(180deg)' }} />History
            </Link>
            {' · '}Commit <span className="mono">{commit.hash.slice(0, 10)}</span>
          </div>
          <h1>{commit.subject}</h1>
          <p>
            <span className="mono">{commit.authorName}</span> · {relTime(commit.date)}
            {commit.parents.length > 1 ? ' · merge commit' : ''}
            {' · '}<span className="badge success" style={{ fontSize: 12 }}>+{totalAdd}</span>{' '}
            <span className="badge error" style={{ fontSize: 12 }}>-{totalDel}</span>
          </p>
        </div>
      </div>

      <div className="hstack" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instances</span>
        {commit.instances.length === 0
          ? <span className="faint">unknown</span>
          : commit.instances.map((code) => <span key={code} className="tag mono">{code}</span>)}
      </div>

      {commit.files.length === 0 ? (
        <div className="panel"><div className="empty">No file changes in this commit.</div></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {commit.files.map((f) => <FileChange key={f.file} file={f.file} additions={f.additions} deletions={f.deletions} patch={f.patch} />)}
        </div>
      )}
    </div>
  );
}

function FileChange({ file, additions, deletions, patch }: { file: string; additions: number; deletions: number; patch: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="panel">
      <div className="panel-head rowlink" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <span className="hstack">
          <IconChevron style={{ width: 14, height: 14, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms var(--ease)', color: 'var(--faint)' }} />
          <span className="mono" style={{ fontWeight: 600 }}>{file}</span>
        </span>
        <span className="hstack" style={{ gap: 10 }}>
          <span className="badge success" style={{ fontSize: 12 }}>+{additions}</span>
          <span className="badge error" style={{ fontSize: 12 }}>-{deletions}</span>
        </span>
      </div>
      {open && (patch.trim() ? <DiffLines patch={patch} maxHeight={480} /> : <div className="empty">Binary or empty diff.</div>)}
    </div>
  );
}
