"""People (`/people`) — admin-only user management. Dense list; edit on a sub-view."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError, is_admin, ROLES, ROLE_LABEL, role_summary

_LABEL_TO_ROLE = {v: k for k, v in ROLE_LABEL.items()}
_ROLE_LABELS = [ROLE_LABEL[r] for r in ROLES]


def _role_badges(roles: list[str]) -> str:
    if not roles:
        return '<span class="faint">pending</span>'
    return " ".join(f'<span class="tag plain">{ui.esc(ROLE_LABEL[r])}</span>'
                    for r in ROLES if r in roles)


# ---------------------------------------------------------------------------
# Edit sub-view
# ---------------------------------------------------------------------------

def _edit_view(store: Store, me: dict, wid: str) -> None:
    user = next((u for u in store.list_users() if u["windowsId"] == wid), None)
    back = f'<a href="{ui.href(p="people")}">‹ People</a> · Edit'
    if not user:
        ui.page_header(back, wid, "")
        ui.empty("User not found.")
        return
    is_self = wid == me["windowsId"]
    ui.page_header(back, wid, "Edit this person's details and roles.", title_mono=True)

    with st.container(border=True):
        c = st.columns(2)
        name = c[0].text_input("Name", value=user["displayName"], key=f"u_name_{wid}")
        email = c[1].text_input("Email", value=user["email"], key=f"u_email_{wid}")
        cur = [ROLE_LABEL[r] for r in ROLES if r in user["roles"]]
        picked = st.multiselect("Roles", _ROLE_LABELS, default=cur, key=f"u_roles_{wid}",
                               disabled=is_self,
                               help="You cannot change your own roles." if is_self else None)
        new_roles = [_LABEL_TO_ROLE[l] for l in picked]

        if st.button("Save", type="primary", key=f"u_save_{wid}"):
            patch = {"displayName": name, "email": email}
            if not is_self:
                patch["roles"] = new_roles
            store.update_user(wid, patch, actor=me["windowsId"])
            ui.goto(p="people")
        if is_self:
            ui.md('<div class="faint" style="font-size:12px">This is your own account; you cannot '
                  'change your roles or remove yourself.</div>')

    if not is_self:
        if st.session_state.get(f"confirm_del_{wid}"):
            ui.md(ui.banner("error", f"Remove <b>{ui.esc(wid)}</b> from the directory?"))
            dc = st.columns([1, 1, 6])
            if dc[0].button("Remove person", type="primary", key=f"yesdel_{wid}"):
                store.remove_user(wid, actor=me["windowsId"])
                st.session_state[f"confirm_del_{wid}"] = False
                ui.goto(p="people")
            if dc[1].button("Keep", key=f"nodel_{wid}"):
                st.session_state[f"confirm_del_{wid}"] = False; st.rerun()
        else:
            if st.button("Remove person", key=f"del_{wid}"):
                st.session_state[f"confirm_del_{wid}"] = True; st.rerun()


# ---------------------------------------------------------------------------
# List view
# ---------------------------------------------------------------------------

def _list_view(store: Store, me: dict) -> None:
    ui.page_header("Administration", "People",
                   "Add team members by Windows ID and assign one or more roles. Quant (editor) creates "
                   "and reviews changes; Stakeholder approves or rejects requests. A \"boss\" is simply "
                   "someone who is both. No roles means the account is pending.")

    settings = store.settings_view()
    with st.container(border=True):
        ui.md('<div class="cm"><b>Quant distribution email</b> '
              '<span class="faint">— CC\'d on every approval-request email.</span></div>')
        scols = st.columns([3, 1], vertical_alignment="bottom")
        email = scols[0].text_input("Quant distribution email", value=settings["quantDistributionEmail"],
                                    placeholder="quant-team@firm.com", label_visibility="collapsed")
        if scols[1].button("Save settings", disabled=email == settings["quantDistributionEmail"]):
            store.update_settings({"quantDistributionEmail": email})
            st.rerun()

    with st.container(border=True):
        ui.md('<div class="cm"><b>Add person</b></div>')
        acols = st.columns(3)
        wid = acols[0].text_input("Windows ID", key="ap_wid", placeholder="salavat")
        name = acols[1].text_input("Name", key="ap_name", placeholder="Salavat Example")
        pemail = acols[2].text_input("Email", key="ap_email", placeholder="salavat@firm.com")
        rcols = st.columns(3)
        picked = rcols[0].multiselect("Roles", _ROLE_LABELS, default=["Quant"], key="ap_roles")
        valid = bool(wid.strip() and name.strip() and pemail.strip())
        if st.button("Add person", type="primary", disabled=not valid):
            try:
                store.create_user(wid, name, pemail,
                                  [_LABEL_TO_ROLE[l] for l in picked], actor=me["windowsId"])
                for k in ("ap_wid", "ap_name", "ap_email"):
                    st.session_state.pop(k, None)
                st.rerun()
            except StoreError as e:
                ui.md(ui.banner("error", ui.esc(e.message)))

    users = store.list_users()
    ui.md('<div class="group-title"><h2>People</h2>'
          f'<span class="count-chip">{len(users)}</span></div>')
    rows = []
    for u in users:
        you = ' <span class="faint">(you)</span>' if u["windowsId"] == me["windowsId"] else ""
        rows.append(
            f'<tr class="rowlink">'
            f'<td style="width:160px"><a class="rowcell mono" style="font-weight:600" '
            f'href="{ui.href(p="people", user=u["windowsId"])}">{ui.esc(u["windowsId"])}</a>{you}</td>'
            f'<td style="width:170px">{ui.esc(u["displayName"])}</td>'
            f'<td class="faint">{ui.esc(u["email"] or "—")}</td>'
            f'<td style="width:280px">{_role_badges(u["roles"])}</td>'
            f'<td class="tcenter" style="width:90px"><div class="act-row">'
            f'<a class="act" href="{ui.href(p="people", user=u["windowsId"])}">Edit</a></div></td></tr>')
    ui.md('<div class="panel"><table class="list"><thead><tr>'
          '<th>Windows ID</th><th>Name</th><th>Email</th><th>Roles</th>'
          '<th class="tcenter">Actions</th></tr></thead>'
          f'<tbody>{"".join(rows)}</tbody></table></div>')


def render(store: Store, me: dict) -> None:
    if not is_admin(me["roles"]):
        ui.empty("Admin only.")
        return
    wid = st.query_params.get("user")
    if wid:
        _edit_view(store, me, wid)
    else:
        _list_view(store, me)
