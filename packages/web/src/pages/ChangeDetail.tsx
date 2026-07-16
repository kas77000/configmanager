import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { KNOWN_FIELDS, analyze, parseFile, type Finding, type Rule } from '@config-manager/rule-engine';
import { ApiError, canApprove, canEdit, isAdmin, api, downloadEml, type Change, type ChangeTarget, type Gate, type JiraTemplate, type User } from '../api';
import { Banner, ChangeStatusBadge, DiffLines, FindingIcon, GateSummary, Menu, Skeleton, relTime } from '../components';
import { currentTheme } from '../theme';
import { IconCheck, IconMerge, IconPlus, IconX } from '../icons';

const FIXMSG = 'ai.fixmsg.properties';

export default function ChangeDetail({ me }: { me: User | null }) {
  const { id = '' } = useParams();
  const [change, setChange] = useState<Change | null>(null);
  const [active, setActive] = useState<string>('');

  function reload() { return api.change(id).then(setChange); }
  useEffect(() => {
    api.change(id).then((c) => { setChange(c); setActive((a) => a || c.targets[0]?.instance || ''); }).catch(() => setChange(null));
  }, [id]);

  if (!change) return <div className="page"><div className="panel"><Skeleton rows={6} /></div></div>;
  const target = change.targets.find((t) => t.instance === active);
  const canSeeConfig = canEdit(me?.roles);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Change {change.id}</div>
          <h1>{change.description}</h1>
          <p>Opened by <span className="mono">{change.createdBy}</span> · {change.targets.length} instance{change.targets.length > 1 ? 's' : ''}{change.effectiveDate ? <> · effective <span className="mono">{change.effectiveDate}</span></> : ''}</p>
        </div>
      </div>

      <ApprovalBar change={change} me={me} onChange={reload} />

      <div className="panel" style={{ marginBottom: 16 }}>
        <table className="list">
          <thead><tr><th>Description</th><th style={{ width: 220 }}>Config file</th><th style={{ width: 240 }}>Applies to instances</th></tr></thead>
          <tbody>
            {change.items.map((it, i) => (
              <tr key={i}>
                <td>{it.description}</td>
                <td className="mono">{it.file}</td>
                <td className="mono faint" style={{ fontSize: 12 }}>{it.instances.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canSeeConfig && (change.status === 'approved' || change.status === 'merged') && (
        <JiraPanel change={change} onChange={reload} />
      )}

      {!canSeeConfig ? (
        <div className="panel"><div className="empty">You can review and decide on this request, but the config editing is handled by the quant team.</div></div>
      ) : (
      <>
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
          merged={!!target.mergedCommit} approved={change.status === 'approved'} onMerged={reload} />
      )}
      </>
      )}
    </div>
  );
}

function ApprovalBar({ change, me, onChange }: { change: Change; me: User | null; onChange: () => Promise<unknown> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = canEdit(me?.roles) && (change.status === 'draft' || change.status === 'rejected');
  const canDecide = canApprove(me?.roles) && change.status === 'submitted';

  async function act(p: Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await p; await onChange(); setRejecting(false); setReason(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  }

  const requester = canEdit(me?.roles);
  return (
    <div className="panel" style={{ padding: 14, marginBottom: 16 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="hstack gap-lg" style={{ flexWrap: 'wrap' }}>
          <ChangeStatusBadge status={change.status} />
          {(change.jiraTickets ?? []).map((t) => <a key={t.key} className="tag mono" href={t.url} target="_blank" rel="noreferrer" title={t.file} style={{ color: 'var(--accent)' }}>{t.key}</a>)}
          {change.status === 'submitted' && change.submittedBy && <span className="faint" style={{ fontSize: 12 }}>submitted by <span className="mono">{change.submittedBy}</span></span>}
          {change.decision && <span className="faint" style={{ fontSize: 12 }}>{change.decision.action} by <span className="mono">{change.decision.by}</span> · {relTime(change.decision.at)}{change.decision.reason ? ` · "${change.decision.reason}"` : ''}</span>}
        </div>
        <div className="hstack" style={{ flexWrap: 'wrap' }}>
          {canSubmit && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(api.submitChange(change.id))}>Submit for approval</button>}
          {requester && change.status === 'draft' && <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(api.cancelChange(change.id))}>Cancel change</button>}
          {/* Email drafts live in a menu that only exists once the change is in an emailable state. */}
          {requester && change.status === 'submitted' && (
            <Menu label="Emails">
              <button type="button" className="menu-item" disabled={busy} onClick={() => act(downloadEml(change.id, 'approval'))}>Approval email…</button>
            </Menu>
          )}
          {requester && change.status === 'merged' && (
            <Menu label="Emails">
              <button type="button" className="menu-item" disabled={busy} onClick={() => act(downloadEml(change.id, 'recap'))}>Recap email…</button>
            </Menu>
          )}
          {canDecide && <button className="btn btn-sm" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} disabled={busy} onClick={() => act(api.approveChange(change.id))}><IconCheck style={{ width: 14, height: 14 }} />Approve</button>}
          {canDecide && <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setRejecting((v) => !v)}>Reject</button>}
        </div>
      </div>
      {rejecting && (
        <div className="hstack" style={{ marginTop: 10 }}>
          <input className="input" style={{ flex: 1 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(api.rejectChange(change.id, reason))}>Confirm reject</button>
        </div>
      )}
      {err && <div style={{ marginTop: 8 }}><span className="badge error">{err}</span></div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard unavailable */ }
    }}>{done ? <><IconCheck style={{ width: 13, height: 13 }} />Copied</> : 'Copy'}</button>
  );
}

