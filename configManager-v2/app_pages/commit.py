"""Commit page (`/commits/:hash`) — per-file diffs for one commit."""
from __future__ import annotations

from . import ui
from core.store import Store, StoreError


def render(store: Store, me: dict, commit_hash: str) -> None:
    back = f'<a href="{ui.href(p="history")}">‹ History</a> · Commit {ui.esc((commit_hash or "")[:10])}'
    try:
        c = store.commit(commit_hash)
    except StoreError:
        ui.page_header(back, "Commit", "")
        ui.empty("Commit not found.")
        return

    total_add = sum(f["additions"] for f in c["files"])
    total_del = sum(f["deletions"] for f in c["files"])
    merge = " · merge commit" if len(c["parents"]) > 1 else ""
    ui.page_header(back, c["subject"], "")
    ui.md(f'<div class="hstack" style="margin-top:-12px;margin-bottom:12px">'
          f'<span class="mono faint">{ui.esc(c["authorName"])}</span>'
          f'<span class="faint">· {ui.rel_time(c["date"])}{merge}</span>'
          f'{ui.badge("success", f"+{total_add}", glyph="")} '
          f'{ui.badge("error", f"-{total_del}", glyph="")}</div>')

    refs = " ".join(f'<span class="tag mono">{ui.esc(x)}</span>' for x in c["instances"]) \
        or '<span class="faint">unknown</span>'
    ui.md(f'<div class="insp-label">Instances</div><div class="cm">{refs}</div>')

    if not c["files"]:
        ui.empty("No file changes in this commit.")
        return

    for f in c["files"]:
        ui.md(f'<div class="panel"><div class="panel-head">'
              f'<span class="mono" style="font-weight:600">{ui.esc(f["file"])}</span>'
              f'<div class="hstack">{ui.badge("success", f"+{f["additions"]}", glyph="")} '
              f'{ui.badge("error", f"-{f["deletions"]}", glyph="")}</div></div>'
              f'{ui.render_diff(f["patch"], max_height=480)}</div>')
