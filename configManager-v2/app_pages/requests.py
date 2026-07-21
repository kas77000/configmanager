"""Requests (`/requests`) — the approver's decision queue."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError, can_approve


def _request_card(store: Store, me: dict, c: dict, decide: bool) -> None:
    with st.container(border=True):
        head = st.columns([5, 3], vertical_alignment="center")
        eff = f' · effective {c["effectiveDate"]}' if c.get("effectiveDate") else ""
        head[0].markdown(
            f'<div class="cm"><span style="font-size:15px;font-weight:600">{ui.esc(c["description"])}</span> '
            f'{ui.status_badge(c["status"])} <span class="faint">{eff}</span></div>',
            unsafe_allow_html=True)
        if decide:
            with head[1]:
                with st.container(horizontal=True, horizontal_alignment="right"):
                    if st.button("Approve", key=f"appr_{c['id']}", type="primary"):
                        try:
                            store.approve_change(c["id"], me["windowsId"])
                            st.rerun()
                        except StoreError as e:
                            st.session_state[f"req_err_{c['id']}"] = e.message
                    if st.button("Reject", key=f"rej_{c['id']}"):
                        st.session_state[f"show_reject_{c['id']}"] = not st.session_state.get(f"show_reject_{c['id']}")
                        st.rerun()

        rows = "".join(
            f'<tr><td class="mono" style="font-weight:600;width:38%">{ui.esc(it["file"])}</td>'
            f'<td>{ui.esc(it["description"])}</td></tr>' for it in c["items"])
        ui.md(f'<table class="list" style="margin-top:8px"><thead><tr><th>File</th>'
              f'<th>Description</th></tr></thead><tbody>{rows}</tbody></table>')

        if st.session_state.get(f"show_reject_{c['id']}") and decide:
            ui.md(ui.banner("warning", "Rejecting sends the request back to the quant team."))
            reason = st.text_input("Reason (optional)", key=f"reason_{c['id']}",
                                  placeholder="Reason (optional)", label_visibility="collapsed")
            rc = st.columns([1, 1, 6])
            if rc[0].button("Confirm reject", key=f"crej_{c['id']}"):
                store.reject_change(c["id"], me["windowsId"], reason)
                st.session_state[f"show_reject_{c['id']}"] = False
                st.rerun()
            if rc[1].button("Cancel", key=f"cnrej_{c['id']}"):
                st.session_state[f"show_reject_{c['id']}"] = False
                st.rerun()
        if st.session_state.get(f"req_err_{c['id']}"):
            ui.md(ui.banner("error", ui.esc(st.session_state.pop(f"req_err_{c['id']}"))))


def render(store: Store, me: dict) -> None:
    decide = can_approve(me["roles"])
    ui.page_header("Approvals", "Requests",
                   "Change requests awaiting a decision. Each shows the change, the files it modifies, "
                   "and a short description. You approve or reject the request; the quant team handles "
                   "the config itself.")

    changes = store.list_changes()
    pending = [c for c in changes if c["status"] == "submitted"]
    decided = [c for c in changes if c["status"] not in ("submitted", "draft")]

    ui.md(f'<div class="group-title"><h2>Awaiting decision</h2>'
          f'<span class="count-chip">{len(pending)}</span></div>')
    if not pending:
        ui.empty("Nothing awaiting a decision.")
    else:
        for c in pending:
            _request_card(store, me, c, decide)

    if decided:
        ui.md(f'<div class="group-title"><h2>Decided</h2>'
              f'<span class="count-chip">{len(decided)}</span></div>')
        rows = []
        for c in reversed(decided):
            insts = ", ".join(t["instance"] for t in c["targets"])
            if c["status"] == "merged":
                dec = "applied"
            elif c.get("decision"):
                dec = f'{c["decision"]["by"]} · {ui.rel_time(c["decision"]["at"])}'
            else:
                dec = ""
            rows.append(
                f'<tr><td class="mono" style="font-weight:600">{c["id"]}</td>'
                f'<td>{ui.esc(c["description"])}</td>'
                f'<td class="mono faint">{ui.esc(insts)}</td>'
                f'<td>{ui.status_badge(c["status"])}</td>'
                f'<td class="faint">{ui.esc(dec)}</td></tr>')
        ui.md('<div class="panel"><table class="list"><thead><tr>'
              '<th style="width:70px">ID</th><th>Description</th><th style="width:160px">Instances</th>'
              '<th style="width:90px">Status</th><th style="width:160px">Decision</th>'
              f'</tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
