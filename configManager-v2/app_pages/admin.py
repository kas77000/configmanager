"""Instances admin (`/admin`) — dense list; per-instance editing on a sub-view."""
from __future__ import annotations

import json

import streamlit as st

from . import ui
from core.store import Store, StoreError, is_admin

_BACKEND_LABEL = {"builtin": "Built-in (dependency-free)", "git": "Official git"}
_BACKEND_DESC = {
    "builtin": "Version history stored as JSON in data/. No external tools; runs anywhere.",
    "git": "Version history in a real .git repo (data/config-repo). Inspectable with git tooling.",
}
_RESET_LABEL = {"history": "Config history + changes", "all": "Everything (factory reset)"}
_RESET_WARN = {
    "history": "Resets the config version history and <b>every change</b> (drafts, submitted, "
               "merged). Users, the instances registry, settings, and the audit log are kept.",
    "all": "Factory reset — also clears <b>users, instances, settings, and the audit log</b>. "
           "The next visitor becomes admin, the backend returns to built-in, and the service "
           "account is cleared.",
}


# ---------------------------------------------------------------------------
# Panels
# ---------------------------------------------------------------------------

def _service_account_panel(store: Store, sv: dict) -> None:
    badge = ui.badge("success", "configured", glyph="✓") if sv["serviceAccountConfigured"] \
        else ui.badge("warning", "not configured")
    with st.container(border=True):
        ui.md(f'<div class="cm"><div class="rowflex" style="margin-bottom:2px"><b>Service account</b> '
              f'{badge}</div><div class="faint" style="font-size:11px">Used only to reach server-type '
              'instances. Shared drives need no credentials. The password is stored locally and never '
              'shown again.</div></div>')
        user = st.text_input("Username", value=sv["serviceAccountUser"], key="sa_user",
                            placeholder="DOMAIN\\svc-config")
        pwd = st.text_input("Password", value="", type="password", key="sa_pwd",
                           placeholder="•••••••• (leave blank to keep current)")
        bc = st.columns([1, 1, 4])
        if bc[0].button("Save", type="primary", key="sa_save"):
            store.update_service_account(user=user, password=pwd or None)
            st.rerun()
        if sv["serviceAccountConfigured"] and bc[1].button("Clear password", key="sa_clear"):
            store.clear_service_account_password()
            st.rerun()


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


def _import_export_panel(store: Store, me: dict) -> None:
    with st.container(border=True):
        ui.md('<div class="cm"><b>Import / export</b> <span class="faint">— move the instance '
              "registry (settings, files, and paths — not the config contents) between "
              "environments, or keep a backup.</span></div>")

        # Show the outcome of the last import (created / already-exists / errors), once.
        res = st.session_state.pop("inst_import_result", None)
        if res:
            if res.get("error"):
                ui.md(ui.banner("error", ui.esc(res["error"])))
            if res.get("created"):
                ui.md(ui.banner("success", "Imported: <b>" + ui.esc(", ".join(res["created"])) + "</b>."))
            if res.get("skipped"):
                ui.md(ui.banner("warning", "Already exist, so skipped (an instance with that name "
                                "is already registered): <b>" + ui.esc(", ".join(res["skipped"])) + "</b>."))
            if res.get("errors"):
                ui.md(ui.banner("error", "Could not import: " + ui.esc("; ".join(res["errors"]))))

        # Export: full-width buttons stacked, then the uploader gets the whole panel
        # width (a narrow half-column makes Streamlit's dropzone text overlap).
        ec = st.columns(2)
        if ec[0].button("Prepare export", key="inst_exp_prep", use_container_width=True):
            st.session_state["inst_export_json"] = json.dumps(store.export_instances(), indent=2)
            st.rerun()
        if st.session_state.get("inst_export_json"):
            ec[1].download_button("Download instances.json", key="inst_exp_dl",
                                  data=st.session_state["inst_export_json"], file_name="instances.json",
                                  mime="application/json", use_container_width=True)

        up = st.file_uploader("Import a JSON export", type=["json"], key="inst_imp_up")
        if st.button("Import", type="primary", disabled=up is None,
                     key="inst_imp_go", use_container_width=True):
            try:
                payload = json.loads(up.getvalue().decode("utf-8"))
                st.session_state["inst_import_result"] = store.import_instances(
                    payload, actor=me["windowsId"])
            except json.JSONDecodeError:
                st.session_state["inst_import_result"] = {"error": "That file is not valid JSON."}
            except StoreError as e:
                st.session_state["inst_import_result"] = {"error": e.message}
            st.rerun()


def _reset_panel(store: Store, me: dict) -> None:
    with st.container(border=True):
        ui.md('<div class="cm"><div class="rowflex" style="margin-bottom:2px"><b>Reset data</b> '
              f'{ui.badge("warning", "destructive")}</div><div class="faint" style="font-size:11px">'
              'Wipes app data and re-seeds from the seed config. Takes effect immediately — no '
              'restart needed. (The <span class="mono">python reset.py</span> CLI does the same '
              'when the app is stopped.)</div></div>')
        scope = st.selectbox("Scope", ["history", "all"],
                            format_func=lambda s: _RESET_LABEL[s], key="reset_scope")
        ui.md(ui.banner("warning", _RESET_WARN[scope]))
        confirm = st.text_input("Type RESET to confirm", key="reset_confirm", placeholder="RESET")
        if st.button("Reset now", type="primary",
                    disabled=confirm.strip().upper() != "RESET", key="reset_go"):
            try:
                store.reset_data(scope, actor=me["windowsId"])
                st.session_state.pop("reset_confirm", None)
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
        with st.container(horizontal=True):
            do_create = st.button("Create", type="primary", disabled=not code.strip(), key="create_ai")
            do_cancel = st.button("Cancel", key="cancel_ai")
        if do_create:
            try:
                store.create_instance(code.strip().upper(), env, uat, copy_from, actor=me["windowsId"])
                st.session_state["show_add_inst"] = False
                st.rerun()
            except StoreError as e:
                ui.md(ui.banner("error", ui.esc(e.message)))
        if do_cancel:
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
        _service_account_panel(store, sv)
        _reset_panel(store, me)
    with cols[1]:
        _vcs_panel(store, me, sv)
        _import_export_panel(store, me)

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
