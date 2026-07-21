"""Instance page (`/instances/:code`) — latest merged config per file, read-only."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError


def _strip_comments(text: str) -> str:
    """Drop every full-line # comment so the copied config carries no annotations."""
    return "\n".join(line for line in text.split("\n") if not line.lstrip().startswith("#"))


def render(store: Store, me: dict, code: str) -> None:
    inst = store.get_instance(code) if code else None
    back = f'<a href="{ui.href(p="instances")}">‹ Instances</a> · Current config'
    if not inst:
        ui.page_header(back, code or "?", "")
        ui.empty("Instance not found.")
        return

    ui.page_header(back, code, "The latest merged config for every file managed on this instance. "
                              "Copy each to apply it manually on the server.", title_mono=True)
    if inst.get("serverAddress"):
        ui.md(f'<div class="faint" style="margin-top:-12px;margin-bottom:12px">Server: '
              f'<span class="mono">{ui.esc(inst["serverAddress"])}</span></div>')

    files = inst["files"]
    if not files:
        ui.empty("No files are managed for this instance yet.")
        return

    hide = st.toggle("Hide comment lines (#) — copy a clean config to push", key=f"hidecom_{code}",
                     help="Removes every # comment line from the view below so the copied config "
                          "carries no annotations onto the server. The stored config is unchanged.")

    for f in files:
        try:
            content = store.read_instance_file(code, f)["content"]
        except StoreError:
            content = None
        display = content
        if hide and content:
            display = _strip_comments(content)
        path = inst.get("paths", {}).get(f)
        head_left = f'<span class="mono" style="font-weight:600">{ui.esc(f)}</span>'
        if path:
            head_left += f' <span class="mono faint" style="font-size:11px">{ui.esc(path)}</span>'
        nlines = f'<span class="faint">{display.count(chr(10)) + 1} lines</span>' if display else ""
        with st.container(border=True):
            ui.md(f'<div class="rowflex"><div>{head_left}</div>'
                  f'<span class="spacer"></span><div class="hstack">{nlines}</div></div>')
            # st.code preserves content exactly, scrolls horizontally, and adds a copy button.
            st.code(display if display else "(empty)", language=None, height=420)
