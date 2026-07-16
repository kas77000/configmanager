import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChangeStatus, Finding, InstanceInfo } from './api';
import { IconAlertTriangle, IconChevron, IconDiamond, IconInfo } from './icons';

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

/** A small button that reveals a dropdown of actions. Closes on outside click or after a choice. */
export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span className="menu" ref={ref}>
      <button type="button" className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}<IconChevron style={{ width: 12, height: 12, transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 150ms var(--ease)' }} />
      </button>
      {open && <div className="menu-pop" role="menu" onClick={() => setOpen(false)}>{children}</div>}
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

// Git plumbing lines that carry no file content (and no line-number meaning).
function isPlumbing(l: string): boolean {
  return l.startsWith('diff --git ') || l.startsWith('index ') || l.startsWith('--- ') ||
    l.startsWith('+++ ') || l.startsWith('new file mode ') || l.startsWith('deleted file mode ') ||
    l.startsWith('similarity index ') || l.startsWith('rename from ') || l.startsWith('rename to ') ||
    l.startsWith('\\ No newline');
}

type DiffRow =
  | { kind: 'gap' }
  | { kind: 'add' | 'del' | 'ctx'; oldLn?: number; newLn?: number; text: string };

// Parse a unified diff into rows carrying old/new line numbers. Hunk headers
// (@@ -a,b +c,d @@) reset the counters; a break between hunks becomes a 'gap'.
function parseDiff(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLn = 0, newLn = 0, seenHunk = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) { oldLn = Number(m[1]); newLn = Number(m[2]); }
      if (seenHunk) rows.push({ kind: 'gap' });
      seenHunk = true;
      continue;
    }
    if (isPlumbing(raw) || raw === '') continue;
    if (raw.startsWith('+')) rows.push({ kind: 'add', newLn: newLn++, text: raw.slice(1) });
    else if (raw.startsWith('-')) rows.push({ kind: 'del', oldLn: oldLn++, text: raw.slice(1) });
    else rows.push({ kind: 'ctx', oldLn: oldLn++, newLn: newLn++, text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return rows;
}

export function DiffLines({ patch, maxHeight = 360 }: { patch: string; maxHeight?: number }) {
  const rows = parseDiff(patch);
  if (!rows.some((r) => r.kind === 'add' || r.kind === 'del')) return <div className="empty">No content changes.</div>;
  return (
    <div className="diff" style={{ maxHeight }}>
      {rows.map((r, i) => {
        if (r.kind === 'gap') return <div key={i} className="diff-gap">⋯</div>;
        const cls = r.kind === 'add' ? 'add' : r.kind === 'del' ? 'del' : '';
        const mark = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
        return (
          <div key={i} className={`drow ${cls}`}>
            <span className="dgut">{r.oldLn ?? ''}</span>
            <span className="dgut g2">{r.newLn ?? ''}</span>
            <span className="dmark">{mark}</span>
            <span className="dcode">{r.text || ' '}</span>
          </div>
        );
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
