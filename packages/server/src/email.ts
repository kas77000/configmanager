import type { Change } from './store/changes';

export interface BuiltEmail { to: string[]; cc?: string[]; subject: string; html: string; }

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}


// Outlook renders with Word's engine: use tables + inline styles, no modern CSS.
const TABLE = 'border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#1a1a1a';
const TH = 'border:1px solid #c8c8c8;background:#f2f2f2;padding:6px 10px;text-align:left';
const TD = 'border:1px solid #c8c8c8;padding:6px 10px;vertical-align:top';

function shell(intro: string, table: string, link: string, linkText: string, sender: string): string {
  return [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a">`,
    `<p>Hi Team,</p>`,
    `<p>${esc(intro)}</p>`,
    table,
    `<p style="margin-top:14px"><a href="${esc(link)}" style="color:#3538cd;font-weight:600">${esc(linkText)}</a></p>`,
    `<p style="margin-top:16px">Thanks and Regards,<br>${esc(sender)}</p>`,
    `</div>`,
  ].join('\n');
}

export function approvalEmail(change: Change, recipients: string[], cc: string[], appBaseUrl: string, sender: string): BuiltEmail {
  const rows = change.items
    .map((it) => `<tr><td style="${TD}">${esc(it.description)}</td><td style="${TD}">${esc(it.file)}</td><td style="${TD}">${esc(it.instances.join(', '))}</td></tr>`)
    .join('');
  const table = `<table style="${TABLE}"><tr><th style="${TH}">Description</th><th style="${TH}">Config Changed</th><th style="${TH}">Newly applies to instances</th></tr>${rows}</table>`;
  const link = `${appBaseUrl.replace(/\/$/, '')}/changes/${change.id}`;
  const intro = change.effectiveDate
    ? `Could you please approve the following modifications of config effective for trading on ${change.effectiveDate}.`
    : 'Could you please approve the following configuration modifications.';
  return {
    to: recipients,
    cc,
    subject: change.effectiveDate
      ? `Config changes request for ${change.effectiveDate}: ${change.description}`
      : `Config change request ${change.id}: ${change.description}`,
    html: shell(intro, table, link, 'Approve or reject this request in Configuration Manager', sender),
  };
}

export function recapEmail(change: Change, appBaseUrl: string, sender: string): BuiltEmail {
  const jira = change.jiraTickets ?? [];
  const rows = change.items
    .map((it) => {
      const t = jira.find((j) => j.file === it.file);
      const ticket = t ? `<a href="${esc(t.url)}">${esc(t.key)}</a>` : '—';
      return `<tr><td style="${TD}">${esc(it.description)}</td><td style="${TD}">${esc(it.file)}</td><td style="${TD}">${esc(it.instances.join(', '))}</td><td style="${TD}">${ticket}</td></tr>`;
    })
    .join('');
  const table = `<table style="${TABLE}"><tr><th style="${TH}">Description</th><th style="${TH}">Config Changed</th><th style="${TH}">Applied to instances</th><th style="${TH}">JIRA</th></tr>${rows}</table>`;
  const link = `${appBaseUrl.replace(/\/$/, '')}/changes/${change.id}`;
  const intro = change.effectiveDate
    ? `Below changes are applied and will be effective for trading on ${change.effectiveDate}.`
    : 'The following configuration changes have been reviewed, approved, and applied.';
  return {
    to: [],
    subject: change.effectiveDate
      ? `${change.description} effective for ${change.effectiveDate} trading`
      : `Config change ${change.id} applied: ${change.description}`,
    html: shell(intro, table, link, 'View this change in Configuration Manager', sender),
  };
}

/** RFC822 message. `X-Unsent: 1` makes Outlook open the .eml as an editable draft ready to send. */
export function toEml(email: BuiltEmail): string {
  const headers = [`To: ${email.to.join(', ')}`];
  if (email.cc && email.cc.length) headers.push(`Cc: ${email.cc.join(', ')}`);
  headers.push(`Subject: ${email.subject}`, 'X-Unsent: 1', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', email.html);
  return headers.join('\r\n');
}
