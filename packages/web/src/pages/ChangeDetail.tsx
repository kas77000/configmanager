import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { analyze, parseFile, type Finding, type Rule } from '@config-manager/rule-engine';
import { ApiError, api, type Change, type ChangeTarget, type Gate, type User } from '../api';
import { Banner, DiffLines, FindingIcon, GateSummary, Skeleton } from '../components';
import { currentTheme } from '../theme';
import { IconCheck, IconMerge } from '../icons';

const FIXMSG = 'ai.fixmsg.properties';

export default function ChangeDetail({ me }: { me: User | null }) {
  const { id = '' } = useParams();
  const [change, setChange] = useState<Change | null>(null);
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    api.change(id).then((c) => { setChange(c); setActive((a) => a || c.targets[0]?.instance || ''); }).catch(() => setChange(null));
  }, [id]);

  if (!change) return <div className="page"><div className="panel"><Skeleton rows={6} /></div></div>;
  const target = change.targets.find((t) => t.instance === active);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Change {change.id} · {change.status}</div>
          <h1>{change.description}</h1>
          <p>Opened by <span className="mono">{change.createdBy}</span> · {change.targets.length} instance{change.targets.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="rail-tabs" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
        {change.targets.map((t) => (
          <div key={t.instance} className={`rail-tab ${active === t.instance ? 'active' : ''}`} style={{ flex: 'none', padding: '9px 16px' }} onClick={() => setActive(t.instance)}>
            <span className="mono" style={{ fontWeight: 600 }}>{t.instance}</span>
            {t.mergedCommit && <IconCheck style={{ width: 13, height: 13, marginLeft: 6, color: 'var(--success)' }} />}
          </div>
        ))}
      </div>

      {target && (
        <InstanceWorkspace key={target.instance} changeId={change.id} target={target} me={me}
          merged={!!target.mergedCommit} onMerged={() => api.change(id).then(setChange)} />
      )}
    </div>
  );
}

interface FileState { content: string; saved: string }

