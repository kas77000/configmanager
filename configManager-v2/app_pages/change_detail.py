"""Change detail (`/changes/:id`) — approval bar, items, Jira, editor+gate, merge."""
from __future__ import annotations

import streamlit as st

from . import ui
from core.store import Store, StoreError, can_edit, can_approve, is_admin, MANAGED_FILE
from core.rules import analyze_text, severity_counts, parse_file

FIXMSG = MANAGED_FILE
_MERGE_MSG = {
    "warnings-need-acknowledgement": "Acknowledge the warnings to proceed.",
    "only an admin can override errors": "Only an admin can override errors.",
    "overrideReason required to override errors": "A reason is required to override.",
}


# ---------------------------------------------------------------------------
# Approval bar
# ---------------------------------------------------------------------------

def _approval_bar(store: Store, me: dict, change: dict) -> None:
    roles = me["roles"]
    editor, approver, admin = can_edit(roles), can_approve(roles), is_admin(roles)
    status = change["status"]
    cid = change["id"]

    left = [ui.status_badge(status)]
    for j in change.get("jiraTickets", []):
        left.append(f'<a class="jira-pill" href="{ui.esc(j["url"])}" target="_blank" '
                    f'title="{ui.esc(j["file"])}">{ui.esc(j["key"])}</a>')
    if status == "submitted" and change.get("submittedBy"):
        left.append(f'<span class="faint">submitted by {ui.esc(change["submittedBy"])}</span>')
    if change.get("decision"):
        d = change["decision"]
        reason = f' · "{ui.esc(d["reason"])}"' if d.get("reason") else ""
        left.append(f'<span class="faint">{ui.esc(d["action"])} by {ui.esc(d["by"])} · '
                    f'{ui.rel_time(d["at"])}{reason}</span>')

    with st.container(border=True):
        ui.md('<div class="rowflex" style="flex-wrap:wrap">' + " ".join(left) + "</div>")
        merged_any = status == "merged" or any(t.get("mergedCommit") for t in change["targets"])
        btns = st.columns(6)
        i = 0
        if editor and status in ("draft", "rejected"):
            if btns[i].button("Submit for approval", type="primary", key="submit_ch"):
                try:
                    store.submit_change(cid, me["windowsId"]); st.rerun()
                except StoreError as e:
                    st.session_state["ch_err"] = e.message
            i += 1
        if editor and status not in ("cancelled", "rejected") and not merged_any:
            if st.session_state.get("confirm_cancel"):
                if btns[i].button("Confirm cancel", key="cc_yes"):
                    try:
                        store.cancel_change(cid, me["windowsId"])
                    except StoreError as e:
                        st.session_state["ch_err"] = e.message
                    st.session_state["confirm_cancel"] = False; st.rerun()
                i += 1
                if btns[i].button("Keep", key="cc_no"):
                    st.session_state["confirm_cancel"] = False; st.rerun()
                i += 1
            else:
                if btns[i].button("Cancel change", key="cancel_ch"):
                    st.session_state["confirm_cancel"] = True; st.rerun()
                i += 1
        if approver and status == "submitted":
            if btns[i].button("Approve", key="approve_ch", type="primary"):
                store.approve_change(cid, me["windowsId"]); st.rerun()
            i += 1
            if btns[i].button("Reject", key="reject_ch"):
                st.session_state["show_reject_ch"] = not st.session_state.get("show_reject_ch"); st.rerun()
            i += 1

        # Emails
        if editor and status == "submitted":
            eml, name = store.build_email(cid, "approval", me)
            st.download_button("Approval email…", data=eml, file_name=name, mime="message/rfc822",
                              key="dl_approval")
        if editor and status == "merged":
            eml, name = store.build_email(cid, "recap", me)
            st.download_button("Recap email…", data=eml, file_name=name, mime="message/rfc822",
                              key="dl_recap")

        if st.session_state.get("show_reject_ch") and approver and status == "submitted":
            reason = st.text_input("Reason (optional)", key="reject_reason_ch",
                                  placeholder="Reason (optional)", label_visibility="collapsed")
            if st.button("Confirm reject", key="confirm_reject_ch"):
                store.reject_change(cid, me["windowsId"], reason)
                st.session_state["show_reject_ch"] = False; st.rerun()

        if st.session_state.get("ch_err"):
            ui.md(ui.banner("error", ui.esc(st.session_state.pop("ch_err"))))


# ---------------------------------------------------------------------------
# Jira panel
# ---------------------------------------------------------------------------

