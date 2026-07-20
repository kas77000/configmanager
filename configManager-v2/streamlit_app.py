"""Configuration Manager v2 — a Streamlit port of the React/Express app.

A GitHub-like manager for algo-trading FIX configuration files: per-instance
versioning, an edit -> approve -> Jira -> merge workflow with a rule-based merge
gate, drift sync, Outlook email drafts, and a full audit trail.

Run:  streamlit run streamlit_app.py
"""
from __future__ import annotations

import os
from pathlib import Path

import streamlit as st

from app_pages import ui
from app_pages import (
    instances as p_instances,
    instance_detail as p_instance_detail,
    changes as p_changes,
    change_detail as p_change_detail,
    requests as p_requests,
    history as p_history,
    commit as p_commit,
    people as p_people,
    admin as p_admin,
)
from core.store import Store, can_edit, can_approve, is_admin, role_summary

BASE_DIR = Path(__file__).resolve().parent

st.set_page_config(page_title="Config Manager", page_icon="▦", layout="wide",
                   initial_sidebar_state="expanded")


@st.cache_resource
def get_store() -> Store:
    data_dir = Path(os.environ.get("CM_DATA_DIR", BASE_DIR / "data"))
    return Store(
        data_dir=data_dir,
        seed_file=BASE_DIR / "seed" / "ai.fixmsg.properties",
        app_base_url=os.environ.get("APP_BASE_URL", "http://localhost:8501"),
        service_account_user=os.environ.get("SERVICE_ACCOUNT_USER", ""),
        service_account_password=os.environ.get("SERVICE_ACCOUNT_PASSWORD", ""),
    )


# ---------------------------------------------------------------------------
# Sidebar (brand + role-gated nav + dev-user switcher + theme toggle)
# ---------------------------------------------------------------------------

_NAV = [
    ("instances", "Instances", "edit"),
    ("changes", "Changes", "edit"),
    ("requests", "Requests", "approve"),
    ("history", "History", "edit"),
    ("people", "People", "admin"),
    ("admin", "Instances admin", "admin"),
]


def render_sidebar(store: Store, me: dict, active: str) -> None:
    with st.sidebar:
        roles = me["roles"]
        gate = {"edit": can_edit(roles), "approve": can_approve(roles), "admin": is_admin(roles)}

        st.html('<div class="cm"><div class="cm-brand"><span class="brand-dot"></span>'
                'Config Manager</div></div>')

        # Highlight the active nav item (extra selector weight so it wins the cascade).
        st.markdown(
            f'<style>[data-testid="stSidebar"] .st-key-nav_{active} button'
            '{background:var(--sel)!important;color:var(--text)!important}</style>',
            unsafe_allow_html=True)

        # In-session navigation (st.rerun, not a full page reload) = smooth.
        for key, label, need in _NAV:
            if not gate[need]:
                continue
            if st.button(label, key=f"nav_{key}", use_container_width=True):
                ui.goto(p=key)

        st.html('<div class="cm"><hr class="cm-hr"></div>')

        # Theme toggle (persisted in the URL so it survives navigation)
        theme = st.session_state.get("theme", "dark")
        label = "Light theme" if theme == "dark" else "Dark theme"
        if st.button(label, key="theme_toggle", use_container_width=True):
            st.query_params["t"] = "light" if theme == "dark" else "dark"
            st.rerun()

        # Dev-user switcher (mirrors x-remote-user override)
        dev = st.text_input("Signed in as (dev)", value=st.session_state.get("dev_user", "admin"),
                            key="dev_user_input")
        if dev != st.session_state.get("dev_user", "admin"):
            st.query_params["u"] = dev
            st.rerun()

        st.html(f'<div class="cm"><div class="faint" style="font-size:11px">Role: '
                f'{role_summary(roles)}</div></div>')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    store = get_store()
    # Theme + dev identity live in the URL (each nav is a fresh session).
    theme = st.query_params.get("t", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    st.session_state["theme"] = theme
    dev = st.query_params.get("u", "admin")
    st.session_state["dev_user"] = dev
    ui.inject_css(theme)

    me = store.ensure_user(dev or "admin")
    r = ui.route()
    page = r["p"]

    # Keep the parent nav item highlighted on detail sub-pages.
    parent = {"instance": "instances", "change": "changes", "commit": "history"}
    render_sidebar(store, me, parent.get(page, page))

    roles = me["roles"]
    editor, approver, admin = can_edit(roles), can_approve(roles), is_admin(roles)

    # Landing / role fallback
    if page == "instances":
        if editor:
            p_instances.render(store, me)
        elif approver:
            ui.goto(p="requests")
        else:
            ui.md('<div class="panel"><div class="empty">Your account is pending role assignment.</div></div>')
        return

    dispatch = {
        "instance": lambda: p_instance_detail.render(store, me, r["code"]),
        "changes": lambda: p_changes.render(store, me),
        "change": lambda: p_change_detail.render(store, me, r["id"]),
        "requests": lambda: p_requests.render(store, me),
        "history": lambda: p_history.render(store, me),
        "commit": lambda: p_commit.render(store, me, r["hash"]),
        "people": lambda: p_people.render(store, me),
        "admin": lambda: p_admin.render(store, me),
    }
    handler = dispatch.get(page)
    if handler:
        handler()
    else:
        ui.md('<div class="panel"><div class="empty">Page not found.</div></div>')


main()
