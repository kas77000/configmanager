"""Instances admin (`/admin`) — dense list; per-instance editing on a sub-view."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError, is_admin

_BACKEND_LABEL = {"builtin": "Built-in (dependency-free)", "git": "Official git"}
_BACKEND_DESC = {
    "builtin": "Version history stored as JSON in data/. No external tools; runs anywhere.",
    "git": "Version history in a real .git repo (data/config-repo). Inspectable with git tooling.",
}


# ---------------------------------------------------------------------------
# Panels
# ---------------------------------------------------------------------------

def _service_account_panel(sv: dict) -> None:
    badge = ui.badge("success", "configured", glyph="✓") if sv["serviceAccountConfigured"] \
        else ui.badge("warning", "not configured")
    user = f'<span class="mono">{ui.esc(sv["serviceAccountUser"])}</span>' if sv["serviceAccountUser"] \
        else '<span class="faint">not set</span>'
    ui.md('<div class="panel panel-pad"><div class="cm">'
          f'<div class="rowflex" style="margin-bottom:10px"><b>Service account</b> {badge}</div>'
          f'<div class="kv"><div class="k">Username</div><div>{user}</div></div>'
          '<div class="faint" style="font-size:11px;margin-top:8px">Used only to reach server-type '
          'instances. Shared drives need no credentials.</div></div></div>')


def _vcs_panel(store: Store, me: dict, sv: dict) -> None:
    current = sv["vcsBackend"]
    git_ok = sv["gitAvailable"]
    cur_badge = ui.badge("info", _BACKEND_LABEL[current], glyph="●")
    ui.md('<div class="panel panel-pad"><div class="cm">'
          f'<div class="rowflex" style="margin-bottom:6px"><b>Version control backend</b> {cur_badge}</div>'
          f'<div class="faint" style="font-size:12px">{ui.esc(_BACKEND_DESC[current])}</div></div></div>')

    options = ["builtin"] + (["git"] if git_ok else [])
    choice = st.selectbox("Switch backend to", options, index=options.index(current),
                         format_func=lambda b: _BACKEND_LABEL[b], key="vcs_choice")
    if not git_ok:
        ui.md('<div class="faint" style="font-size:12px">Official git is unavailable — the '
              '<span class="mono">git</span> binary was not found on PATH. Install git and reload '
              'to enable it.</div>')
    if choice != current:
        ui.md(ui.banner("warning",
                        "Switching the backend <b>resets all version history and every change</b> "
                        "(drafts, submitted, merged). Users, the instances registry, settings, and the "
                        "audit log are kept; instances are re-seeded from the seed file."))
        confirm = st.text_input("Type CONFIRM to switch", key="vcs_confirm", placeholder="CONFIRM")
        if st.button(f"Switch to {_BACKEND_LABEL[choice]} and reset", type="primary",
                    disabled=confirm.strip().upper() != "CONFIRM"):
            try:
                store.switch_vcs_backend(choice, actor=me["windowsId"])
                st.session_state.pop("vcs_confirm", None)
                st.rerun()
            except StoreError as e:
                ui.md(ui.banner("error", ui.esc(e.message)))


def _add_instance_form(store: Store, me: dict, instances: list[dict]) -> None:
    with st.container(border=True):
        ui.md('<div class="cm"><b>Add instance</b> '
              '<span class="faint">— branches from an existing instance, inheriting its files.</span></div>')
        c = st.columns(4, vertical_alignment="bottom")
        code = c[0].text_input("Code", key="ai_code", placeholder="APIN")
        env = c[1].selectbox("Environment", ["production", "pilot"], key="ai_env")
        copy_from = c[2].selectbox("Copy files from", [i["code"] for i in instances], key="ai_copy")
        uat = c[3].checkbox("UAT instance", key="ai_uat")
        bc = st.columns([1, 1, 6])
        if bc[0].button("Create", type="primary", disabled=not code.strip()):
            try:
                store.create_instance(code.strip().upper(), env, uat, copy_from, actor=me["windowsId"])
                st.session_state["show_add_inst"] = False
                st.rerun()
            except StoreError as e:
                ui.md(ui.banner("error", ui.esc(e.message)))
        if bc[1].button("Cancel", key="cancel_ai"):
            st.session_state["show_add_inst"] = False
            st.rerun()


# ---------------------------------------------------------------------------
# Edit sub-view
# ---------------------------------------------------------------------------

def _edit_view(store: Store, me: dict, code: str) -> None:
    inst = store.get_instance(code)
    back = f'<a href="{ui.href(p="admin")}">‹ Instances</a> · Edit'
    if not inst:
        ui.page_header(back, code, "")
        ui.empty("Instance not found.")
        return
    ui.page_header(back, code, "Configure this instance and the files it manages.", title_mono=True)

    with st.container(border=True):
        ui.md('<div class="cm"><b>Settings</b></div>')
        c = st.columns(2, vertical_alignment="top")
        with c[0]:
            env = st.selectbox("Environment", ["pilot", "production"],
                              index=["pilot", "production"].index(inst["environment"]), key=f"e_env_{code}")
            if env != inst["environment"]:
                store.update_instance(code, {"environment": env}, actor=me["windowsId"]); st.rerun()
            lt = st.selectbox("Location type", ["shared", "server"],
                             index=["shared", "server"].index(inst.get("locationType", "server")),
                             key=f"e_lt_{code}")
            if lt != inst.get("locationType", "server"):
                store.update_instance(code, {"locationType": lt}, actor=me["windowsId"]); st.rerun()
        with c[1]:
            uat = st.checkbox("UAT instance", value=inst["uat"], key=f"e_uat_{code}")
            if uat != inst["uat"]:
                store.update_instance(code, {"uat": uat}, actor=me["windowsId"]); st.rerun()
            addr = st.text_input("Location / server address", value=inst.get("serverAddress", ""),
                                key=f"e_addr_{code}",
                                placeholder="api-a.firm.com" if lt == "server" else r"\\fileserver\algo\APIA")
            if addr != inst.get("serverAddress", ""):
                store.update_instance(code, {"serverAddress": addr}, actor=me["windowsId"]); st.rerun()
        if lt == "server":
            access = f'Connects via the service account {store.settings_view()["serviceAccountUser"] or "(none set)"}.'
        else:
            access = "Read directly from this location — no service account needed."
        ui.md(f'<div class="faint" style="font-size:12px">{ui.esc(access)}</div>')

    # Managed files
    with st.container(border=True):
        ui.md('<div class="cm"><b>Managed files</b> '
              '<span class="faint">— config files the app manages for this instance.</span></div>')
        if not inst["files"]:
            ui.md('<div class="faint">No files are managed yet.</div>')
        for f in inst["files"]:
            fc = st.columns([2, 3, 1], vertical_alignment="center")
            fc[0].markdown(f'<div class="cm mono" style="font-weight:600">{ui.esc(f)}</div>',
                           unsafe_allow_html=True)
            path = fc[1].text_input(f"path {f}", value=inst.get("paths", {}).get(f, ""),
                                   key=f"path_{code}_{f}", label_visibility="collapsed",
                                   placeholder="path relative to location")
            if path != inst.get("paths", {}).get(f, ""):
                store.set_instance_file_path(code, f, path); st.rerun()
            if fc[2].button("Remove", key=f"rmf_{code}_{f}"):
                store.remove_instance_file(code, f, actor=me["windowsId"]); st.rerun()
        nc = st.columns([3, 1], vertical_alignment="center")
        nf = nc[0].text_input("Add file", key=f"addf_{code}", placeholder="filename.properties",
                             label_visibility="collapsed")
        if nc[1].button("Add file", disabled=not nf.strip()):
            try:
                store.add_instance_file(code, nf, actor=me["windowsId"]); st.rerun()
            except StoreError as e:
                ui.md(ui.banner("error", ui.esc(e.message)))

    # Danger zone
    if st.session_state.get(f"confirm_del_{code}"):
        ui.md(ui.banner("error", f"Delete instance <b>{ui.esc(code)}</b>? This removes its branch and history."))
        dc = st.columns([1, 1, 6])
        if dc[0].button("Delete instance", type="primary", key=f"yesdel_{code}"):
            store.delete_instance(code, actor=me["windowsId"])
            st.session_state[f"confirm_del_{code}"] = False
            ui.goto(p="admin")
        if dc[1].button("Keep", key=f"nodel_{code}"):
            st.session_state[f"confirm_del_{code}"] = False; st.rerun()
    else:
        if st.button("Delete instance", key=f"del_{code}"):
            st.session_state[f"confirm_del_{code}"] = True; st.rerun()


# ---------------------------------------------------------------------------
# List view
# ---------------------------------------------------------------------------

def _list_view(store: Store, me: dict) -> None:
    ui.page_header("Administration", "Instances",
                   "Add, edit, or remove instances and the config files managed for each. New instances "
                   "branch from an existing one, inheriting its files.")

    if st.button("Add instance", type="primary", key="btn_add_inst"):
        st.session_state["show_add_inst"] = not st.session_state.get("show_add_inst", False)
        st.rerun()

    instances = store.list_instances()
    if st.session_state.get("show_add_inst"):
        _add_instance_form(store, me, instances)

    sv = store.settings_view()
    cols = st.columns(2)
    with cols[0]:
        _service_account_panel(sv)
    with cols[1]:
        _vcs_panel(store, me, sv)

    rows = []
    for inst in instances:
        code = inst["code"]
        loc = inst.get("serverAddress") or "—"
        lt = inst.get("locationType", "server")
        files = f'{len(inst["files"])} file{"s" if len(inst["files"]) != 1 else ""}'
        rows.append(
            f'<tr class="rowlink">'
            f'<td style="width:110px"><a class="rowcell mono" style="font-weight:600" '
            f'href="{ui.href(p="admin", code=code)}">{code}</a></td>'
            f'<td style="width:150px">{ui.env_tag(inst)}</td>'
            f'<td style="width:90px" class="mono faint">{files}</td>'
            f'<td class="mono faint"><span class="tag plain">{ui.esc(lt)}</span> {ui.esc(loc)}</td>'
            f'<td class="tcenter" style="width:150px"><div class="act-row">'
            f'<a class="act" href="{ui.href(p="admin", code=code)}">Edit</a></div></td></tr>')
    ui.md('<div class="group-title"><h2>Registered instances</h2>'
          f'<span class="count-chip">{len(instances)}</span></div>')
    ui.md('<div class="panel"><table class="list"><thead><tr>'
          '<th>Instance</th><th>Environment</th><th>Files</th><th>Location</th>'
          '<th class="tcenter">Actions</th></tr></thead>'
          f'<tbody>{"".join(rows)}</tbody></table></div>')


def render(store: Store, me: dict) -> None:
    if not is_admin(me["roles"]):
        ui.empty("Admin only.")
        return
    code = st.query_params.get("code")
    if code:
        _edit_view(store, me, code)
    else:
        _list_view(store, me)
