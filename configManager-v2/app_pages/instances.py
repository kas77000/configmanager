"""Instances dashboard (`/`) — instances grouped by environment.

Dense hairline rows (styled to match the Instances-admin table) with real
widgets: a selection checkbox plus per-row View and Sync buttons. Selection and
sync run in-session (no full-page reload), so the page stays smooth."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError


def _sync_status_html(res: dict) -> str:
    if res is None:
        return '<span class="faint">—</span>'
    if res.get("error"):
        return ui.badge("error", res["error"][:36])
    if res.get("updated"):
        return ui.badge("success", "Updated", glyph="✓")
    return ui.badge("neutral", "In sync", glyph="✓")


def _do_sync(store: Store, me: dict, codes: list[str], results: dict) -> None:
    for c in codes:
        try:
            results[c] = store.sync(c, actor=me["windowsId"])
        except StoreError as e:
            results[c] = {"error": e.message}


_COLS = [0.45, 1.4, 2.2, 2.1, 2.2]
_LABELS = ["", "Instance", "Environment", "Sync", "Actions"]


def _toggle_all(env: str, codes: list[str]) -> None:
    val = st.session_state.get(f"selall_{env}", False)
    for c in codes:
        st.session_state[f"inst_sel_{c}"] = val


def _header(env: str, group: list[dict]) -> None:
    codes = [i["code"] for i in group]
    with st.container(key=f"insthead_{env}"):
        h = st.columns(_COLS, vertical_alignment="center")
        h[0].checkbox("select all", key=f"selall_{env}", label_visibility="collapsed",
                      on_change=_toggle_all, args=(env, codes))
        for i, lbl in enumerate(_LABELS):
            if lbl:
                align = "text-align:center" if lbl == "Actions" else ""
                h[i].markdown(f'<div class="cm faint" style="font-size:11px;text-transform:uppercase;'
                              f'letter-spacing:.04em;{align}">{lbl}</div>', unsafe_allow_html=True)


def render(store: Store, me: dict) -> None:
    ui.page_header("Environments", "Instances",
                   "Each instance keeps its own version of the config. Changes are branched and "
                   "merged per instance; pilots roll out ahead of production.")

    instances = store.list_instances()
    results = st.session_state.setdefault("sync_results", {})
    selected = [i["code"] for i in instances if st.session_state.get(f"inst_sel_{i['code']}")]

    tc = st.columns([2.4, 6], vertical_alignment="center")
    with tc[0]:
        if st.button(f"Sync selected ({len(selected)})", type="primary", disabled=not selected,
                    use_container_width=True):
            _do_sync(store, me, selected, results)
            st.rerun()

    for env, title in (("pilot", "Pilot"), ("production", "Production")):
        group = [i for i in instances if i["environment"] == env]
        if not group:
            continue
        ui.md(f'<div class="group-title"><h2>{title}</h2>'
              f'<span class="count-chip">{len(group)}</span></div>')

        with st.container(border=True):
            _header(env, group)
            for inst in group:
                code = inst["code"]
                with st.container(key=f"instrow_{code}"):
                    rc = st.columns(_COLS, vertical_alignment="center")
                    rc[0].checkbox("select", key=f"inst_sel_{code}", label_visibility="collapsed")
                    with rc[1]:
                        ui.md(f'<span class="mono" style="font-weight:600">{code}</span>')
                    with rc[2]:
                        ui.md(ui.env_tag(inst))
                    with rc[3]:
                        ui.md(_sync_status_html(results.get(code)))
                    with rc[4]:
                        bc = st.columns(2)
                        if bc[0].button("View", key=f"view_{code}", use_container_width=True):
                            ui.goto(p="instance", code=code)
                        if bc[1].button("Sync", key=f"sync_{code}", use_container_width=True):
                            _do_sync(store, me, [code], results)
                            st.rerun()