/** After approval, the requester creates the Jira ticket(s) in Jira and records the link(s) here.
 *  The app supplies a suggested summary + description per config file to paste into Jira. */
function JiraPanel({ change, onChange }: { change: Change; onChange: () => Promise<unknown> }) {
  const [tpl, setTpl] = useState<JiraTemplate | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.jiraTemplate(change.id).then(setTpl).catch(() => setTpl({ epicKey: '', items: [] })); }, [change.id]);
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const t of change.jiraTickets ?? []) init[t.file] = t.url;
    setLinks(init);
  }, [change.jiraTickets]);

  const savedKey = (file: string) => (change.jiraTickets ?? []).find((t) => t.file === file)?.key;

  async function save() {
    if (!tpl) return;
    setSaving(true); setErr(null); setSaved(false);
    try {
      const tickets = tpl.items.map((it) => ({ file: it.file, url: (links[it.file] ?? '').trim(), key: '' })).filter((t) => t.url);
      await api.setJira(change.id, tickets);
      await onChange();
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the Jira links.'); }
    finally { setSaving(false); }
  }

  const box = { fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' } as const;
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <strong>JIRA tickets</strong>
        {tpl?.epicKey && <span className="faint" style={{ fontSize: 12 }}>epic <span className="mono">{tpl.epicKey}</span></span>}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: '0 0 4px' }}>
        Create one Jira ticket per config file{tpl?.epicKey ? ' under the epic above' : ''}, then paste each ticket link below. Use the suggested summary and description to fill the ticket.
      </p>
      {!tpl ? <Skeleton rows={3} /> : tpl.items.length === 0 ? <div className="empty">No config files.</div> : (
        <div className="stack" style={{ gap: 16 }}>
          {tpl.items.map((it) => (
            <div key={it.file} style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{it.file}</span>
                <span className="faint mono" style={{ fontSize: 12 }}>{it.instances.join(', ')}</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  <div className="row-between" style={{ marginBottom: 3 }}><span className="insp-label" style={{ margin: 0 }}>Summary</span><CopyButton text={it.summary} /></div>
                  <div className="mono" style={box}>{it.summary}</div>
                </div>
                <div>
                  <div className="row-between" style={{ marginBottom: 3 }}><span className="insp-label" style={{ margin: 0 }}>Description</span><CopyButton text={it.description} /></div>
                  <pre className="mono" style={{ ...box, margin: 0, whiteSpace: 'pre-wrap' }}>{it.description}</pre>
                </div>
                <label className="field" style={{ margin: 0 }}>
                  <span>Ticket link{savedKey(it.file) ? <> · saved as <a className="mono" href={links[it.file]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{savedKey(it.file)}</a></> : ''}</span>
                  <input className="input mono" placeholder="https://your-jira/browse/BSGPTALGO-1234" value={links[it.file] ?? ''} onChange={(e) => setLinks((m) => ({ ...m, [it.file]: e.target.value }))} />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
      {err && <div style={{ marginTop: 10 }}><span className="badge error">{err}</span></div>}
      <div className="hstack" style={{ marginTop: 14 }}>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !tpl}>{saving ? <span className="spinner" /> : null}Save Jira links</button>
        {saved && <span style={{ fontSize: 12, color: 'var(--success)' }}>Saved</span>}
      </div>
    </div>
  );
}

interface FileState { content: string; saved: string }

function InstanceWorkspace({ changeId, target, me, merged, approved, onMerged }: {
  changeId: string; target: ChangeTarget; me: User | null; merged: boolean; approved: boolean; onMerged: () => void;
}) {
  const [activeFile, setActiveFile] = useState(target.files[0] ?? FIXMSG);
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const [tab, setTab] = useState<'warnings' | 'inspector'>('warnings');
  const [cursorLine, setCursorLine] = useState(1);
  const [showDiff, setShowDiff] = useState(true);
  const [diff, setDiff] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

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

  // Keep the "what changed" diff current when the file changes or after a save.
  useEffect(() => {
    if (showDiff) loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, savedVersion, showDiff]);

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

  // ---- Row builder: line-level helpers operating at the cursor line ----
  function updateContent(next: string) {
    setFiles((m) => ({ ...m, [activeFile]: { content: next, saved: m[activeFile].saved } }));
  }
  function toggleComment() {
    if (!fs) return;
    const lines = fs.content.split('\n');
    const i = cursorLine - 1;
    if (i < 0 || i >= lines.length) return;
    lines[i] = /^\s*#/.test(lines[i]) ? lines[i].replace(/^(\s*)#\s?/, '$1') : `#${lines[i]}`;
    updateContent(lines.join('\n'));
  }
  function deleteLine() {
    if (!fs) return;
    const lines = fs.content.split('\n');
    const i = cursorLine - 1;
    if (i < 0 || i >= lines.length) return;
    lines.splice(i, 1);
    updateContent(lines.join('\n'));
  }
  function insertAfterCursor(text: string) {
    if (!fs) return;
    const lines = fs.content.split('\n');
    lines.splice(Math.min(cursorLine, lines.length), 0, text);
    updateContent(lines.join('\n'));
  }

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
            <button className="btn btn-sm btn-primary" onClick={save} disabled={!dirty || saving || merged || !canEdit(me?.roles)}>{saving ? <span className="spinner" /> : null}Save</button>
            <button className="btn btn-sm" onClick={toggleDiff}>{showDiff ? 'Hide changes' : 'Show changes'}</button>
          </div>
          <div className="editor-toolbar" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 11 }}>line {cursorLine}</span>
            <button className="btn btn-sm" onClick={toggleComment} disabled={merged}>Comment / Uncomment</button>
            <button className="btn btn-sm" onClick={deleteLine} disabled={merged}>Delete line</button>
            <button className="btn btn-sm" onClick={() => { setCommentOpen((v) => !v); setBuilderOpen(false); }} disabled={merged}>Add comment</button>
            {isFixmsg && <button className="btn btn-sm btn-primary" onClick={() => { setBuilderOpen((v) => !v); setCommentOpen(false); }} disabled={merged}>Add rule…</button>}
          </div>
          {commentOpen && (
            <div className="editor-toolbar" style={{ gap: 6 }}>
              <input className="input" style={{ height: 26, flex: 1 }} placeholder="comment text" value={commentText} onChange={(e) => setCommentText(e.target.value)} autoFocus />
              <button className="btn btn-sm btn-primary" disabled={!commentText.trim()} onClick={() => { insertAfterCursor(`# ${commentText.trim()}`); setCommentText(''); setCommentOpen(false); }}>Insert</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setCommentOpen(false)}>Cancel</button>
            </div>
          )}
          {builderOpen && isFixmsg && <RuleBuilder onInsert={(l) => { insertAfterCursor(l); setBuilderOpen(false); }} onClose={() => setBuilderOpen(false)} />}
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

      {showDiff && (
        <div className="panel">
          <div className="panel-head">
            <span className="mono" style={{ fontWeight: 600 }}>Changes to {activeFile}</span>
            <span className="faint" style={{ fontSize: 12 }}>{instance} · compared to the current instance config</span>
          </div>
          {diff.trim() ? <DiffLines patch={diff} /> : <div className="empty">No saved changes to this file yet. Edit and Save to see your added and removed lines here.</div>}
        </div>
      )}

      <MergePanel changeId={changeId} target={target} me={me} merged={merged} approved={approved} anyDirty={anyDirty} savedVersion={savedVersion} onMerged={onMerged} />
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

function MergePanel({ changeId, target, me, merged, approved, anyDirty, savedVersion, onMerged }: {
  changeId: string; target: ChangeTarget; me: User | null; merged: boolean; approved: boolean; anyDirty: boolean; savedVersion: number; onMerged: () => void;
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

  const admin = isAdmin(me?.roles);
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
        setError(messageFor(e.body?.error, admin));
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
          disabled={busy || anyDirty || !approved || (hasWarnings && !ack) || (hasErrors && !(admin && override && reason.trim()))}>
          {busy ? <span className="spinner" /> : <IconMerge />}Merge
        </button>
      </div>

      {!approved && <div className="faint" style={{ fontSize: 12 }}>This change must be approved before it can be merged.</div>}
      {approved && anyDirty && <div className="faint" style={{ fontSize: 12 }}>Save all edited files before merging.</div>}

      {hasWarnings && !hasErrors && (
        <label className="hstack" style={{ marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I have reviewed the {gate.warningCount} warning{gate.warningCount > 1 ? 's' : ''} and want to proceed.</span>
        </label>
      )}

      {hasErrors && (
        <div style={{ marginTop: 10 }}>
          <Banner kind="error">This version has {gate.errorCount} blocking error{gate.errorCount > 1 ? 's' : ''}.{admin ? ' As an admin you may override with a recorded reason.' : ' Only an admin can override.'}</Banner>
          {admin && (
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

function RuleBuilder({ onInsert, onClose }: { onInsert: (line: string) => void; onClose: () => void }) {
  const [algo, setAlgo] = useState('');
  const [outputs, setOutputs] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }]);
  const [conds, setConds] = useState<{ field: string; op: string; value: string }[]>([{ field: '', op: '=', value: '' }]);
  const fields = useMemo(() => [...KNOWN_FIELDS].sort(), []);
  const ops = ['=', '!=', '<', '>', '<=', '>=', '~', '!~'];

  function gen(): string {
    const o = outputs.filter((x) => x.key.trim()).map((x) => `${x.key.trim()}=${x.value.trim()}`).join('^');
    let left = '';
    if (algo.trim()) left += `9001=${algo.trim()};`;
    if (o) left += `9012=${o}`;
    const c = conds.filter((x) => x.field.trim()).map((x) => `${x.field.trim()}${x.op}${x.value.trim()}`).join(', ');
    return c ? `${left} :: ${c}` : left;
  }
  const preview = gen();
  const setOut = (i: number, patch: Partial<{ key: string; value: string }>) => setOutputs((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const setCond = (i: number, patch: Partial<{ field: string; op: string; value: string }>) => setConds((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: 12, background: 'var(--raised)', overflow: 'auto', maxHeight: 320 }}>
      <div className="insp-label" style={{ marginBottom: 6 }}>Tags to set (9012)</div>
      {outputs.map((o, i) => (
        <div key={i} className="hstack" style={{ gap: 6, marginBottom: 6 }}>
          <input className="input mono" style={{ height: 26, width: 120 }} placeholder="tag (e.g. 144)" value={o.key} onChange={(e) => setOut(i, { key: e.target.value })} />
          <span className="faint">=</span>
          <input className="input mono" style={{ height: 26, width: 120 }} placeholder="value" value={o.value} onChange={(e) => setOut(i, { value: e.target.value })} />
          <button className="btn btn-sm btn-ghost" onClick={() => setOutputs((a) => a.filter((_, idx) => idx !== i))}><IconX style={{ width: 12, height: 12 }} /></button>
        </div>
      ))}
      <button className="btn btn-sm btn-ghost" onClick={() => setOutputs((a) => [...a, { key: '', value: '' }])}><IconPlus style={{ width: 12, height: 12 }} />tag</button>

      <div className="insp-label" style={{ margin: '12px 0 6px' }}>Algo (9001) — optional</div>
      <input className="input mono" style={{ height: 26, width: 160 }} placeholder="e.g. VWAP" value={algo} onChange={(e) => setAlgo(e.target.value)} />

      <div className="insp-label" style={{ margin: '12px 0 6px' }}>Conditions (all must hold)</div>
      {conds.map((c, i) => (
        <div key={i} className="hstack" style={{ gap: 6, marginBottom: 6 }}>
          <input className="input mono" style={{ height: 26, width: 190 }} list="rb-fields" placeholder="field" value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} />
          <select className="input" style={{ height: 26, width: 64, padding: '0 6px' }} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>{ops.map((op) => <option key={op} value={op}>{op}</option>)}</select>
          <input className="input mono" style={{ height: 26, width: 150 }} placeholder="value (^ = OR)" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} />
          <button className="btn btn-sm btn-ghost" onClick={() => setConds((a) => a.filter((_, idx) => idx !== i))}><IconX style={{ width: 12, height: 12 }} /></button>
        </div>
      ))}
      <button className="btn btn-sm btn-ghost" onClick={() => setConds((a) => [...a, { field: '', op: '=', value: '' }])}><IconPlus style={{ width: 12, height: 12 }} />condition</button>
      <datalist id="rb-fields">{fields.map((f) => <option key={f} value={f} />)}</datalist>

      <div style={{ marginTop: 12 }}>
        <div className="insp-label" style={{ marginBottom: 4 }}>Preview</div>
        <div className="mono" style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{preview || '…'}</div>
      </div>
      <div className="hstack" style={{ marginTop: 10 }}>
        <button className="btn btn-sm btn-primary" disabled={!preview.trim()} onClick={() => onInsert(preview)}><IconPlus style={{ width: 13, height: 13 }} />Insert rule</button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
      </div>
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
