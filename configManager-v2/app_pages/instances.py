"""Instances dashboard (`/`) — instances grouped by environment, with sync.

Selection uses real st.checkbox widgets (in-session reruns, no full-page reload),
so ticking instances is smooth. "Sync selected" acts on the ticked rows."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError


def _sync_status_html(res: dict) -> str:
    if res is None:
        return ""
    if res.get("error"):
        return ui.badge("error", res["error"][:40])
    if res.get("updated"):
        return ui.badge("success", "Updated", glyph="✓")
    return ui.badge("neutral", "In sync", glyph="✓")


def _do_sync(store: Store, me: dict, codes: list[str], results: dict) -> None:
    for c in codes:
        try:
            results[c] = store.sync(c, actor=me["windowsId"])
        except StoreError as e:
            results[c] = {"error": e.message}


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
            with st.container(key=f"insthead_{env}"):
                h = st.columns([0.5, 2, 3, 2.5], vertical_alignment="center")
                h[1].markdown('<div class="cm faint" style="font-size:11px;text-transform:uppercase;'
                              'letter-spacing:.04em">Instance</div>', unsafe_allow_html=True)
                h[2].markdown('<div class="cm faint" style="font-size:11px;text-transform:uppercase;'
                              'letter-spacing:.04em">Environment</div>', unsafe_allow_html=True)
                h[3].markdown('<div class="cm faint" style="font-size:11px;text-transform:uppercase;'
                              'letter-spacing:.04em">Sync</div>', unsafe_allow_html=True)

            for inst in group:
                code = inst["code"]
                with st.container(key=f"instrow_{code}"):
                    rc = st.columns([0.5, 2, 3, 2.5], vertical_alignment="center")
                    rc[0].checkbox("select", key=f"inst_sel_{code}", label_visibility="collapsed")
                    with rc[1]:
                        ui.md(f'<a class="mono" style="font-weight:600;color:var(--text);'
                              f'text-decoration:none" href="{ui.href(p="instance", code=code)}">{code}</a>')
                    with rc[2]:
                        ui.md(ui.env_tag(inst))
                    with rc[3]:
                        ui.md(_sync_status_html(results.get(code)))
