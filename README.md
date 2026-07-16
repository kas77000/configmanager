# Configuration Manager

A GitHub-like web app for versioning, editing, reviewing, approving, and tracking changes to
algo-trading FIX configuration files across trading-platform instances (**APIA … APIM**).

Phase 1 manages a single file, `ai.fixmsg.properties`, with a rules/validation engine that warns
when a rule change makes another rule redundant or unreachable. The workflow mirrors a real
change-management procedure: **edit → email an approval request → approve/reject → record a Jira
ticket per file → merge → recap email**.

---

## What it does

- **Per-instance versioning.** Each instance (APIA–APIM) has its own canonical version of every
  managed file, kept on its own long-lived Git branch (`instance/<CODE>`). There is no single shared
  "main", each instance evolves independently.
- **Safe editing with live analysis.** A Monaco-based editor plus a rule builder let the quant team
  edit `ai.fixmsg.properties`. The rule engine runs in the browser and on the server, flagging rules
  that shadow or contradict each other (errors block a merge; warnings must be acknowledged).
- **A GitHub-like change workflow.** A **change** bundles one or more **modifications**; each
  modification is a config file with its own description and the instances it applies to. Changes are
  edited on per-instance working branches and merged with a 3-way merge and a merge gate.
- **Approval workflow.** Edit → **Submit for approval** → stakeholders **Approve/Reject** → record
  the **Jira** ticket(s) → **Merge** per instance → send a **recap** email.
- **Outlook email drafts.** The app never sends mail. It generates pre-filled Outlook `.eml` drafts
  (approval request and recap) that you review and send yourself.
- **Windows-ID identity, no passwords.** Users are identified by their Windows ID (supplied by a
  reverse proxy in production). Roles: **Admin**, **Quant** (editor), **Stakeholder** (approver). A
  "boss" is simply someone who is both Quant and Stakeholder.
- **Dynamic instance admin.** Admins add/edit/remove instances and the files managed for each, and
  set where each instance's config lives (a **shared drive** or a **server**; server-hosted instances
  are reached with a service account).
- **Full audit trail.** Who did what, and when, across the change lifecycle.

---

## Architecture

An npm-workspaces monorepo with three packages:

| Package | Name | Role |
|---|---|---|
| `packages/rule-engine` | `@config-manager/rule-engine` | Pure functions (`parseFile`, `analyze`) for shadow/redundancy detection. Shared by server and web. |
| `packages/server` | `@config-manager/server` | Express API. Git-backed config repo (shells out to the `git` CLI), JSON file stores, Windows-ID identity, Jira + email generation. |
| `packages/web` | `@config-manager/web` | React + Vite single-page app. Reuses the rule engine in the browser for live warnings. |

Data flow: the web app talks to the API under `/api` (proxied to `:4000` in dev). The server keeps
its state on disk under `data/` (a Git repo plus JSON stores) — nothing needs a database.

---

## Prerequisites

- **Node.js 20.6 or newer** (the server uses `process.loadEnvFile()`, added in 20.6; Node 22/24 are
  fine). Check with `node -v`.
- **Git** on the `PATH` (the server drives version control through the `git` CLI). Check with
  `git --version`.
- **npm** (bundled with Node).

---

## Setup

### 1. Install

```bash
git clone https://github.com/kas77000/configmanager.git
cd configmanager
npm install
```

`npm install` installs dependencies for all three workspace packages at once.

### 2. Provide a seed config (optional but recommended)

On first run the server initializes the Git repo by seeding every instance branch from one starting
copy of `ai.fixmsg.properties`. That seed file lives in `configsMoc/` (which is **gitignored** — a
real trading config never belongs in the repo):

```bash
mkdir -p configsMoc
# put a starting ai.fixmsg.properties here:
#   configsMoc/ai.fixmsg.properties
```

If the file is absent, the server still starts, it seeds each instance with a placeholder so you can
begin, and you can paste real content in later.

### 3. Configure the environment

Copy the example and fill in what you need:

```bash
cp .env.example .env
```

