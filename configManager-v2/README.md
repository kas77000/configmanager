# Configuration Manager v2 — Streamlit port

A faithful Python/Streamlit reimplementation of the Configuration Manager web app: a GitHub-like
manager for versioning, editing, reviewing, approving, and tracking changes to algo-trading FIX
configuration files (`ai.fixmsg.properties`) across trading-platform instances (**APIA … APIM**).

It does the same thing as the original React + Express app, with the same layout and the same
instrument-panel visual style — but as a single self-contained Streamlit application, so it runs
anywhere Python does, with **no Node.js, no separate API server, and no `git` binary required**.

---

## Why a Streamlit version

The original is a three-package Node monorepo (a React SPA + an Express API + a git-CLI-backed config
repo). This port collapses all of that into one Streamlit process that a machine which can't host the
Node app can still run. The workflow, the rules engine, the roles, the emails, and the look are
preserved 1:1; only the *hosting shape* changed.

## What it does

- **Per-instance versioning.** Each instance (APIA–APIM) keeps its own version of every managed file,
  on its own long-lived branch. Instances evolve independently — there is no shared "main".
- **Safe editing with live analysis.** Edit `ai.fixmsg.properties` with a live warnings rail that
  flags rules which shadow, contradict, or make each other redundant/unreachable (errors block a
  merge; warnings must be acknowledged).
- **A GitHub-like change workflow.** A **change** bundles one or more **modifications**; each is a
  config file with its own description and the instances it applies to. Changes are edited on
  per-instance working branches and merged with a 3-way merge behind a merge gate.
- **Approval workflow.** Edit → **Submit for approval** → **Approve/Reject** → record a **Jira** link
  per modification → **Merge** per instance → send a **recap** email. Cancellable until merged.
- **Live sync & drift detection.** From **Instances**, **Sync** one or several instances: the app
  compares each instance's live config against the versioned copy and records the live version only
  when it actually differs.
- **Outlook email drafts.** The app never sends mail. It generates pre-filled Outlook `.eml` drafts
  (approval request and recap, `X-Unsent: 1`) you review and send yourself.
- **Windows-ID identity, no passwords.** Roles: **Admin**, **Quant** (editor), **Stakeholder**
  (approver). The first user seen becomes Admin; later users start pending until an admin assigns
  roles on **People**.
- **Dynamic instance admin.** Admins add/edit/remove instances and the files managed for each, and set
  where each instance's config lives (shared drive or server).
- **Full audit trail + history.** Who did what and when, plus a per-instance commit list with diffs.

## Architecture

```
configManager-v2/
  streamlit_app.py          # entry: shell, sidebar nav, role-gated routing (query-param based)
  .streamlit/config.toml    # theme (dark base; OKLCH tokens + light/dark toggle applied at runtime)
  core/
    rules.py                # rule engine — a 1:1 port of @config-manager/rule-engine
    vcs.py                  # JSON-backed version control (branches, commits, 3-way merge, diffs)
    store.py                # data stores + workflow + gate + identity (ports server/src/*)
    email_drafts.py         # approval / recap .eml generation
  app_pages/                # one module per page (instances, changes, change_detail, …) + shared ui
  seed/ai.fixmsg.properties # seed config used to initialise every instance branch
  reset.py                  # wipe/reset data (mirrors `npm run reset`)
```

Everything lives on disk under `data/` (gitignored) as JSON — no database. The rule engine is a
verified line-for-line port of the original TypeScript package (same findings on the same file).

### Version control: two interchangeable backends

The original backed versioning with a real git repo driven by the `git` CLI. This port offers **both
options, selectable at runtime from the Admin page**:

- **Built-in (default, dependency-free)** — `core/vcs.py` reproduces the git model (per-instance
  branches, working branches per change, commits, 3-way merge with conflict detection, unified diffs)
  **in pure Python** via `difflib`. No `git` install, no `.git` directory — runs anywhere.
- **Official git** — `core/gitvcs.py` drives the real `git` CLI (mirroring the original
  `server/src/git/repo.ts`), so history lives in an inspectable `.git` repo under `data/config-repo`.
  Requires the `git` binary on PATH; the Admin selector auto-detects it and disables this option if
  it's missing.

Both implement the same interface, so the workflow, merge gate, diffs, and history behave identically
either way — only the storage engine differs.

**Switching backends** (Admin → Version control backend) is **destructive**: the two engines store
history incompatibly, so a switch **resets the config version history and all changes** (drafts,
submitted, merged). Users, the instances registry, settings, and the audit log are kept; instances
are re-seeded from `seed/ai.fixmsg.properties`. The switch is guarded by a typed CONFIRM step.

---

## Setup & run

Requires **Python 3.9+**.

```bash
cd configManager-v2
pip install -r requirements.txt      # just streamlit
streamlit run streamlit_app.py
```

Open the URL Streamlit prints (default <http://localhost:8501>). You land as the seeded **admin**
user. Instances **APIA–APIM** are created on first run (APIC/APIF/APIG/APIH are pilots, **APIH** is
UAT, the rest production).

### Identity in dev

The sidebar has a **"Signed in as (dev)"** field (the equivalent of the reverse proxy's
`x-remote-user` header). Type a different Windows ID to impersonate another user and exercise the
role-gated views. The **first** identity the app ever sees becomes Admin; every later one starts
pending until an admin assigns roles on **People**.

### Theme

Dark is the considered default; a **Light theme / Dark theme** toggle in the sidebar switches the
whole app between the two OKLCH palettes.

---

## Configuration (environment variables)

All optional:

| Variable | Default | Purpose |
|---|---|---|
| `CM_DATA_DIR` | `./data` | Where the JSON state lives. |
| `APP_BASE_URL` | `http://localhost:8501` | Base URL used in the links inside approval/recap emails. |
| `SERVICE_ACCOUNT_USER` | *(empty)* | Username shown for server-type instances (display only). |
| `SERVICE_ACCOUNT_PASSWORD` | *(empty)* | Only its presence is exposed, as a "configured" flag. |

To seed instances from your own starting config, replace `seed/ai.fixmsg.properties` before the first
run (or after a reset).

---

## Resetting the data

```bash
python reset.py                 # wipe everything (data/)
python reset.py users           # clear only users → next visitor becomes Admin again
python reset.py changes audit   # clear one or more stores
```

Targets: `users`, `instances`, `changes`, `settings`, `audit`, `repo`, `live`, `all`. Each cleared
store is re-created (re-seeded) on the next app start.

---

## How the workflow maps to the UI

1. **Changes → New change.** Title + effective date, then one or more modifications (file +
   description + instances).
2. **Edit** each instance's file (editor + live warnings rail + a "Changes to …" diff).
3. **Submit for approval** → an **Approval email…** download appears.
4. **Stakeholders Approve/Reject** on **Requests**.
5. **JIRA tickets** panel (after approval): paste one ticket link per modification.
6. **Merge** each instance (errors block; warnings must be acknowledged; an admin can override errors
   with a recorded reason).
7. **Recap email…** (after merge).

A change can be **cancelled** any time before any instance is merged.