def _jira_panel(store: Store, me: dict, change: dict) -> None:
    ui.md('<div class="panel-head" style="border:1px solid var(--border);border-radius:6px 6px 0 0">'
          '<b>JIRA tickets</b></div>')
    with st.container(border=True):
        ui.md('<div class="faint">Create one Jira ticket per modification in Jira, then paste each '
              'ticket link below.</div>')
        existing = {j["item"]: j for j in change.get("jiraTickets", [])}
        tickets = []
        for idx, it in enumerate(change["items"]):
            ui.md(f'<div class="insp-label">Modification {idx + 1} · '
                  f'<span class="mono">{ui.esc(", ".join(it["instances"]))}</span></div>'
                  f'<div class="cm"><span class="mono" style="font-weight:600">{ui.esc(it["file"])}</span> '
                  f'<span class="faint">{ui.esc(it["description"])}</span></div>')
            saved = existing.get(idx, {}).get("url", "")
            url = st.text_input(f"Ticket link {idx}", value=saved, key=f"jira_{change['id']}_{idx}",
                               placeholder="https://your-jira/browse/BSGPTALGO-1234",
                               label_visibility="collapsed")
            if url.strip():
                tickets.append({"item": idx, "url": url.strip()})
            if existing.get(idx):
                ui.md(f'<div class="faint">saved as <a class="jira-pill" '
                      f'href="{ui.esc(existing[idx]["url"])}" target="_blank">{ui.esc(existing[idx]["key"])}</a></div>')
        if st.button("Save Jira links", type="primary", key="save_jira"):
            store.set_jira(change["id"], tickets, me["windowsId"])
            st.rerun()


# ---------------------------------------------------------------------------
# Warnings rail + inspector
# ---------------------------------------------------------------------------

def _warnings_rail(findings: list) -> None:
    if not findings:
        ui.md('<div class="empty"><div style="color:var(--success);font-size:18px">✓</div>'
              'No findings. This version is clean.</div>')
        return
    rows = []
    for f in findings:
        rel = f' · related {", ".join(str(x) for x in (f.related_line_numbers or []))}' \
            if f.related_line_numbers else ""
        rows.append(
            f'<div class="finding {f.severity}"><span class="badge {f.severity}">'
            f'{ui.finding_glyph(f.severity)}</span><div><div class="fmsg">{ui.esc(f.message)}</div>'
            f'<div class="floc">line {f.line_number}{rel} · {f.code}</div></div></div>')
    ui.md('<div class="panel">' + "".join(rows) + "</div>")


# ---------------------------------------------------------------------------
# Merge panel
# ---------------------------------------------------------------------------

def _merge_panel(store: Store, me: dict, change: dict, target: dict, any_dirty: bool) -> None:
    code = target["instance"]
    admin = is_admin(me["roles"])
    if target.get("mergedCommit"):
        ui.md(ui.banner("info", f"Merged into <b>{ui.esc(code)}</b>. This instance's canonical "
                              f"version now includes the change."))
        return

    gate = store.change_analysis(change["id"], code, FIXMSG)
    e, w = gate["errorCount"], gate["warningCount"]
    with st.container(border=True):
        ui.md(f'<div class="rowflex"><b>Merge into {ui.esc(code)}</b>'
              f'<span class="spacer"></span>{ui.gate_summary(e, w, gate["infoCount"])}</div>')

        approved = change["status"] == "approved"
        if not approved:
            ui.md('<div class="faint">This change must be approved before it can be merged.</div>')
        elif any_dirty:
            ui.md('<div class="faint">Save all edited files before merging.</div>')

        ack = False
        override = False
        reason = ""
        if w > 0 and e == 0:
            ack = st.checkbox(f"I have reviewed the {w} warning(s) and want to proceed.",
                             key=f"ack_{change['id']}_{code}")
        if e > 0:
            note = " As an admin you may override with a recorded reason." if admin else " Only an admin can override."
            ui.md(ui.banner("error", f"This version has {e} blocking error(s).{note}"))
            if admin:
                override = st.checkbox("Override the merge gate", key=f"ovr_{change['id']}_{code}")
                if override:
                    reason = st.text_input("Override reason", key=f"ovrr_{change['id']}_{code}",
                                          placeholder="e.g. accepted risk, tracked in JIRA-1234")

        disabled = (not approved) or any_dirty or (w > 0 and not ack) or \
                   (e > 0 and not (admin and override and reason.strip()))
        if st.button(f"Merge into {code}", type="primary", disabled=disabled,
                    key=f"merge_{change['id']}_{code}"):
            try:
                store.merge_change(change["id"], code, me, acknowledge_warnings=ack,
                                   override=override, override_reason=reason)
                st.rerun()
            except StoreError as ex:
                if ex.code == "merge-conflict":
                    ui.md(ui.banner("warning", f"Merge conflict in {', '.join(ex.extra.get('conflicts', []))}. "
                                             f"Update this branch from the instance version and re-resolve."))
                else:
                    ui.md(ui.banner("error", ui.esc(_MERGE_MSG.get(ex.code, ex.message))))


