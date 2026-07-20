"""Outlook .eml draft generation — a faithful port of server/src/email.ts.

The app never sends mail; it produces pre-filled `X-Unsent: 1` HTML drafts that
the user reviews and sends from Outlook.
"""
from __future__ import annotations


def esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


TABLE = "border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#1a1a1a"
TH = "border:1px solid #c8c8c8;background:#f2f2f2;padding:6px 10px;text-align:left"
TD = "border:1px solid #c8c8c8;padding:6px 10px;vertical-align:top"


def _shell(intro: str, table: str, link: str, link_text: str, sender: str) -> str:
    return "\n".join([
        '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1a1a1a">',
        "<p>Hi Team,</p>",
        f"<p>{esc(intro)}</p>",
        table,
        f'<p style="margin-top:14px"><a href="{esc(link)}" style="color:#3538cd;font-weight:600">{esc(link_text)}</a></p>',
        f'<p style="margin-top:16px">Thanks and Regards,<br>{esc(sender)}</p>',
        "</div>",
    ])


def approval_email(change: dict, recipients: list[str], cc: list[str], app_base_url: str, sender: str) -> dict:
    rows = []
    for it in change.get("items", []):
        rows.append(
            f'<tr><td style="{TD}">{esc(it["description"])}</td>'
            f'<td style="{TD}">{esc(it["file"])}</td>'
            f'<td style="{TD}">{esc(", ".join(it["instances"]))}</td></tr>'
        )
    table = (
        f'<table style="{TABLE}"><thead><tr>'
        f'<th style="{TH}">Description</th>'
        f'<th style="{TH}">Config Changed</th>'
        f'<th style="{TH}">Newly applies to instances</th>'
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )
    link = app_base_url.rstrip("/") + "/changes/" + change["id"]
    eff = change.get("effectiveDate")
    if eff:
        intro = f"Could you please approve the following modifications of config effective for trading on {eff}."
        subject = f"Config changes request for {eff}: {change['description']}"
    else:
        intro = "Could you please approve the following configuration modifications."
        subject = f"Config change request {change['id']}: {change['description']}"
    html = _shell(intro, table, link, "Approve or reject this request in Configuration Manager", sender)
    return {"to": recipients, "cc": cc, "subject": subject, "html": html}


def recap_email(change: dict, app_base_url: str, sender: str) -> dict:
    jira = change.get("jiraTickets") or []
    rows = []
    for i, it in enumerate(change.get("items", [])):
        ticket = next((j for j in jira if j["item"] == i), None)
        if ticket:
            cell = f'<a href="{esc(ticket["url"])}">{esc(ticket["key"])}</a>'
        else:
            cell = "—"
        rows.append(
            f'<tr><td style="{TD}">{esc(it["description"])}</td>'
            f'<td style="{TD}">{esc(it["file"])}</td>'
            f'<td style="{TD}">{esc(", ".join(it["instances"]))}</td>'
            f'<td style="{TD}">{cell}</td></tr>'
        )
    table = (
        f'<table style="{TABLE}"><thead><tr>'
        f'<th style="{TH}">Description</th>'
        f'<th style="{TH}">Config Changed</th>'
        f'<th style="{TH}">Applied to instances</th>'
        f'<th style="{TH}">JIRA</th>'
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )
    link = app_base_url.rstrip("/") + "/changes/" + change["id"]
    eff = change.get("effectiveDate")
    if eff:
        intro = f"Below changes are applied and will be effective for trading on {eff}."
        subject = f"{change['description']} effective for {eff} trading"
    else:
        intro = "The following configuration changes have been reviewed, approved, and applied."
        subject = f"Config change {change['id']} applied: {change['description']}"
    html = _shell(intro, table, link, "View this change in Configuration Manager", sender)
    return {"to": [], "cc": [], "subject": subject, "html": html}


def to_eml(email: dict) -> str:
    lines = [f"To: {', '.join(email['to'])}"]
    if email.get("cc"):
        lines.append(f"Cc: {', '.join(email['cc'])}")
    lines += [
        f"Subject: {email['subject']}",
        "X-Unsent: 1",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "",
        email["html"],
    ]
    return "\r\n".join(lines)
