"""History (`/history`) — activity log + commit list, filterable by instance/time."""
from __future__ import annotations

from datetime import datetime, timezone

import streamlit as st

from . import ui
from core.store import Store

_ACTION_TEXT = {
    "create-change": "opened change", "create-branch": "created branch", "edit": "edited",
    "merge": "merged into", "sync-import": "synced live version into", "submit-change": "submitted",
    "approve-change": "approved", "reject-change": "rejected", "create-instance": "created instance",
    "update-instance": "updated instance", "delete-instance": "deleted instance",
    "add-file": "added file to", "remove-file": "unmanaged a file on", "add-user": "added user",
    "update-user": "updated user", "remove-user": "removed user", "attach-jira": "attached Jira",
    "switch-vcs-backend": "switched VCS backend",
}

_RANGES = {"All time": None, "Last 24h": 86400, "Last 7 days": 604800, "Last 30 days": 2592000}


def _cutoff(iso: str, seconds) -> bool:
    if seconds is None:
        return True
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return True
    return (datetime.now(timezone.utc) - dt).total_seconds() <= seconds


def _details_bits(d: dict) -> str:
    bits = []
    for k in ("changeId", "file", "user"):
        if d.get(k):
            bits.append(str(d[k]))
    if d.get("from") and d.get("to"):
        bits.append(f'{d["from"]} → {d["to"]}')
    if d.get("override"):
        bits.append("override")
    if d.get("overrideReason"):
        bits.append(str(d["overrideReason"]))
    if d.get("reason"):
        bits.append(str(d["reason"]))
    return (" · " + " · ".join(ui.esc(b) for b in bits)) if bits else ""


def render(store: Store, me: dict) -> None:
    ui.page_header("Traceability", "History",
                   "The commit graph across all instances, with who did what and when. Filter by "
                   "instance and time; open a commit to see exactly what changed.")

    data = store.history()
    instances = [i["code"] for i in store.list_instances()]

    fcols = st.columns([3, 1.2], vertical_alignment="center")
    with fcols[0]:
        picked = st.multiselect("Instances", instances, label_visibility="collapsed",
                               placeholder="Filter by instance…", key="hist_inst")
    with fcols[1]:
        rng = st.selectbox("Range", list(_RANGES.keys()), index=1, label_visibility="collapsed",
                          key="hist_range")
    seconds = _RANGES[rng]
    inst_set = set(picked)

    # Activity
    audit = [e for e in reversed(data["audit"]) if _cutoff(e["timestamp"], seconds)]
    if inst_set:
        def touches(e):
            b = e.get("branch") or ""
            code = b.split("/")[1] if b.startswith("instance/") else (
                b.split("/")[-1] if b.startswith("change/") else None)
            det = e.get("details") or {}
            return (code in inst_set) or (det.get("instance") in inst_set) or \
                   bool(inst_set & set(det.get("instances", [])))
        audit = [e for e in audit if touches(e)]

    ui.md(f'<div class="group-title"><h2>Activity</h2>'
          f'<span class="count-chip">{len(audit)}</span></div>')
    if not audit:
        ui.empty("No activity in this filter.")
    else:
        rows = []
        for e in audit:
            act = _ACTION_TEXT.get(e["action"], e["action"])
            branch = f'<span class="mono faint">{ui.esc(e["branch"])}</span>' if e.get("branch") else ""
            rows.append(
                f'<div class="rowflex" style="padding:8px 4px;border-bottom:1px solid var(--border)">'
                f'<span class="mono" style="font-weight:600">{ui.esc(e["windowsId"])}</span>'
                f'<span class="muted">{ui.esc(act)}</span> {branch}'
                f'<span class="faint">{_details_bits(e.get("details") or {})}</span>'
                f'<span class="spacer"></span>'
                f'<span class="faint">{ui.rel_time(e["timestamp"])}</span></div>')
        ui.md('<div class="panel" style="max-height:300px;overflow:auto;padding:2px 16px">'
              + "".join(rows) + "</div>")

    # Commits
    commits = [c for c in data["commits"] if _cutoff(c["date"], seconds)]
    if inst_set:
        commits = [c for c in commits if inst_set & set(c["instances"])]

    ui.md(f'<div class="group-title"><h2>Commit graph</h2>'
          f'<span class="count-chip">{len(commits)}</span></div>')
    if not commits:
        ui.empty("No commits in this filter.")
    else:
        ui.md(f'<div class="panel" style="max-height:460px;overflow:auto;padding:4px 12px">'
              f'{ui.commit_graph(commits)}</div>')
