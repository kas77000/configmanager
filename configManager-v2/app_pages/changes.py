"""Changes list (`/changes`) + a dedicated new-change view (`?p=changes&new=1`)."""
from __future__ import annotations

from datetime import date, timedelta

import streamlit as st

from . import ui
from core.store import Store, StoreError, can_edit


def _next_business_day() -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _all_files(instances: list[dict]) -> list[str]:
    files = set()
    for i in instances:
        files.update(i["files"])
    return sorted(files)


# ---------------------------------------------------------------------------
# New-change view
# ---------------------------------------------------------------------------

def _new_view(store: Store, me: dict) -> None:
    instances = store.list_instances()
    all_files = _all_files(instances)
    mods = st.session_state.setdefault("new_mods", [{"file": "", "description": "", "instances": []}])

    ui.page_header(f'<a href="{ui.href(p="changes")}">‹ Changes</a> · New', "New change",
                   "A change bundles one or more modifications. Each is a config file with its own "
                   "description and the instances it applies to.")

    with st.container(border=True):
        top = st.columns([2, 1])
        title = top[0].text_input("Change title", key="nc_title",
                                 placeholder="e.g. Korea rollout: restrict Post layering")
        eff = top[1].date_input("Effective date", value=_next_business_day(), key="nc_eff")

        st.divider()
        ui.md('<div class="cm" style="font-weight:600;margin:0 0 4px">Modifications</div>')

        for idx, mod in enumerate(mods):
            if idx > 0:
                st.divider()
            hc = st.columns([6, 1], vertical_alignment="center")
            hc[0].markdown(f'<div class="cm faint" style="font-size:11px;text-transform:uppercase;'
                           f'letter-spacing:.04em">Modification {idx + 1}</div>', unsafe_allow_html=True)
            # Always render Remove (disabled for the only modification) so the row height —
            # and the gap down to "Config file" — stays constant as modifications are added.
            if hc[1].button("Remove", key=f"rm_mod_{idx}", disabled=len(mods) <= 1):
                mods.pop(idx)
                st.rerun()

            fc = st.columns(2)
            file_opts = ["Select a file"] + all_files
            cur = mod["file"] if mod["file"] in all_files else "Select a file"
            sel = fc[0].selectbox("Config file", file_opts, index=file_opts.index(cur), key=f"mod_file_{idx}")
            mod["file"] = "" if sel == "Select a file" else sel
            mod["description"] = fc[1].text_input("Description", value=mod["description"],
                                                  key=f"mod_desc_{idx}",
                                                  placeholder="What this change does to the file")
            eligible = [i["code"] for i in instances if mod["file"] and mod["file"] in i["files"]]
            if not mod["file"]:
                ui.md('<div class="faint">Select a file first; only instances that manage it can be chosen.</div>')
                mod["instances"] = []
            elif not eligible:
                ui.md('<div class="faint">No instance manages this file yet.</div>')
                mod["instances"] = []
            else:
                kept = [c for c in mod["instances"] if c in eligible]
                mod["instances"] = st.multiselect("Applies to instances", eligible, default=kept,
                                                  key=f"mod_inst_{idx}")

        st.divider()
        if st.button("Add modification", key="add_mod"):
            mods.append({"file": "", "description": "", "instances": []})
            st.rerun()

    valid = bool(title.strip()) and all(m["file"] and m["description"].strip() and m["instances"] for m in mods)
    st.write("")
    with st.container(horizontal=True):
        do_create = st.button("Create change", type="primary", disabled=not valid, key="create_nc")
        do_cancel = st.button("Cancel", key="cancel_nc")
    if do_create:
        try:
            items = [{"file": m["file"], "description": m["description"], "instances": m["instances"]}
                     for m in mods]
            ch = store.create_change(title, items, eff.isoformat(), me["windowsId"])
            st.session_state.pop("new_mods", None)
            ui.goto(p="change", id=ch["id"])
        except StoreError as e:
            ui.md(ui.banner("error", ui.esc(e.message)))
    if do_cancel:
        st.session_state.pop("new_mods", None)
        ui.goto(p="changes")


# ---------------------------------------------------------------------------
# List view
# ---------------------------------------------------------------------------

def _list_view(store: Store, me: dict) -> None:
    editor = can_edit(me["roles"])
    ui.page_header("Workflow", "Changes",
                   "A change bundles one or more modifications. Each modification is a config file "
                   "with its own description and the instances it applies to.")

    if editor and st.button("New change", type="primary", key="btn_new_change"):
        st.session_state.pop("new_mods", None)
        ui.goto(p="changes", new="1")

    changes = store.list_changes()
    if not changes:
        ui.empty("No changes yet.", glyph="⑃")
        return

    rows = []
    for c in reversed(changes):
        link = ui.href(p="change", id=c["id"])
        files = sorted({it["file"] for it in c["items"]})
        insts = ", ".join(t["instance"] for t in c["targets"])
        eff = c.get("effectiveDate") or '<span class="faint">—</span>'

        def cell(inner, extra=""):
            return f'<td class="{extra}"><a class="rowcell" href="{link}">{inner}</a></td>'

        rows.append(
            f'<tr class="rowlink">'
            + cell(f'<span class="mono" style="font-weight:600">{c["id"]}</span>')
            + cell(ui.esc(c["description"]))
            + cell(f'<span class="mono">{eff}</span>')
            + cell(f'<span class="mono faint">{len(files)}</span>')
            + cell(f'<span class="mono faint">{ui.esc(insts)}</span>')
            + f'<td>{ui.status_badge(c["status"])}</td>'
            + cell(f'<span class="faint">{ui.rel_time(c["createdAt"])}</span>')
            + "</tr>")

    ui.md('<div class="panel"><table class="list"><thead><tr>'
          '<th style="width:70px">ID</th><th>Change</th><th style="width:110px">Effective</th>'
          '<th style="width:60px">Files</th><th style="width:180px">Instances</th>'
          '<th style="width:90px">Status</th><th style="width:100px">Created</th>'
          f'</tr></thead><tbody>{"".join(rows)}</tbody></table></div>')


def render(store: Store, me: dict) -> None:
    if st.query_params.get("new") and can_edit(me["roles"]):
        _new_view(store, me)
    else:
        _list_view(store, me)