`.env` is gitignored and is loaded by the server on startup. All values are optional for local
development, sensible defaults apply. See [Environment reference](#environment-reference) below.

---

## Running (development)

The API and the web app run as two processes. Open two terminals:

**Terminal 1 — API (port 4000):**

```bash
npm run dev -w @config-manager/server
```

**Terminal 2 — web app (port 5173):**

```bash
npm run dev -w @config-manager/web
```

Then open **http://localhost:5173**. Vite proxies `/api` to the server on `:4000`.

> Use `dev` (via `tsx watch`, auto-reload) while developing. `npm start -w @config-manager/server`
> runs the API once without watch.

### First run and identity

- **Bootstrapping admin:** the **first user** the server ever sees becomes an **Admin** automatically.
  Every later user is auto-registered as *pending* (no roles) until an admin assigns roles on the
  **People** page.
- **Who am I in dev?** In development the browser sends an `x-remote-user` header with a dev identity
  (default `salavat`, stored in the browser's `localStorage`). That means the first person to load the
  app locally becomes the admin. You can impersonate a different Windows ID from the app (or by setting
  `localStorage` `cm.devUser`) to test roles.
- **Production identity:** a reverse proxy performs Windows Integrated Auth and sets the
  `x-remote-user` header; the app trusts it. No passwords are ever stored.

### Seeded instances

Instances **APIA–APIM** are seeded on first run. **APIH** is the UAT box; **APIC, APIF, APIG, APIH**
are pilots and the rest are production. All of this is editable afterwards under **Admin → Instances**.

---

## Testing, typecheck, build

```bash
# run the whole test suite (rule-engine + server), from the repo root
npm test

# watch mode
npm run test:watch

# typecheck the web app
npm run typecheck -w @config-manager/web

# production build of the web app (outputs packages/web/dist)
npm run build -w @config-manager/web
```

---

## Environment reference

All variables are read from `.env` (or the real environment) by the server.

| Variable | Default | Purpose |
|---|---|---|
| `SERVICE_ACCOUNT_USER` | *(empty)* | Username the app uses to reach **server**-type instances. The UI shows only this and a "configured" flag. |
| `SERVICE_ACCOUNT_PASSWORD` | *(empty)* | Its password. **Stays on the server** — never stored by the app, never sent to the browser. |
| `APP_BASE_URL` | `http://localhost:5173` | Base URL used in the links inside approval/recap emails. |
| `JIRA_BASE_URL` | *(empty)* | Jira REST base URL. Leave blank to use the built-in dev stub (fake `CFG-####` keys). |
| `JIRA_PROJECT_KEY` | *(empty)* | Jira project key for created issues. |
| `JIRA_EMAIL` | *(empty)* | Jira Basic-auth email. |
| `JIRA_API_TOKEN` | *(empty)* | Jira Basic-auth API token. |
| `PORT` | `4000` | API port. |
| `CONFIG_MANAGER_DEV_USER` | `salavat` | Dev only: Windows ID to assume when off-domain. |

> The Jira **epic** for config-change tickets is set in the app (People page, default
> `BSGPTALGO-550`), not in `.env`.

---

## How the workflow maps to the UI

1. **Changes → New change.** Give the change a title and an effective date (defaults to the next
   business day), then add one or more modifications (file + description + instances).
2. **Edit** each instance's file in the change (Monaco editor + rule builder). Warnings show live; the
   "Changes to …" diff shows exactly what you added/removed with line numbers.
3. **Submit for approval.** The change moves to *submitted*; an **Emails** menu appears with the
   **Approval email…** draft to send to stakeholders.
4. **Stakeholders Approve/Reject** (from the link in the email, or in the app).
5. **JIRA tickets** panel (after approval): create the ticket(s) in Jira using the app's suggested
   summary/description, then paste each link back. The app derives the issue key from the URL.
6. **Merge** each instance (subject to the merge gate: errors block; warnings must be acknowledged; an
   admin can override errors with a recorded reason).
7. **Recap email…** (after merge) — send the "it's done" recap.

---

## Data & security notes

- **State on disk:** everything lives under `data/` (gitignored) — a Git repository at
  `data/config-repo` holding the per-instance branches, plus JSON stores for users, instances,
  changes, and the audit log. It is created on first run; delete `data/` to reset.
- **No passwords in the app.** Identity is the Windows ID from the reverse proxy. The only credential
  is the service-account password, which lives only in `.env` (`SERVICE_ACCOUNT_PASSWORD`) and never
  reaches the client.
- **Email is never auto-sent.** The app produces Outlook `.eml` drafts (`X-Unsent: 1`); you review and
  send them yourself.
- **The app reads instance config; it does not deploy.** It pulls live config inbound (to compare
  against the versioned copy) but never pushes to the instances.
- **`.env`, `data/`, and `configsMoc/` are gitignored** — secrets and real configs stay off GitHub.

---

## Project status

This is a working prototype covering the full workflow end to end. Known stubs/simplifications for a
production rollout: live instance connectivity (currently a static reader), the reverse-proxy Windows
auth, real Jira credentials, and JSON-file persistence (vs. a database).