function InstanceWorkspace({ changeId, target, me, merged, onMerged }: {
  changeId: string; target: ChangeTarget; me: User | null; merged: boolean; onMerged: () => void;
}) {
  const [activeFile, setActiveFile] = useState(target.files[0] ?? FIXMSG);
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const [tab, setTab] = useState<'warnings' | 'inspector'>('warnings');
  const [cursorLine, setCursorLine] = useState(1);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState('');

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const [ready, setReady] = useState(false);

  const instance = target.instance;
  const fs = files[activeFile];
  const isFixmsg = activeFile === FIXMSG;

  useEffect(() => {
    if (files[activeFile]) return;
    api.changeFile(changeId, instance, activeFile).then((r) => setFiles((m) => ({ ...m, [activeFile]: { content: r.content, saved: r.content } })));
  }, [changeId, instance, activeFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (isFixmsg && fs ? parseFile(fs.content) : null), [isFixmsg, fs]);
  const findings = useMemo<Finding[]>(() => (parsed ? analyze(parsed) : []), [parsed]);
  const dirty = !!fs && fs.content !== fs.saved;
  const anyDirty = target.files.some((f) => files[f] && files[f].content !== files[f].saved);

  useEffect(() => {
    const ed = editorRef.current, mo = monacoRef.current;
    if (!ed || !mo) return;
    const model = ed.getModel();
    if (!model) return;
    mo.editor.setModelMarkers(model, 'rules', findings.map((f) => ({
      severity: f.severity === 'error' ? mo.MarkerSeverity.Error : f.severity === 'warning' ? mo.MarkerSeverity.Warning : mo.MarkerSeverity.Info,
      message: `${f.code}: ${f.message}`, startLineNumber: f.lineNumber, endLineNumber: f.lineNumber, startColumn: 1, endColumn: model.getLineMaxColumn(f.lineNumber),
    })));
  }, [findings, ready, activeFile]);

  const onMount: OnMount = (ed, mo) => {
    editorRef.current = ed; monacoRef.current = mo;
    ed.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber));
    setReady(true);
  };

  function gotoLine(line: number) {
    const ed = editorRef.current; if (!ed) return;
    ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus();
  }

  async function save() {
    if (!dirty || !fs) return;
    setSaving(true);
    try {
      await api.putChangeFile(changeId, instance, activeFile, fs.content, message.trim() || `edit ${activeFile}`);
      setFiles((m) => ({ ...m, [activeFile]: { content: fs.content, saved: fs.content } }));
      setMessage(''); setSavedVersion((v) => v + 1);
      if (showDiff) loadDiff();
    } finally { setSaving(false); }
  }

  async function loadDiff() {
    setDiff((await api.changeDiff(changeId, instance, activeFile)).diff);
  }
  function toggleDiff() { const n = !showDiff; setShowDiff(n); if (n) loadDiff(); }

  if (!fs) return <div className="panel"><Skeleton rows={6} /></div>;
  const cursorRule = parsed?.rules.find((r) => r.lineNumber === cursorLine && r.kind === 'rule');

  return (
    <div className="stack" style={{ gap: 16 }}>
      {target.files.length > 1 && (
        <div className="hstack" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Files</span>
          {target.files.map((f) => (
            <button key={f} className="btn btn-sm mono"
              style={activeFile === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              onClick={() => setActiveFile(f)}>
              {f}{files[f] && files[f].content !== files[f].saved ? ' •' : ''}
            </button>
          ))}
        </div>
      )}

      <div className="workspace">
        <div className="editor-pane">
          <div className="editor-toolbar">
            <span className="mono faint" style={{ fontSize: 12 }}>{activeFile}</span>
            {dirty && <span className="badge warning" style={{ fontSize: 11 }}>unsaved</span>}
            <input className="input" style={{ height: 26, flex: 1, minWidth: 80 }} placeholder="commit message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={merged} />
            <button className="btn btn-sm btn-primary" onClick={save} disabled={!dirty || saving || merged || me?.role === 'pending'}>{saving ? <span className="spinner" /> : null}Save</button>
            <button className="btn btn-sm" onClick={toggleDiff}>{showDiff ? 'Hide diff' : 'Diff'}</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor height="100%" defaultLanguage="ini" theme={currentTheme() === 'dark' ? 'vs-dark' : 'light'}
              path={activeFile} value={fs.content} onChange={(v) => setFiles((m) => ({ ...m, [activeFile]: { ...m[activeFile], content: v ?? '' } }))} onMount={onMount}
              options={{ fontSize: 12, fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', minimap: { enabled: false }, lineNumbers: 'on', readOnly: merged, scrollBeyondLastLine: false, renderWhitespace: 'none', wordWrap: 'off' }} />
          </div>
        </div>

        <div className="rail">
          <div className="rail-tabs">
            <div className={`rail-tab ${tab === 'warnings' ? 'active' : ''}`} onClick={() => setTab('warnings')}>Warnings {findings.length > 0 && <span className="count-chip">{findings.length}</span>}</div>
            <div className={`rail-tab ${tab === 'inspector' ? 'active' : ''}`} onClick={() => setTab('inspector')}>Inspector</div>
          </div>
          <div className="rail-body">
            {!isFixmsg
              ? <div className="faint" style={{ padding: 8, fontSize: 12 }}>Shadow-analysis applies to ai.fixmsg.properties. This file is versioned and diffed without rule checks.</div>
              : tab === 'warnings'
                ? <WarningsList findings={findings} onGoto={gotoLine} />
                : <Inspector rule={cursorRule} line={cursorLine} findings={findings} />}
          </div>
        </div>
      </div>

      {showDiff && (diff.trim() ? <DiffLines patch={diff} /> : <div className="panel"><div className="empty">No changes to {activeFile} yet.</div></div>)}

      <MergePanel changeId={changeId} target={target} me={me} merged={merged} anyDirty={anyDirty} savedVersion={savedVersion} onMerged={onMerged} />
    </div>
  );
}

function WarningsList({ findings, onGoto }: { findings: Finding[]; onGoto: (l: number) => void }) {
  if (findings.length === 0) return <div className="empty" style={{ padding: 32 }}><IconCheck style={{ width: 20, height: 20, color: 'var(--success)' }} /><div style={{ marginTop: 6 }}>No findings. This version is clean.</div></div>;
  return (
    <div className="stack" style={{ gap: 2 }}>
      {findings.map((f, i) => (
        <div key={i} className={`finding badge ${f.severity}`} onClick={() => onGoto(f.lineNumber)}>
          <FindingIcon severity={f.severity} />
          <div><div className="fmsg" style={{ color: 'var(--text)' }}>{f.message}</div><div className="floc">line {f.lineNumber}{f.relatedLineNumbers?.length ? ` · related ${f.relatedLineNumbers.join(', ')}` : ''} · {f.code}</div></div>
        </div>
      ))}
    </div>
  );
}

function Inspector({ rule, line, findings }: { rule: Rule | undefined; line: number; findings: Finding[] }) {
  const related = findings.filter((f) => f.lineNumber === line || f.relatedLineNumbers?.includes(line));
  if (!rule) return <div className="faint" style={{ padding: 8, fontSize: 12 }}>Put the cursor on a rule line to inspect it.</div>;
  return (
    <div>
      {rule.comment && <div className="insp-row"><div className="insp-label">Comment</div><div className="faint mono" style={{ fontSize: 12 }}>{rule.comment}</div></div>}
      <div className="insp-row"><div className="insp-label">Sets tags</div>{rule.outputTagKeys.length ? rule.outputTagKeys.map((t) => <span key={t} className="chip">{t}</span>) : <span className="faint">none</span>}</div>
      <div className="insp-row"><div className="insp-label">Conditions</div>{rule.conditions.length === 0 ? <span className="faint">always applies</span> : rule.conditions.map((c, i) => (
        <span key={i} className="chip">{c.opaque ? <span className="faint">{c.raw}</span> : <>{c.field}<span className="op">{c.operator}</span>{c.values?.join('^')}</>}</span>
      ))}</div>
      <div className="insp-row"><div className="insp-label">Interactions</div>{related.length === 0 ? <span className="faint">no conflicts detected</span> : related.map((f, i) => (
        <div key={i} className={`badge ${f.severity}`} style={{ marginBottom: 6, alignItems: 'flex-start' }}><FindingIcon severity={f.severity} /><span style={{ color: 'var(--text)', fontSize: 12 }}>{f.message}</span></div>
      ))}</div>
    </div>
  );
}

function MergePanel({ changeId, target, me, merged, anyDirty, savedVersion, onMerged }: {
  changeId: string; target: ChangeTarget; me: User | null; merged: boolean; anyDirty: boolean; savedVersion: number; onMerged: () => void;
}) {
  const instance = target.instance;
  const [gate, setGate] = useState<Gate>({ findings: [], errorCount: 0, warningCount: 0, infoCount: 0 });
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);

  const isAdmin = me?.role === 'admin';
  const hasErrors = gate.errorCount > 0;
  const hasWarnings = gate.warningCount > 0;
  const hasFixmsg = target.files.includes(FIXMSG);

  // The instance merge gate is driven by the fixmsg file (the only file with rule checks).
  useEffect(() => {
    if (merged || done || !hasFixmsg) return;
    api.changeAnalysis(changeId, instance, FIXMSG).then((g) => setGate(g)).catch(() => {});
  }, [changeId, instance, savedVersion, merged, done, hasFixmsg]);

  if (merged || done) return <Banner kind="info"><strong>Merged into {instance}.</strong> This instance's canonical version now includes the change.</Banner>;

  async function merge() {
    setBusy(true); setError(null); setConflicts(null);
    try {
      await api.mergeChange(changeId, instance, { acknowledgeWarnings: ack, override, overrideReason: reason.trim() || undefined });
      setDone(true); onMerged();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.body?.gate) setGate(e.body.gate as Gate);
        if (e.body?.error === 'merge-conflict') setConflicts(e.body.conflicts ?? []);
        setError(messageFor(e.body?.error, isAdmin));
      } else setError('Merge failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="row-between" style={{ marginBottom: hasErrors || hasWarnings || anyDirty ? 12 : 0 }}>
        <div className="hstack gap-lg">
          <strong>Merge {target.files.length > 1 ? `${target.files.length} files ` : ''}into {instance}</strong>
          <GateSummary error={gate.errorCount} warning={gate.warningCount} info={gate.infoCount} />
        </div>
        <button className="btn btn-primary" onClick={merge}
          disabled={busy || anyDirty || me?.role === 'pending' || (hasWarnings && !ack) || (hasErrors && !(isAdmin && override && reason.trim()))}>
          {busy ? <span className="spinner" /> : <IconMerge />}Merge
        </button>
      </div>

      {anyDirty && <div className="faint" style={{ fontSize: 12 }}>Save all edited files before merging.</div>}

      {hasWarnings && !hasErrors && (
        <label className="hstack" style={{ marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I have reviewed the {gate.warningCount} warning{gate.warningCount > 1 ? 's' : ''} and want to proceed.</span>
        </label>
      )}

      {hasErrors && (
        <div style={{ marginTop: 10 }}>
          <Banner kind="error">This version has {gate.errorCount} blocking error{gate.errorCount > 1 ? 's' : ''}.{isAdmin ? ' As an admin you may override with a recorded reason.' : ' Only an admin can override.'}</Banner>
          {isAdmin && (
            <div style={{ marginTop: 10 }}>
              <label className="hstack" style={{ cursor: 'pointer', marginBottom: 8 }}><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /><span>Override the merge gate</span></label>
              {override && <label className="field"><span>Override reason (recorded in the audit log)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. accepted risk, tracked in JIRA-1234" /></label>}
            </div>
          )}
        </div>
      )}

      {conflicts && <div style={{ marginTop: 10 }}><Banner kind="warning">Merge conflict in {conflicts.join(', ')}. Update this branch from the instance version and re-resolve.</Banner></div>}
      {error && !conflicts && !hasErrors && <div style={{ marginTop: 10 }}><span className="badge error">{error}</span></div>}
    </div>
  );
}

function messageFor(code: string | undefined, isAdmin: boolean): string {
  switch (code) {
    case 'blocked-by-errors': return isAdmin ? 'Blocked by errors. Enable override with a reason.' : 'Blocked by errors. Ask an admin to override.';
    case 'only an admin can override errors': return 'Only an admin can override errors.';
    case 'overrideReason required to override errors': return 'A reason is required to override.';
    case 'warnings-need-acknowledgement': return 'Acknowledge the warnings to proceed.';
    default: return code ?? 'Merge failed.';
  }
}
