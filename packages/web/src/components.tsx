import type { ReactNode } from 'react';
import type { Finding, InstanceInfo } from './api';
import { IconAlertTriangle, IconDiamond, IconInfo } from './icons';

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

export function DiffLines({ patch, maxHeight = 360 }: { patch: string; maxHeight?: number }) {
  const lines = patch.split('\n');
  return (
    <div className="diff" style={{ padding: '8px 0', maxHeight }}>
      {lines.map((l, i) => {
        const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add'
          : l.startsWith('-') && !l.startsWith('---') ? 'del'
          : l.startsWith('@@') ? 'hunk'
          : l.startsWith('diff ') ? 'hunk' : '';
        return <span key={i} className={`ln ${cls}`}>{l || ' '}</span>;
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
