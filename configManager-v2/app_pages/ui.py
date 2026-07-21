"""Shared UI: the design-token CSS (OKLCH, ported from styles.css), plus render
helpers (badges, tags, tables, diffs, query-param routing) used by every page."""
from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import streamlit as st

from . import icons

# Nav icons keyed by page (rendered as masked ::before on the sidebar buttons).
NAV_ICONS = {
    "instances": icons.SERVER, "changes": icons.BRANCH, "requests": icons.INBOX,
    "history": icons.HISTORY, "people": icons.USERS, "admin": icons.SETTINGS,
}

# ---------------------------------------------------------------------------
# Design tokens (verbatim OKLCH from DESIGN.md / styles.css)
# ---------------------------------------------------------------------------

_DARK = """
  --bg: oklch(0.19 0.008 260);
  --surface: oklch(0.23 0.010 260);
  --raised: oklch(0.27 0.012 260);
  --border: oklch(0.33 0.012 260);
  --border-strong: oklch(0.42 0.014 260);
  --text: oklch(0.94 0.006 260);
  --muted: oklch(0.70 0.010 260);
  --faint: oklch(0.56 0.010 260);
  --accent: oklch(0.68 0.13 265);
  --accent-hover: oklch(0.73 0.14 265);
  --accent-fg: oklch(0.16 0.01 265);
  --error: oklch(0.66 0.19 25);
  --warning: oklch(0.78 0.14 78);
  --success: oklch(0.72 0.14 152);
  --info: oklch(0.70 0.11 240);
  --uat: oklch(0.66 0.16 300);
  --sel: oklch(0.68 0.13 265 / 0.14);
"""

_LIGHT = """
  --bg: oklch(0.975 0.004 260);
  --surface: oklch(0.995 0.003 260);
  --raised: oklch(0.985 0.004 260);
  --border: oklch(0.90 0.006 260);
  --border-strong: oklch(0.82 0.008 260);
  --text: oklch(0.24 0.010 260);
  --muted: oklch(0.47 0.012 260);
  --faint: oklch(0.60 0.012 260);
  --accent: oklch(0.52 0.16 265);
  --accent-hover: oklch(0.47 0.17 265);
  --accent-fg: oklch(0.99 0.005 265);
  --error: oklch(0.55 0.20 25);
  --warning: oklch(0.62 0.15 70);
  --success: oklch(0.53 0.15 152);
  --info: oklch(0.52 0.14 240);
  --uat: oklch(0.52 0.18 300);
  --sel: oklch(0.52 0.16 265 / 0.10);
"""