# ---------------------------------------------------------------------------
# Instance workspace
# ---------------------------------------------------------------------------

def _workspace(store: Store, me: dict, change: dict, target: dict) -> None:
    code = target["instance"]
    files = target["files"]
    merged = bool(target.get("mergedCommit"))
    editor = can_edit(me["roles"])

    # file selector
    if len(files) > 1:
        active_file = st.segmented_control("File", files, default=files[0],
                                          key=f"file_{change['id']}_{code}") or files[0]
    else:
        active_file = files[0]

    committed = store.change_read_file(change["id"], code, active_file)["content"]
    ed_key = f"ed_{change['id']}_{code}_{active_file}"

    left, right = st.columns([2, 1])
    with left:
        content = st.text_area("Config", value=committed, key=ed_key, height=440,
                              disabled=merged, label_visibility="collapsed")
        dirty = content != committed
        tools = st.columns([3, 1, 1])
        msg = tools[0].text_input("Commit message", key=f"msg_{ed_key}",
                                 placeholder="commit message", label_visibility="collapsed")
        if tools[1].button("Save", type="primary", disabled=(not dirty) or merged or not editor,
                          key=f"save_{ed_key}"):
            try:
                author = {"name": me["displayName"], "email": me["email"] or f"{me['windowsId']}@local"}
                store.change_put_file(change["id"], code, active_file, content,
                                     msg or f"edit {active_file}", author)
                st.rerun()
            except StoreError as ex:
                ui.md(ui.banner("error", ui.esc(ex.message)))
        show_diff = tools[2].toggle("Diff", value=True, key=f"diff_{ed_key}")

    with right:
        if active_file == FIXMSG:
            findings = analyze_text(content)
            counts = severity_counts(findings)
            ui.md(f'<div class="insp-label">Warnings '
                  f'<span class="count-chip">{len(findings)}</span></div>')
            _warnings_rail(findings)
        else:
            ui.md('<div class="faint">Shadow-analysis applies to ai.fixmsg.properties. This file is '
                  'versioned and diffed without rule checks.</div>')

    # dirty across all files of this target
    any_dirty = False
    for f in files:
        c = store.change_read_file(change["id"], code, f)["content"]
        k = f"ed_{change['id']}_{code}_{f}"
        if k in st.session_state and st.session_state[k] != c:
            any_dirty = True

    if show_diff:
        diff = store.change_diff(change["id"], code, active_file)["diff"]
        ui.md(f'<div class="panel"><div class="panel-head">'
              f'<span class="mono" style="font-weight:600">Changes to {ui.esc(active_file)}</span>'
              f'<span class="faint">{ui.esc(code)} · compared to the current instance config</span></div>'
              f'{ui.render_diff(diff)}</div>')

    _merge_panel(store, me, change, target, any_dirty)


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def render(store: Store, me: dict, change_id: str) -> None:
    change = store.get_change(change_id) if change_id else None
    if not change:
        ui.page_header(f'<a href="{ui.href(p="changes")}">‹ Changes</a>', change_id or "?", "")
        ui.empty("Change not found.")
        return

    eff = f' · effective {change["effectiveDate"]}' if change.get("effectiveDate") else ""
    ui.page_header(f'<a href="{ui.href(p="changes")}">‹ Changes</a> · Change {change_id}',
                   change["description"],
                   f'Opened by {change["createdBy"]} · {len(change["targets"])} instance(s){eff}')

    _approval_bar(store, me, change)

    # Items table
    rows = "".join(
        f'<tr><td>{ui.esc(it["description"])}</td>'
        f'<td class="mono">{ui.esc(it["file"])}</td>'
        f'<td class="mono faint">{ui.esc(", ".join(it["instances"]))}</td></tr>'
        for it in change["items"])
    ui.md('<div class="panel"><table class="list"><thead><tr><th>Description</th>'
          '<th style="width:220px">Config file</th><th style="width:240px">Applies to instances</th>'
          f'</tr></thead><tbody>{rows}</tbody></table></div>')

    can_see = can_edit(me["roles"])
    if can_see and change["status"] in ("approved", "merged"):
        _jira_panel(store, me, change)

    if not can_see:
        ui.md('<div class="panel"><div class="empty">You can review and decide on this request, but '
              'the config editing is handled by the quant team.</div></div>')
        return

    # Instance tabs
    codes = [t["instance"] for t in change["targets"]]
    labels = [f"{t['instance']} ✓" if t.get("mergedCommit") else t["instance"] for t in change["targets"]]
    picked = st.segmented_control("Instance", labels, default=labels[0], key=f"inst_tab_{change_id}") or labels[0]
    active_code = codes[labels.index(picked)]
    target = next(t for t in change["targets"] if t["instance"] == active_code)
    _workspace(store, me, change, target)
