import type { ReactNode } from 'react';
import type { ChangeStatus, Finding, InstanceInfo } from './api';
import { IconAlertTriangle, IconDiamond, IconInfo } from './icons';

/** Wraps a trigger; shows `content` as a hover/focus popover. No content = passthrough. */
export function Tooltip({ content, children }: { content?: ReactNode; children: ReactNode }) {
  if (content === undefined || content === null || content === false) return <>{children}</>;
  return <span className="tip">{children}<span className="tip-pop" role="tooltip">{content}</span></span>;
}

/** Small info icon that reveals `text` on hover/focus. */
export function InfoTip({ text }: { text: ReactNode }) {
  return (
    <span className="tip" tabIndex={0} aria-label="More information">
      <IconInfo className="tip-icon" />
      <span className="tip-pop" role="tooltip">{text}</span>
    </span>
  );
}

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  const map: Record<ChangeStatus, string> = {
    draft: 'neutral', submitted: 'info', approved: 'success', rejected: 'error', merged: 'success', cancelled: 'neutral',
  };
  return <span className={`badge ${map[status]} badge-pill`} style={{ fontSize: 11 }}>{status}</span>;
}

export function EnvTag({ info }: { info: InstanceInfo }) {
  return (
    <span className="tag">
      <span className={`dot ${info.environment}`} />
      {info.environment}
    </span>
  );
}

export function UatTag() {
  return (
    <span className="tag uat">
      <span className="dot" />
      UAT
    </span>
  );
}

export function FindingIcon({ severity }: { severity: Finding['severity'] }) {
  if (severity === 'error') return <IconAlertTriangle />;
  if (severity === 'warning') return <IconDiamond />;
  return <IconInfo />;
}

export function GateSummary({ error, warning, info }: { error: number; warning: number; info: number }) {
  if (error + warning + info === 0) {
    return <span className="badge success"><IconInfo />No findings</span>;
  }
  return (
    <span className="hstack" style={{ gap: 12 }}>
      {error > 0 && <span className="badge error"><IconAlertTriangle />{error} error{error > 1 ? 's' : ''}</span>}
      {warning > 0 && <span className="badge warning"><IconDiamond />{warning} warning{warning > 1 ? 's' : ''}</span>}
      {info > 0 && <span className="badge info"><IconInfo />{info}</span>}
    </span>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const Icon = kind === 'error' ? IconAlertTriangle : kind === 'warning' ? IconDiamond : IconInfo;
  return (
    <div className={`banner ${kind}`}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" style={{ gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 8}%` }} />
      ))}
    </div>
  );
}

// Strip git's plumbing lines so only the actual content changes show.
function isNoise(l: string): boolean {
  return l.startsWith('diff --git ') || l.startsWith('index ') || l.startsWith('--- ') ||
    l.startsWith('+++ ') || l.startsWith('@@') || l.startsWith('new file mode ') ||
    l.startsWith('deleted file mode ') || l.startsWith('similarity index ') ||
    l.startsWith('rename from ') || l.startsWith('rename to ') || l.startsWith('\\ No newline');
}

export function DiffLines({ patch, maxHeight = 360 }: { patch: string; maxHeight?: number }) {
  const lines = patch.split('\n').filter((l) => !isNoise(l));
  if (lines.every((l) => l.trim() === '')) return <div className="empty">No content changes.</div>;
  return (
    <div className="diff" style={{ padding: '8px 0', maxHeight }}>
      {lines.map((l, i) => {
        const cls = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
        // show the changed content without the leading +/- marker
        const text = cls ? l.slice(1) : l;
        return <span key={i} className={`ln ${cls}`}>{text || ' '}</span>;
      })}
    </div>
  );
}

export function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