_COMPONENT_CSS = """
:root {
  --radius: 6px;
  --radius-sm: 4px;
  --font-sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* ---- Streamlit chrome trimming ---- */
#MainMenu, header [data-testid="stToolbar"], footer, [data-testid="stStatusWidget"] { visibility: hidden; }
[data-testid="stHeader"] { background: transparent; }
/* keep the sidebar collapse/expand toggle usable both ways, and on-brand */
[data-testid="stExpandSidebarButton"], [data-testid="stExpandSidebarButton"] *,
[data-testid="stSidebarCollapseButton"], [data-testid="stSidebarCollapseButton"] * { visibility: visible !important; }
[data-testid="stExpandSidebarButton"] button, [data-testid="stSidebarCollapseButton"] button {
  color: var(--muted) !important; opacity: 1 !important; border-radius: var(--radius) !important; }
[data-testid="stExpandSidebarButton"] button:hover, [data-testid="stSidebarCollapseButton"] button:hover {
  color: var(--text) !important; background: var(--raised) !important; }
[data-testid="stSidebarCollapseButton"] { opacity: 1 !important; }

/* row-based selectable tables (Instances): tight hairline rows */
[class*="st-key-instrow_"] { border-bottom: 1px solid var(--border); padding: 3px 12px; }
[class*="st-key-insthead"] { border-bottom: 1px solid var(--border); background: var(--raised);
  padding: 7px 12px; border-radius: 6px 6px 0 0; }
[class*="st-key-instrow_"] [data-testid="stHorizontalBlock"], [class*="st-key-insthead"] [data-testid="stHorizontalBlock"] { align-items: center; }
[class*="st-key-instrow_"]:hover { background: var(--raised); }
[class*="st-key-instrow_"] [data-testid="stCheckbox"], [class*="st-key-insthead"] [data-testid="stCheckbox"] { margin: 0; }
[data-testid="stAppViewContainer"] { background: var(--bg); }
[data-testid="stMainBlockContainer"] { padding: 18px 48px 72px; max-width: 1440px; margin: 0 auto; }
[data-testid="stSidebar"] { background: var(--surface); border-right: 1px solid var(--border); }
[data-testid="stSidebarUserContent"] { padding-top: 8px; }
html, body, [data-testid="stAppViewContainer"] * { font-family: var(--font-sans); }
body { color: var(--text); font-size: 13px; line-height: 1.5; }

/* ---- headings & text helpers ---- */
.cm h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 2px; color: var(--text); }
.cm h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); font-weight: 600; margin: 0; }
.cm .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.cm .muted { color: var(--muted); }
.cm .faint { color: var(--faint); }
.cm .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--faint); font-weight: 600; }
.cm .eyebrow a { color: var(--faint); text-decoration: none; }
.cm .eyebrow a:hover { color: var(--muted); }

.cm .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 24px; }
.cm .page-head p { margin: 6px 0 0; color: var(--muted); max-width: 720px; }

/* ---- panels & tables ---- */
.cm .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 16px; }
.cm .panel-pad { padding: 16px; }
.cm .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.cm .group-title { display: flex; align-items: center; gap: 10px; margin: 24px 0 10px; }
.cm .count-chip { font-size: 11px; color: var(--faint); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }

.cm table.list { width: 100%; border-collapse: collapse; }
.cm table.list th { text-align: left; font-weight: 500; color: var(--faint); font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; padding: 8px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.cm table.list td { padding: 10px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.cm table.list tr:last-child td { border-bottom: none; }
.cm table.list tr.rowlink:hover td { background: var(--raised); }
.cm table.list a.rowcell { color: var(--text); text-decoration: none; display: block; }
.cm .tright { text-align: right; }

/* ---- tags / dots / badges ---- */
.cm .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-family: var(--font-mono); }
.cm .tag.plain { font-family: var(--font-sans); }
.cm .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.cm .dot.production { background: var(--muted); }
.cm .dot.pilot { background: var(--warning); }
.cm .dot.uat { background: var(--uat); }
.cm .tag.uat { color: var(--uat); border-color: color-mix(in oklch, var(--uat) 40%, var(--border)); }

.cm .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; }
.cm .badge.badge-pill { border: 1px solid currentColor; border-radius: 999px; padding: 1px 9px; }
.cm .badge .g { font-size: 11px; }
.cm .badge.error { color: var(--error); }
.cm .badge.warning { color: var(--warning); }
.cm .badge.info { color: var(--info); }
.cm .badge.success { color: var(--success); }
.cm .badge.neutral { color: var(--muted); }

/* ---- findings / inspector ---- */
.cm .finding { display: flex; gap: 8px; padding: 8px; border-radius: var(--radius-sm); align-items: flex-start; }
.cm .finding + .finding { border-top: 1px solid var(--border); }
.cm .finding .fmsg { color: var(--text); }
.cm .finding .floc { color: var(--faint); font-size: 11px; margin-top: 2px; font-family: var(--font-mono); }
.cm .chip { font-family: var(--font-mono); font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 1px 7px; display: inline-block; margin: 2px 4px 2px 0; color: var(--text); }
.cm .chip.op { color: var(--accent); }
.cm .insp-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); margin: 10px 0 4px; }

/* ---- config / pre ---- */
.cm pre.config { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; padding: 12px 16px; margin: 0;
  background: var(--bg); border-radius: var(--radius-sm); white-space: pre; overflow: auto; max-height: 55vh; color: var(--text); }

/* ---- diff ---- */
.cm .diff { font-family: var(--font-mono); font-size: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  overflow: auto; background: var(--surface); }
.cm .drow { display: flex; }
.cm .dgut { width: 44px; flex: none; text-align: right; padding: 0 8px; color: var(--faint); user-select: none; }
.cm .dmark { width: 18px; flex: none; text-align: center; color: var(--faint); }
.cm .dcode { flex: 1; white-space: pre; padding-right: 12px; }
.cm .drow.add { background: color-mix(in oklch, var(--success) 14%, transparent); }
.cm .drow.add .dmark { color: var(--success); }
.cm .drow.del { background: color-mix(in oklch, var(--error) 14%, transparent); }
.cm .drow.del .dmark { color: var(--error); }
.cm .diff-gap { background: color-mix(in oklch, var(--border) 30%, transparent); color: var(--faint);
  letter-spacing: 3px; text-align: center; padding: 2px; }

/* ---- banners / empty ---- */
.cm .banner { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm);
  border: 1px solid; margin: 10px 0; }
.cm .banner.error { background: color-mix(in oklch, var(--error) 8%, transparent); border-color: var(--error); color: var(--text); }
.cm .banner.warning { background: color-mix(in oklch, var(--warning) 8%, transparent); border-color: var(--warning); color: var(--text); }
.cm .banner.info { background: color-mix(in oklch, var(--info) 8%, transparent); border-color: var(--info); color: var(--text); }
.cm .banner .g { color: inherit; }
.cm .empty { text-align: center; color: var(--muted); padding: 40px 16px; }

/* ---- nav (sidebar) ---- */
.cm-brand { display: flex; align-items: center; gap: 9px; padding: 4px 8px 14px; font-weight: 600; color: var(--text); }
.cm-brand .brand-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); }
.cm-nav { display: flex; flex-direction: column; gap: 3px; }
.cm-nav a.nav-link { display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: var(--radius);
  color: var(--muted); font-weight: 500; text-decoration: none; font-size: 13px; }
.cm-nav a.nav-link:hover { background: var(--raised); color: var(--text); }
.cm-nav a.nav-link.active { background: var(--sel); color: var(--text); }
/* SVG icons rendered as masks so they inherit currentColor (st.html strips inline <svg>) */
.cm-ico { display: inline-block; background-color: currentColor; flex: none;
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center; -webkit-mask-mode: alpha; mask-mode: alpha; }
.cm-hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }

/* sidebar nav as in-session buttons (smooth, no full-page reload) with masked icons */
[data-testid="stSidebar"] [data-testid="stVerticalBlock"] { gap: 3px; }
[class*="st-key-nav_"] button { background: transparent !important; border: none !important; box-shadow: none !important;
  justify-content: flex-start !important; text-align: left !important; color: var(--muted) !important;
  font-weight: 500 !important; padding: 7px 9px !important; min-height: 34px !important; border-radius: var(--radius) !important; }
[class*="st-key-nav_"] button:hover { background: var(--raised) !important; color: var(--text) !important; }
[class*="st-key-nav_"] button p, [class*="st-key-nav_"] button div { font-weight: 500 !important;
  font-size: 13px !important; text-align: left !important; width: auto !important; }

.cm .rowflex { display: flex; align-items: center; gap: 10px; }
.cm .spacer { flex: 1; }
.cm .hstack { display: inline-flex; align-items: center; gap: 8px; }
.cm .jira-pill { font-family: var(--font-mono); font-size: 11px; color: var(--accent);
  border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border)); border-radius: 999px;
  padding: 1px 8px; text-decoration: none; }

/* ---- restyle native Streamlit widgets to match (drives both themes) ---- */
.stButton > button, .stDownloadButton > button { border: 1px solid var(--border-strong); background: var(--surface);
  color: var(--text); border-radius: var(--radius); font-weight: 500; font-size: 13px; min-height: 30px; }
.stButton > button:hover, .stDownloadButton > button:hover { background: var(--raised); border-color: var(--border-strong); color: var(--text); }
.stButton > button[kind="primary"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.stButton > button[kind="primary"]:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

/* ---- form controls: ONE height (--ctl-h) AND full-width across every type ---- */
:root { --ctl-h: 40px; }
/* every widget fills its column, so text inputs and selects always match */
[data-testid="stTextInput"], [data-testid="stSelectbox"], [data-testid="stMultiSelect"],
[data-testid="stDateInput"], [data-testid="stNumberInput"], [data-testid="stTextArea"] { width: 100% !important; }
[data-testid="stSelectbox"] > div, [data-testid="stMultiSelect"] > div,
[data-testid="stTextInput"] > div, [data-testid="stDateInput"] > div,
[data-testid="stNumberInput"] > div, div[data-baseweb="select"] { width: 100% !important; }
[data-testid="stTextInput"] div[data-baseweb="base-input"],
[data-testid="stNumberInput"] div[data-baseweb="base-input"],
[data-testid="stDateInput"] div[data-baseweb="base-input"],
div[data-baseweb="select"] > div {
  min-height: var(--ctl-h) !important; width: 100% !important; box-sizing: border-box;
  background: var(--bg) !important; border-color: var(--border-strong) !important; align-items: center; }
[data-testid="stTextInput"] input, [data-testid="stNumberInput"] input, [data-testid="stDateInput"] input {
  min-height: calc(var(--ctl-h) - 2px) !important; background: transparent !important; color: var(--text) !important; }
[data-testid="stTextArea"] textarea { font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
  background: var(--bg) !important; border-color: var(--border-strong) !important; color: var(--text) !important; }

/* select + multiselect (BaseWeb) */
div[data-baseweb="select"] > div { color: var(--text) !important; overflow: visible !important; }
div[data-baseweb="select"] input { background: transparent !important; color: var(--text) !important; }
div[data-baseweb="select"] svg { fill: var(--muted); }
div[data-baseweb="popover"] ul, div[data-baseweb="menu"], div[data-baseweb="popover"] div[role="listbox"] {
  background: var(--raised) !important; color: var(--text) !important; }
div[data-baseweb="popover"] li:hover { background: var(--sel) !important; }

/* expander */
[data-testid="stExpander"] { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
[data-testid="stExpander"] summary, [data-testid="stExpander"] details > summary { background: var(--surface) !important; color: var(--text) !important; }
[data-testid="stExpander"] summary:hover { color: var(--text) !important; }

/* segmented control / pills */
[data-testid="stSegmentedControl"] button, div[data-baseweb="button-group"] button { background: var(--surface); color: var(--muted); border-color: var(--border-strong); }
[data-testid="stSegmentedControl"] button[aria-checked="true"], [data-testid="stSegmentedControl"] button[kind="segmented_controlActive"] {
  background: var(--sel) !important; color: var(--text) !important; border-color: var(--accent) !important; }

/* checkboxes / toggles / labels */
.stCheckbox, .stRadio, [data-testid="stWidgetLabel"] label, [data-testid="stWidgetLabel"] p { color: var(--text); }
[data-baseweb="checkbox"] div[data-checked="true"] { background: var(--accent) !important; border-color: var(--accent) !important; }

/* containers with borders (st.container(border=True)) */
[data-testid="stVerticalBlockBorderWrapper"] > div > [data-testid="stVerticalBlock"]:has(> [data-testid="stElementContainer"]) {}
div[data-testid="stVerticalBlock"] > div[style*="border"] { border-color: var(--border) !important; }

/* dialog */
[data-testid="stDialog"] > div { background: var(--surface); border: 1px solid var(--border); }

/* ---- density & rhythm ---- */
[data-testid="stMainBlockContainer"] [data-testid="stVerticalBlock"] { gap: 0.55rem; }
.cm .page-head { margin: 0 0 18px; }
.cm .group-title { margin: 22px 0 9px; }
.cm .group-title:first-child { margin-top: 6px; }

/* ---- table polish ---- */
.cm table.list td, .cm table.list th { padding-top: 9px; padding-bottom: 9px; }
.cm table.list a.rowcell:hover { color: var(--accent); }
.cm table.list tr.rowlink { cursor: pointer; }
.cm .tcenter { text-align: center; }

/* ---- checkbox link (row selection) ---- */
.cm a.cbx { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
  border: 1.5px solid var(--border-strong); border-radius: 4px; text-decoration: none; color: transparent;
  font-size: 11px; line-height: 1; }
.cm a.cbx:hover { border-color: var(--accent); }
.cm a.cbx.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }

/* ---- action pills (links that act) ---- */
.cm a.act { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 1;
  padding: 5px 11px; border: 1px solid var(--border-strong); border-radius: var(--radius);
  color: var(--muted); text-decoration: none; white-space: nowrap; transition: background 120ms var(--ease); }
.cm a.act:hover { background: var(--raised); color: var(--text); }
.cm a.act.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.cm a.act.primary:hover { background: var(--accent-hover); }
.cm a.act.danger { color: var(--error); border-color: color-mix(in oklch, var(--error) 42%, var(--border)); }
.cm a.act.danger:hover { background: color-mix(in oklch, var(--error) 12%, transparent); color: var(--error); }
.cm .act-row { display: flex; gap: 6px; justify-content: center; }

/* settings panels: a labelled two-column grid instead of loose stacks */
.cm .kv { display: grid; grid-template-columns: 130px 1fr; gap: 6px 16px; align-items: baseline; }
.cm .kv .k { color: var(--faint); font-size: 12px; }

/* ---- multiselect: placeholder + tags vertically centred, never clipped ---- */
div[data-baseweb="select"] > div > div:first-child { display: flex !important; align-items: center !important;
  flex-wrap: wrap; overflow: visible !important; min-height: calc(var(--ctl-h) - 4px); }
[data-baseweb="tag"] { background: color-mix(in oklch, var(--accent) 20%, var(--surface)) !important;
  color: var(--text) !important; border: 1px solid color-mix(in oklch, var(--accent) 35%, var(--border)) !important;
  overflow: visible !important; height: 24px !important; position: relative; z-index: 1;
  margin: 2px 6px 2px 2px !important; max-width: none !important; padding: 2px 7px 2px 9px !important;
  align-self: center; }
[data-baseweb="tag"] span { color: var(--text) !important; overflow: visible !important;
  max-width: none !important; width: auto !important; text-overflow: clip !important; padding: 0 !important; }

/* ---- commit graph ---- */
.cm .graph-wrap { position: relative; overflow-x: auto; }
.cm .graph-row { display: flex; align-items: center; height: 34px; border-bottom: 1px solid var(--border); }
.cm .graph-row:hover { background: var(--raised); }
.cm .graph-row a.gcell { display: flex; align-items: center; width: 100%; height: 100%; text-decoration: none; color: var(--text); }
.cm .graph-row .g-subj { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 12px; }
.cm .graph-row .g-meta { color: var(--faint); font-size: 12px; white-space: nowrap; }
.cm .graph-svg { position: absolute; top: 0; left: 0; pointer-events: none; }
"""


_CHEVRON = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths}</svg>')
_CHEV_RIGHT = _CHEVRON.format(paths='<path d="M8 6l6 6-6 6"/><path d="M14 6l6 6-6 6"/>')
_CHEV_LEFT = _CHEVRON.format(paths='<path d="M16 6l-6 6 6 6"/><path d="M10 6l-6 6 6 6"/>')


def _toggle_icon_css() -> str:
    """Replace Streamlit's Material-ligature sidebar toggle with a clean chevron.
    stExpandSidebarButton IS the <button>; the collapse button is nested."""
    right = svg_data_uri(_CHEV_RIGHT)
    left = svg_data_uri(_CHEV_LEFT)
    exp = 'button[data-testid="stExpandSidebarButton"]'
    col = '[data-testid="stSidebarCollapseButton"] button'
    return (
        f'{exp}, {col} {{ font-size: 0 !important; color: var(--muted) !important; visibility: visible !important; }}\n'
        f'{exp}:hover, {col}:hover {{ color: var(--text) !important; background: var(--raised) !important; }}\n'
        f'{exp} [data-testid="stIconMaterial"], {col} [data-testid="stIconMaterial"] {{ display: none !important; }}\n'
        f'{exp}::after, {col}::after {{ content: ""; display: inline-block; width: 17px; height: 17px;'
        ' background-color: currentColor; visibility: visible !important;'
        ' -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;'
        ' -webkit-mask-position: center; mask-position: center; }\n'
        f'{exp}::after {{ -webkit-mask-image: url({right}); mask-image: url({right}); }}\n'
        f'{col}::after {{ -webkit-mask-image: url({left}); mask-image: url({left}); }}\n'
    )


def _nav_icon_css() -> str:
    """Masked ::before icon for each sidebar nav button (concrete #000 stroke so
    the alpha mask is well-defined)."""
    out = []
    for key, svg in NAV_ICONS.items():
        uri = svg_data_uri(svg.replace("currentColor", "#000"))
        out.append(
            f'.st-key-nav_{key} button::before {{ content: ""; display: inline-block; width: 16px; height: 16px;'
            ' margin-right: 10px; background-color: currentColor; flex: none;'
            f' -webkit-mask: url({uri}) center/contain no-repeat; mask: url({uri}) center/contain no-repeat;'
            ' -webkit-mask-mode: alpha; mask-mode: alpha; }\n')
    return "".join(out)


def inject_css(base: str = "dark") -> None:
    tokens = _LIGHT if base == "light" else _DARK
    # Drive the app background + typography from our tokens so a session-state
    # theme flip recolors everything our CSS covers, independent of config base.
    root = (
        f":root {{{tokens}}}\n"
        '[data-testid="stAppViewContainer"], [data-testid="stApp"] { background: var(--bg); color: var(--text); }\n'
    )
    st.markdown(f"<style>{root}{_COMPONENT_CSS}{_toggle_icon_css()}{_nav_icon_css()}</style>",
                unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Routing via query params (so HTML rows/links are genuinely clickable)
# ---------------------------------------------------------------------------

def route() -> dict:
    qp = st.query_params
    return {
        "p": qp.get("p", "instances"),
        "code": qp.get("code"),
        "id": qp.get("id"),
        "hash": qp.get("hash"),
    }


def _persist_params(params: dict) -> None:
    """Theme (t) and dev user (u) live in the URL so they survive navigation,
    since each link click is a full reload (a fresh Streamlit session)."""
    params.setdefault("t", st.session_state.get("theme", "dark"))
    params.setdefault("u", st.session_state.get("dev_user", "admin"))


def goto(**params) -> None:
    """Programmatic navigation after an action: set query params and rerun."""
    _persist_params(params)
    st.query_params.clear()
    for k, v in params.items():
        if v is not None:
            st.query_params[k] = str(v)
    st.rerun()


def href(**params) -> str:
    _persist_params(params)
    parts = [f"{k}={html.escape(str(v))}" for k, v in params.items() if v is not None]
    return "?" + "&".join(parts)


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

def esc(s) -> str:
    return html.escape(str(s if s is not None else ""))


def svg_data_uri(svg: str) -> str:
    return "data:image/svg+xml," + quote(svg, safe="")


def icon_span(svg: str, size: int = 16) -> str:
    """Render an inline SVG as a currentColor-tinted mask (st.html strips <svg>)."""
    uri = svg_data_uri(svg)
    return (f'<span class="cm-ico" style="width:{size}px;height:{size}px;'
            f'-webkit-mask-image:url({uri});mask-image:url({uri})"></span>')


def md(html_str: str) -> None:
    # st.html (not st.markdown) keeps anchors same-tab: st.markdown forces
    # target="_blank" on every link, which opens new tabs and breaks navigation.
    st.html(f'<div class="cm">{html_str}</div>')


def page_header(eyebrow_html: str, title: str, desc: str = "", title_mono: bool = False) -> None:
    cls = "mono" if title_mono else ""
    p = f"<p>{esc(desc)}</p>" if desc else ""
    md(f'<div class="page-head"><div><div class="eyebrow">{eyebrow_html}</div>'
       f'<h1 class="{cls}">{esc(title)}</h1>{p}</div></div>')


# severity glyphs (color is never the only signal)
_SEV_GLYPH = {"error": "▲", "warning": "◆", "info": "●", "success": "✓"}


def finding_glyph(sev: str) -> str:
    return _SEV_GLYPH.get(sev, "●")


def badge(kind: str, text: str, pill: bool = True, glyph: Optional[str] = None) -> str:
    g = glyph if glyph is not None else _SEV_GLYPH.get(kind, "")
    gh = f'<span class="g">{g}</span>' if g else ""
    pc = " badge-pill" if pill else ""
    return f'<span class="badge {kind}{pc}">{gh}{esc(text)}</span>'


_STATUS_COLOR = {
    "draft": "neutral", "submitted": "info", "approved": "success",
    "rejected": "error", "merged": "success", "cancelled": "neutral",
}


def status_badge(status: str) -> str:
    color = _STATUS_COLOR.get(status, "neutral")
    return f'<span class="badge {color} badge-pill">{esc(status)}</span>'


def env_tag(inst: dict) -> str:
    env = inst["environment"]
    t = f'<span class="tag plain"><span class="dot {env}"></span>{esc(env)}</span>'
    if inst.get("uat"):
        t += ' <span class="tag uat"><span class="dot uat"></span>UAT</span>'
    return t


def gate_summary(e: int, w: int, i: int) -> str:
    if e == 0 and w == 0 and i == 0:
        return badge("success", "No findings", glyph="●")
    parts = []
    if e:
        parts.append(badge("error", f"{e} error{'s' if e != 1 else ''}"))
    if w:
        parts.append(badge("warning", f"{w} warning{'s' if w != 1 else ''}"))
    if i:
        parts.append(badge("info", str(i)))
    return '<span class="hstack">' + " ".join(parts) + "</span>"


def rel_time(iso: str) -> str:
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return esc(iso)
    delta = (datetime.now(timezone.utc) - dt).total_seconds()
    if delta < 60:
        return f"{int(delta)}s ago"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return dt.strftime("%Y-%m-%d")


def banner(kind: str, text_html: str) -> str:
    g = _SEV_GLYPH.get(kind, "●")
    return f'<div class="banner {kind}"><span class="g">{g}</span><div>{text_html}</div></div>'


def empty(text: str, glyph: str = "") -> None:
    g = f'<div style="font-size:22px;opacity:.5;margin-bottom:8px">{glyph}</div>' if glyph else ""
    md(f'<div class="panel"><div class="empty">{g}{esc(text)}</div></div>')


# ---------------------------------------------------------------------------
# Diff rendering (parseDiff + DiffLines, ported)
# ---------------------------------------------------------------------------

def render_diff(patch: str, max_height: int = 360) -> str:
    if not patch or not patch.strip():
        return '<div class="diff"><div class="empty">No content changes.</div></div>'
    rows = []
    old_ln = new_ln = 0
    any_change = False
    lines = patch.split("\n")
    first_hunk = True
    for line in lines:
        if line.startswith(("diff --git", "index ", "--- ", "+++ ", "old mode", "new mode",
                            "rename ", "similarity ", "\\ No newline")):
            continue
        if line.startswith("@@"):
            import re
            m = re.search(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
            if m:
                old_ln = int(m.group(1))
                new_ln = int(m.group(2))
            if not first_hunk:
                rows.append('<div class="diff-gap">⋯</div>')
            first_hunk = False
            continue
        if line.startswith("+"):
            any_change = True
            rows.append(f'<div class="drow add"><div class="dgut"></div><div class="dgut">{new_ln}</div>'
                        f'<div class="dmark">+</div><div class="dcode">{esc(line[1:])}</div></div>')
            new_ln += 1
        elif line.startswith("-"):
            any_change = True
            rows.append(f'<div class="drow del"><div class="dgut">{old_ln}</div><div class="dgut"></div>'
                        f'<div class="dmark">-</div><div class="dcode">{esc(line[1:])}</div></div>')
            old_ln += 1
        else:
            content = line[1:] if line.startswith(" ") else line
            rows.append(f'<div class="drow"><div class="dgut">{old_ln}</div><div class="dgut">{new_ln}</div>'
                        f'<div class="dmark"></div><div class="dcode">{esc(content)}</div></div>')
            old_ln += 1
            new_ln += 1
    if not any_change:
        return '<div class="diff"><div class="empty">No content changes.</div></div>'
    return f'<div class="diff" style="max-height:{max_height}px">' + "".join(rows) + "</div>"


# ---------------------------------------------------------------------------
# Commit graph (SVG lane/node graph, ported from the original CommitGraph)
# ---------------------------------------------------------------------------

# Concrete per-theme colors (the graph SVG is embedded as an <img>, so CSS
# variables don't resolve inside it — bake the values).
_LANES_DARK = ["#7b86f0", "#6ea8e6", "#5fd39a", "#e6b84d", "#b07be0", "#f0736a"]
_LANES_LIGHT = ["#4b45c4", "#2f6fb0", "#2f8f5b", "#9a6a12", "#7b3fb0", "#c22f2f"]


def commit_graph(commits: list[dict]) -> str:
    """Render commits (newest first) as an SVG lane graph + aligned text rows.

    The graph is emitted as a data-URI <img> (st.html strips inline <svg>), so
    lane colours are baked from the active theme."""
    if not commits:
        return ""
    light = st.session_state.get("theme", "dark") == "light"
    lane_colors = _LANES_LIGHT if light else _LANES_DARK
    node_stroke = "#fdfdfe" if light else "#23262f"
    ROW_H, LANE_W, R, X0 = 34, 16, 4, 14
    index = {c["hash"]: i for i, c in enumerate(commits)}
    lanes: list = []
    node_lane: dict = {}

    def alloc() -> int:
        for i, v in enumerate(lanes):
            if v is None:
                return i
        lanes.append(None)
        return len(lanes) - 1

    for c in commits:
        h = c["hash"]
        reserved = [li for li, v in enumerate(lanes) if v == h]
        if reserved:
            lane = reserved[0]
            for li in reserved[1:]:
                lanes[li] = None
        else:
            lane = alloc()
        node_lane[h] = lane
        pars = [p for p in c.get("parents", []) if p in index]
        if pars:
            lanes[lane] = pars[0]
            for p in pars[1:]:
                if p not in lanes:
                    lanes[alloc()] = p
        else:
            lanes[lane] = None

    max_lane = max(node_lane.values())
    width = X0 + max_lane * LANE_W + X0
    height = len(commits) * ROW_H

    def xc(l): return X0 + l * LANE_W
    def yc(i): return i * ROW_H + ROW_H // 2

    edges, nodes = [], []
    for i, c in enumerate(commits):
        li = node_lane[c["hash"]]
        xi, yi = xc(li), yc(i)
        for p in c.get("parents", []):
            if p not in index:
                continue
            j, lp = index[p], node_lane[p]
            xp, yp = xc(lp), yc(j)
            pcol = lane_colors[lp % len(lane_colors)]
            if li == lp:
                edges.append(f'<path d="M{xi},{yi} L{xp},{yp}" stroke="{pcol}" stroke-width="1.5" fill="none"/>')
            else:
                my = (yi + yp) / 2
                edges.append(f'<path d="M{xi},{yi} C{xi},{my} {xp},{my} {xp},{yp}" '
                             f'stroke="{pcol}" stroke-width="1.5" fill="none"/>')
        col = lane_colors[li % len(lane_colors)]
        nodes.append(f'<circle cx="{xi}" cy="{yi}" r="{R}" fill="{col}" '
                     f'stroke="{node_stroke}" stroke-width="1.5"/>')

    inner = "".join(edges) + "".join(nodes)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
           f'viewBox="0 0 {width} {height}">{inner}</svg>')
    img = f'<img class="graph-svg" src="{svg_data_uri(svg)}" width="{width}" height="{height}"/>'

    rows = []
    for c in commits:
        refs = " ".join(f'<span class="tag mono">{esc(code)}</span>' for code in c.get("instances", [])[:2])
        link = href(p="commit", hash=c["hash"])
        rows.append(
            f'<div class="graph-row"><a class="gcell" href="{link}" style="padding-left:{width}px">'
            f'<span class="g-subj">{esc(c["subject"])}</span>{refs} '
            f'<span class="g-meta mono" style="margin-left:10px">{esc(c["short"])}</span>'
            f'<span class="g-meta" style="margin-left:14px;width:120px;overflow:hidden;'
            f'text-overflow:ellipsis">{esc(c["authorName"])}</span>'
            f'<span class="g-meta" style="margin-left:14px;width:74px;text-align:right">'
            f'{rel_time(c["date"])}</span></a></div>')

    return f'<div class="graph-wrap">{img}<div>{"".join(rows)}</div></div>'
