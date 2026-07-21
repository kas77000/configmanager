"""Application store — a self-contained port of the Express server's JSON stores,
git-backed config repo, identity, and change workflow.

Everything the original kept across `data/` (users, instances, changes, settings,
audit) plus the git repo is persisted here as JSON under a single data directory.
Versioning is handled by `vcs.Repo` (no `git` binary required).

The public methods mirror the API endpoints in server/src/app.ts so the Streamlit
pages read like thin views over the same contract.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from . import email_drafts
from .gitvcs import GitRepo, git_available
from .rules import analyze_text, severity_counts
from .vcs import Repo, now_iso

VCS_BACKENDS = ["builtin", "git"]
VCS_BACKEND_LABEL = {"builtin": "Built-in (dependency-free)", "git": "Official git"}

# ---------------------------------------------------------------------------
# Constants (config.ts)
# ---------------------------------------------------------------------------

MANAGED_FILE = "ai.fixmsg.properties"
INSTANCES = [
    "APIA", "APIB", "APIC", "APID", "APIE", "APIF", "APIG",
    "APIH", "APII", "APIJ", "APIK", "APIL", "APIM",
]
PILOT_INSTANCES = ["APIC", "APIF", "APIG", "APIH"]
UAT_INSTANCE = "APIH"
ROLES = ["admin", "editor", "stakeholder"]
ROLE_LABEL = {"admin": "Admin", "editor": "Quant", "stakeholder": "Stakeholder"}
LOCATION_TYPES = ["shared", "server"]

_CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def environment_of(code: str) -> str:
    return "pilot" if code in PILOT_INSTANCES else "production"


def instance_branch(code: str) -> str:
    return f"instance/{code}"


def change_branch(change_id: str, code: str) -> str:
    return f"change/{change_id}/{code}"


# ---------------------------------------------------------------------------
# Role helpers (users.ts)
# ---------------------------------------------------------------------------

def is_admin(roles: list[str]) -> bool:
    return "admin" in roles


def can_edit(roles: list[str]) -> bool:
    return "admin" in roles or "editor" in roles


def can_approve(roles: list[str]) -> bool:
    return "admin" in roles or "stakeholder" in roles


def is_pending(roles: list[str]) -> bool:
    return len(roles) == 0


def role_summary(roles: list[str]) -> str:
    if not roles:
        return "Pending"
    return ", ".join(ROLE_LABEL[r] for r in ROLES if r in roles)


def _force_rmtree(path: Path) -> None:
    """Remove a tree even when it holds read-only files (git packs on Windows)."""
    def on_error(func, p, exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except Exception:
            pass

    if not path.exists():
        return
    try:
        shutil.rmtree(path, onexc=on_error)  # Python 3.12+
    except TypeError:
        shutil.rmtree(path, onerror=lambda f, p, e: on_error(f, p, e))


class StoreError(Exception):
    """Raised for expected workflow/validation failures (message shown in UI)."""

    def __init__(self, message: str, code: Optional[str] = None, extra: Optional[dict] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra or {}


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class Store:
    def __init__(self, data_dir: Path, seed_file: Path, app_base_url: str = "http://localhost:8501",
                 service_account_user: str = "", service_account_password: str = ""):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.seed_file = Path(seed_file)
        self.app_base_url = app_base_url
        self.service_account_user = service_account_user
        self.service_account_password = service_account_password

        self._paths = {
            "users": self.data_dir / "users.json",
            "instances": self.data_dir / "instances.json",
            "changes": self.data_dir / "changes.json",
            "settings": self.data_dir / "settings.json",
            "audit": self.data_dir / "audit.json",
            "repo": self.data_dir / "repo.json",
            "live": self.data_dir / "live.json",
        }
        self.git_dir = self.data_dir / "config-repo"
        self.users: list[dict] = self._load("users", [])
        self.instances: list[dict] = self._load("instances", [])
        self.changes: list[dict] = self._load("changes", [])
        self.settings: dict = self._load("settings", {"quantDistributionEmail": "", "vcsBackend": "builtin"})
        self.audit: list[dict] = self._load("audit", [])
        self.live: dict = self._load("live", {})

        self.backend = self._resolve_backend()
        self.repo = self._make_repo(self.backend)

        self._bootstrap()

    # -- vcs backend selection --------------------------------------------
    def _resolve_backend(self) -> str:
        backend = self.settings.get("vcsBackend", "builtin")
        if backend == "git" and not git_available():
            backend = "builtin"  # graceful fallback if git disappeared from PATH
        return backend if backend in VCS_BACKENDS else "builtin"

    def _make_repo(self, backend: str):
        if backend == "git":
            return GitRepo(self.git_dir, MANAGED_FILE)
        return Repo(self._load("repo", None), MANAGED_FILE)

    # -- persistence -------------------------------------------------------
    def _load(self, key: str, initial):
        p = self._paths[key]
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return initial

    def _save(self, key: str, value) -> None:
        self._paths[key].write_text(json.dumps(value, indent=2), encoding="utf-8")

    def _save_repo(self) -> None:
        # The built-in backend persists as JSON; the git backend persists itself on disk.
        if self.backend == "builtin":
            self._save("repo", self.repo.to_dict())

    def _read_seed(self) -> str:
        try:
            return self.seed_file.read_text(encoding="utf-8")
        except Exception:
            return (
                "# ai.fixmsg.properties\n"
                f"# Seed file not found at {self.seed_file}.\n"
                "# Add your own config here (see seed/) to seed instance branches.\n"
            )

    # -- bootstrap (server.ts + bootstrap.ts) ------------------------------
    def _bootstrap(self) -> None:
        seed = self._read_seed()

        # Seed the instance registry (before the repo, so branches follow the registry).
        if not self.instances:
            for code in INSTANCES:
                self.instances.append({
                    "code": code,
                    "environment": environment_of(code),
                    "uat": code == UAT_INSTANCE,
                    "files": [MANAGED_FILE],
                    "locationType": "server",
                    "serverAddress": "",
                    "paths": {},
                })
            self._save("instances", self.instances)

        self._seed_repo_branches(seed)
        self._seed_live()

    def _seed_repo_branches(self, seed: str) -> None:
        """Initialize the repo and one branch per registered instance (both backends)."""
        codes = [i["code"] for i in self.instances]
        if not codes:
            return
        first = codes[0]
        created = self.repo.init(seed, instance_branch(first))
        if not created:
            return
        author = {"name": "Configuration Manager", "email": "config-manager@local"}
        for code in codes[1:]:
            if not self.repo.branch_exists(instance_branch(code)):
                self.repo.create_branch(instance_branch(code), instance_branch(first))
        # any extra managed files listed on an instance get an empty placeholder
        for inst in self.instances:
            for f in inst["files"]:
                if f != MANAGED_FILE and not self.repo.file_exists_at(instance_branch(inst["code"]), f):
                    self.repo.commit_file(instance_branch(inst["code"]), f, "", author,
                                          f"add managed file {f}")
        self._save_repo()

    def _seed_live(self) -> None:
        """Seed 'live' content per instance from repo so Sync is a no-op until drift."""
        changed = False
        for inst in self.instances:
            code = inst["code"]
            key = f"{code}:{MANAGED_FILE}"
            if key not in self.live:
                try:
                    self.live[key] = self.repo.read_file(instance_branch(code))
                    changed = True
                except Exception:
                    pass
        if changed:
            self._save("live", self.live)

    # -- vcs backend switch (Admin) ----------------------------------------
    @staticmethod
    def git_available() -> bool:
        return git_available()

    def switch_vcs_backend(self, target: str, actor: str) -> None:
        if target not in VCS_BACKENDS:
            raise StoreError("unknown backend")
        if target == self.backend:
            return
        if target == "git" and not git_available():
            raise StoreError("git is not installed on this machine")

        previous = self.backend
        # Reset the versioned state only: config history + all changes. Users, the
        # instances registry, settings, and the audit log are kept.
        self.changes = []
        self._save("changes", self.changes)
        _force_rmtree(self.git_dir)
        if self.git_dir.exists():
            raise StoreError("could not remove the existing git repo (data/config-repo); "
                             "close anything using it and try again")
        if self._paths["repo"].exists():
            self._paths["repo"].unlink()
        self.live = {}
        self._save("live", self.live)

        self.settings["vcsBackend"] = target
        self._save("settings", self.settings)
        self.backend = target
        self.repo = self._make_repo(target)

        self._seed_repo_branches(self._read_seed())
        self._seed_live()
        self._audit(actor, "switch-vcs-backend", details={"from": previous, "to": target})

    # -- audit -------------------------------------------------------------
    def _audit(self, windows_id: str, action: str, branch: Optional[str] = None,
               commit: Optional[str] = None, details: Optional[dict] = None) -> None:
        next_id = max((e["id"] for e in self.audit), default=0) + 1
        self.audit.append({
            "id": next_id,
            "timestamp": now_iso(),
            "windowsId": windows_id,
            "action": action,
            "branch": branch,
            "commit": commit,
            "details": details or {},
        })
        self._save("audit", self.audit)

    # =====================================================================
    # Identity (identity.ts)
    # =====================================================================
    def ensure_user(self, windows_id: str) -> dict:
        raw = (windows_id or "").strip()
        if "\\" in raw:
            raw = raw.split("\\")[-1].strip()
        existing = self._find_user(raw)
        if existing:
            return dict(existing, roles=list(existing["roles"]))
        user = {
            "windowsId": raw,
            "displayName": raw,
            "email": "",
            "roles": ["admin"] if len(self.users) == 0 else [],
        }
        self.users.append(user)
        self._save("users", self.users)
        return dict(user, roles=list(user["roles"]))

    def _find_user(self, windows_id: str) -> Optional[dict]:
        return next((u for u in self.users if u["windowsId"] == windows_id), None)

    # =====================================================================
    # Users (admin)
    # =====================================================================
    def list_users(self) -> list[dict]:
        return [dict(u) for u in self.users]

    def create_user(self, windows_id: str, display_name: str = "", email: str = "",
                    roles: Optional[list[str]] = None, actor: str = "") -> dict:
        wid = (windows_id or "").strip()
        if not wid:
            raise StoreError("windowsId required")
        roles = roles or []
        if any(r not in ROLES for r in roles):
            raise StoreError("roles must be a subset of admin, editor, stakeholder")
        user = {
            "windowsId": wid,
            "displayName": (display_name or "").strip() or wid,
            "email": (email or "").strip(),
            "roles": roles,
        }
        existing = self._find_user(wid)
        if existing:
            existing.update(user)
        else:
            self.users.append(user)
        self._save("users", self.users)
        self._audit(actor, "add-user", details={"user": wid, "roles": roles})
        return dict(user)

    def update_user(self, windows_id: str, patch: dict, actor: str = "") -> dict:
        user = self._find_user(windows_id)
        if not user:
            raise StoreError("user not found")
        if "roles" in patch:
            roles = patch["roles"]
            if any(r not in ROLES for r in roles):
                raise StoreError("invalid roles")
            user["roles"] = roles
        if "displayName" in patch:
            user["displayName"] = str(patch["displayName"])
        if "email" in patch:
            user["email"] = str(patch["email"])
        self._save("users", self.users)
        self._audit(actor, "update-user", details={"user": windows_id})
        return dict(user)

    def remove_user(self, windows_id: str, actor: str = "") -> None:
        user = self._find_user(windows_id)
        if not user:
            raise StoreError("user not found")
        self.users.remove(user)
        self._save("users", self.users)
        self._audit(actor, "remove-user", details={"user": windows_id})

    # =====================================================================
    # Settings (admin)
    # =====================================================================
    def _sa_user(self) -> str:
        return self.settings.get("serviceAccountUser") or self.service_account_user

    def _sa_password(self) -> str:
        return self.settings.get("serviceAccountPassword") or self.service_account_password

    def settings_view(self) -> dict:
        return {
            "quantDistributionEmail": self.settings.get("quantDistributionEmail", ""),
            "serviceAccountUser": self._sa_user(),
            "serviceAccountConfigured": len(self._sa_password()) > 0,
            "vcsBackend": self.backend,
            "gitAvailable": git_available(),
        }

    def update_settings(self, patch: dict) -> dict:
        if "quantDistributionEmail" in patch:
            self.settings["quantDistributionEmail"] = str(patch["quantDistributionEmail"]).strip()
        self._save("settings", self.settings)
        return self.settings_view()

    def update_service_account(self, user: Optional[str] = None,
                               password: Optional[str] = None) -> dict:
        """Configure the service account from the UI. The password is stored in the
        local data dir (gitignored) and never returned to the client."""
        if user is not None:
            self.settings["serviceAccountUser"] = str(user).strip()
        if password is not None and password != "":
            self.settings["serviceAccountPassword"] = str(password)
        self._save("settings", self.settings)
        return self.settings_view()

    def clear_service_account_password(self) -> dict:
        self.settings["serviceAccountPassword"] = ""
        self._save("settings", self.settings)
        return self.settings_view()

    # =====================================================================
    # Instances
    # =====================================================================
    def list_instances(self) -> list[dict]:
        return [dict(i) for i in self.instances]

    def get_instance(self, code: str) -> Optional[dict]:
        return next((i for i in self.instances if i["code"] == code), None)

    def _clear_other_uat(self, keep_code: str) -> None:
        for i in self.instances:
            if i["code"] != keep_code:
                i["uat"] = False

    def create_instance(self, code: str, environment: str, uat: bool = False,
                        copy_from: Optional[str] = None, actor: str = "") -> dict:
        if not code or not _CODE_RE.match(code):
            raise StoreError("invalid instance code")
        if environment not in ("pilot", "production"):
            raise StoreError("environment must be pilot|production")
        if self.get_instance(code):
            raise StoreError("instance already exists")
        template = self.get_instance(copy_from) if copy_from else (self.instances[0] if self.instances else None)
        if not template:
            raise StoreError("no template instance to branch from")
        self.repo.create_branch(instance_branch(code), instance_branch(template["code"]))
        inst = {
            "code": code,
            "environment": environment,
            "uat": uat,
            "files": list(template["files"]),
            "locationType": "server",
            "serverAddress": "",
            "paths": {},
        }
        self.instances.append(inst)
        if uat:
            self._clear_other_uat(code)
        # live seed
        try:
            self.live[f"{code}:{MANAGED_FILE}"] = self.repo.read_file(instance_branch(code))
        except Exception:
            pass
        self._save("instances", self.instances)
        self._save("live", self.live)
        self._save_repo()
        self._audit(actor, "create-instance", branch=instance_branch(code),
                    details={"environment": environment, "uat": uat})
        return dict(inst)

    def update_instance(self, code: str, patch: dict, actor: str = "") -> dict:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("instance not found")
        if "environment" in patch:
            if patch["environment"] not in ("pilot", "production"):
                raise StoreError("environment must be pilot|production")
            inst["environment"] = patch["environment"]
        if "locationType" in patch:
            if patch["locationType"] not in LOCATION_TYPES:
                raise StoreError("locationType must be shared|server")
            inst["locationType"] = patch["locationType"]
        if "serverAddress" in patch:
            inst["serverAddress"] = str(patch["serverAddress"])
        if "uat" in patch:
            inst["uat"] = patch["uat"] is True
            if inst["uat"]:
                self._clear_other_uat(code)
        self._save("instances", self.instances)
        self._audit(actor, "update-instance", details=patch)
        return dict(inst)

    def delete_instance(self, code: str, actor: str = "") -> None:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("instance not found")
        self.instances.remove(inst)
        if self.repo.branch_exists(instance_branch(code)):
            self.repo.delete_branch(instance_branch(code))
        self._save("instances", self.instances)
        self._save_repo()
        self._audit(actor, "delete-instance", details={"code": code})

    def add_instance_file(self, code: str, file: str, content: str = "",
                          path: Optional[str] = None, actor: str = "") -> dict:
        file = (file or "").strip()
        if not file or ".." in file or "/" in file or "\\" in file:
            raise StoreError("invalid file name")
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("instance not found")
        branch = instance_branch(code)
        if not self.repo.file_exists_at(branch, file):
            self.repo.commit_file(branch, file, content or "",
                                  {"name": "Configuration Manager", "email": "config-manager@local"},
                                  f"add managed file {file}")
        if file not in inst["files"]:
            inst["files"].append(file)
        if path:
            inst.setdefault("paths", {})[file] = path
        self._save("instances", self.instances)
        self._save_repo()
        self._audit(actor, "add-file", details={"file": file})
        return dict(inst)

    def set_instance_file_path(self, code: str, file: str, path: str) -> dict:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("instance not found")
        inst.setdefault("paths", {})[file] = path
        self._save("instances", self.instances)
        return dict(inst)

    def remove_instance_file(self, code: str, file: str, actor: str = "") -> dict:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("instance not found")
        if file in inst["files"]:
            inst["files"].remove(file)
        inst.get("paths", {}).pop(file, None)
        self._save("instances", self.instances)
        self._audit(actor, "remove-file", details={"file": file})
        return dict(inst)

    def read_instance_file(self, code: str, file: Optional[str] = None) -> dict:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("unknown instance")
        file = file or (inst["files"][0] if inst["files"] else None)
        if not file:
            raise StoreError("no managed file")
        try:
            content = self.repo.read_named_file(instance_branch(code), file)
        except Exception:
            raise StoreError("file not found on instance")
        return {"instance": code, "file": file, "content": content}

    def resolve_file_path(self, code: str, file: str) -> str:
        inst = self.get_instance(code)
        if not inst:
            return file
        base = (inst.get("serverAddress") or "").rstrip("/\\")
        rel = (inst.get("paths", {}).get(file) or file).lstrip("/\\")
        if not base:
            return rel
        sep = "\\" if ("\\" in base or re.match(r"^[a-zA-Z]:", base)) else "/"
        return base + sep + rel

    def sync(self, code: str, actor: str = "") -> dict:
        inst = self.get_instance(code)
        if not inst:
            raise StoreError("unknown instance")
        live = self.live.get(f"{code}:{MANAGED_FILE}")
        if live is None:
            raise StoreError("instance unreachable", code="unreachable")
        recorded = self.repo.read_file(instance_branch(code))
        recorded_sha = hashlib.sha1(recorded.encode("utf-8")).hexdigest()
        live_sha = hashlib.sha1(live.encode("utf-8")).hexdigest()
        in_sync = recorded_sha == live_sha
        drift = {"instance": code, "inSync": in_sync, "recordedSha": recorded_sha, "liveSha": live_sha}
        if in_sync:
            return {"updated": False, **drift}
        commit = self.repo.commit_file(
            instance_branch(code), MANAGED_FILE, live,
            {"name": "Service Account", "email": "service-account@local"},
            f"sync: import live ai.fixmsg.properties from {code}",
        )
        self._save_repo()
        self._audit(actor, "sync-import", branch=instance_branch(code), commit=commit)
        return {"updated": True, "commit": commit, **drift}

    def set_live_content(self, code: str, content: str) -> None:
        """Test/demo hook: mutate an instance's 'live' config to create drift."""
        self.live[f"{code}:{MANAGED_FILE}"] = content
        self._save("live", self.live)

    # =====================================================================
    # Changes
    # =====================================================================
    def list_changes(self) -> list[dict]:
        return [dict(c) for c in self.changes]

    def get_change(self, change_id: str) -> Optional[dict]:
        return next((c for c in self.changes if c["id"] == change_id), None)

    def _next_change_id(self) -> str:
        n = 0
        for c in self.changes:
            try:
                n = max(n, int(c["id"].lstrip("C")))
            except ValueError:
                pass
        return f"C{n + 1}"

    def create_change(self, description: str, items: list[dict], effective_date: Optional[str],
                      created_by: str) -> dict:
        description = (description or "").strip()
        if not description:
            raise StoreError("a change title (description) is required")

        norm_items = []
        for it in items:
            file = str(it.get("file", ""))
            desc = (it.get("description") or "").strip() or description
            insts = [str(x) for x in (it.get("instances") or [])]
            if not file:
                raise StoreError("each modification needs a file")
            if not insts:
                raise StoreError(f"the modification for {file} needs at least one instance")
            for c in insts:
                inst = self.get_instance(c)
                if not inst:
                    raise StoreError(f"unknown instance: {c}")
                if file not in inst["files"]:
                    raise StoreError(f"{c} does not manage {file}")
            norm_items.append({"file": file, "description": desc, "instances": insts})

        change_id = self._next_change_id()

        # Derive targets: unique instances (first-seen order).
        instance_codes: list[str] = []
        for it in norm_items:
            for c in it["instances"]:
                if c not in instance_codes:
                    instance_codes.append(c)
        targets = []
        for c in instance_codes:
            files = []
            for it in norm_items:
                if c in it["instances"] and it["file"] not in files:
                    files.append(it["file"])
            targets.append({
                "instance": c,
                "branch": change_branch(change_id, c),
                "files": files,
                "mergedCommit": None,
            })

        change = {
            "id": change_id,
            "description": description,
            "effectiveDate": effective_date or None,
            "items": norm_items,
            "createdBy": created_by,
            "createdAt": now_iso(),
            "targets": targets,
            "status": "draft",
            "submittedBy": None,
            "submittedAt": None,
            "jiraTickets": [],
            "decision": None,
        }
        self.changes.append(change)
        for t in targets:
            self.repo.create_branch(t["branch"], instance_branch(t["instance"]))
        self._save("changes", self.changes)
        self._save_repo()
        self._audit(created_by, "create-change", details={"changeId": change_id, "instances": instance_codes})
        return dict(change)

    def _resolve_target(self, change: dict, code: str) -> dict:
        target = next((t for t in change["targets"] if t["instance"] == code), None)
        if not target:
            raise StoreError("instance not part of this change")
        return target

    def _resolve_file(self, target: dict, file: str) -> None:
        if file not in target["files"]:
            raise StoreError("file not part of this change for this instance")

    def change_read_file(self, change_id: str, code: str, file: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        target = self._resolve_target(change, code)
        self._resolve_file(target, file)
        return {"instance": code, "file": file,
                "content": self.repo.read_named_file(target["branch"], file)}

    def change_put_file(self, change_id: str, code: str, file: str, content: str,
                        message: str, author: dict) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if not isinstance(content, str):
            raise StoreError("content (string) required")
        message = (message or "").strip()
        if not message:
            raise StoreError("message required")
        target = self._resolve_target(change, code)
        self._resolve_file(target, file)
        commit = self.repo.commit_file(target["branch"], file, content, author, message)
        self._save_repo()
        self._audit(author.get("name", ""), "edit", branch=target["branch"], commit=commit,
                    details={"changeId": change_id, "instance": code, "file": file})
        return {"instance": code, "file": file, "commit": commit}

    def change_diff(self, change_id: str, code: str, file: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        target = self._resolve_target(change, code)
        self._resolve_file(target, file)
        diff = self.repo.diff_named(target["branch"], instance_branch(code), file)
        return {"instance": code, "file": file, "diff": diff}

    def change_analysis(self, change_id: str, code: str, file: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        target = self._resolve_target(change, code)
        self._resolve_file(target, file)
        if file == MANAGED_FILE:
            gate = self._evaluate_gate(self.repo.read_named_file(target["branch"], file))
        else:
            gate = {"findings": [], "errorCount": 0, "warningCount": 0, "infoCount": 0}
        return {"instance": code, "file": file, **gate}

    def _evaluate_gate(self, content: str) -> dict:
        findings = analyze_text(content)
        counts = severity_counts(findings)
        return {
            "findings": [self._finding_dict(f) for f in findings],
            "errorCount": counts["error"],
            "warningCount": counts["warning"],
            "infoCount": counts["info"],
        }

    @staticmethod
    def _finding_dict(f) -> dict:
        return {
            "severity": f.severity,
            "code": f.code,
            "message": f.message,
            "lineNumber": f.line_number,
            "relatedLineNumbers": f.related_line_numbers or [],
        }

    def _instance_gate(self, target: dict) -> dict:
        findings, e, w, i = [], 0, 0, 0
        for file in target["files"]:
            if file != MANAGED_FILE:
                continue
            g = self._evaluate_gate(self.repo.read_named_file(target["branch"], file))
            findings += g["findings"]
            e += g["errorCount"]
            w += g["warningCount"]
            i += g["infoCount"]
        return {"findings": findings, "errorCount": e, "warningCount": w, "infoCount": i}

    # -- workflow transitions ---------------------------------------------
    def submit_change(self, change_id: str, actor: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if change["status"] not in ("draft", "rejected"):
            raise StoreError("change cannot be submitted from its current state")
        change["status"] = "submitted"
        change["submittedBy"] = actor
        change["submittedAt"] = now_iso()
        change["decision"] = None
        self._save("changes", self.changes)
        self._audit(actor, "submit-change", details={"changeId": change_id})
        return dict(change)

    def cancel_change(self, change_id: str, actor: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if change["status"] == "cancelled":
            raise StoreError("change is already cancelled")
        if change["status"] == "merged" or any(t.get("mergedCommit") for t in change["targets"]):
            raise StoreError("a merged change cannot be cancelled")
        change["status"] = "cancelled"
        self._save("changes", self.changes)
        self._audit(actor, "cancel-change", details={"changeId": change_id})
        return dict(change)

    def approve_change(self, change_id: str, actor: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if change["status"] != "submitted":
            raise StoreError("change is not awaiting approval")
        change["status"] = "approved"
        change["decision"] = {"by": actor, "at": now_iso(), "action": "approved"}
        self._save("changes", self.changes)
        self._audit(actor, "approve-change", details={"changeId": change_id})
        return dict(change)

    def reject_change(self, change_id: str, actor: str, reason: str = "") -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if change["status"] != "submitted":
            raise StoreError("change is not awaiting approval")
        change["status"] = "rejected"
        change["decision"] = {"by": actor, "at": now_iso(), "action": "rejected",
                              "reason": (reason or "").strip() or None}
        self._save("changes", self.changes)
        self._audit(actor, "reject-change", details={"changeId": change_id, "reason": reason})
        return dict(change)

    @staticmethod
    def _key_from_url(url: str) -> str:
        try:
            path = urlparse(url).path or url
        except Exception:
            path = url
        segs = [s for s in re.split(r"[/?#]", path) if s]
        return segs[-1] if segs else url

    def set_jira(self, change_id: str, tickets: list[dict], actor: str) -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if change["status"] not in ("approved", "merged"):
            raise StoreError("Jira tickets can be attached once the change is approved.")
        items = change["items"]
        out = []
        seen = set()
        for rec in tickets:
            try:
                item = int(rec.get("item"))
            except (TypeError, ValueError):
                continue
            url = (rec.get("url") or "").strip()
            if item < 0 or item >= len(items) or item in seen or not url:
                continue
            seen.add(item)
            key = (rec.get("key") or "").strip() or self._key_from_url(url)
            out.append({"item": item, "file": items[item]["file"], "key": key, "url": url})
        change["jiraTickets"] = out
        self._save("changes", self.changes)
        self._audit(actor, "attach-jira", details={"jira": [t["key"] for t in out]})
        return dict(change)

    def merge_change(self, change_id: str, code: str, user: dict,
                     acknowledge_warnings: bool = False, override: bool = False,
                     override_reason: str = "") -> dict:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        target = self._resolve_target(change, code)
        if change["status"] != "approved":
            raise StoreError("change is not approved", code="change-not-approved")

        override_reason = (override_reason or "").strip()
        gate = self._instance_gate(target)

        if gate["errorCount"] > 0:
            if not override:
                raise StoreError("blocked by errors", code="blocked-by-errors", extra={"gate": gate})
            if not is_admin(user["roles"]):
                raise StoreError("only an admin can override errors", code="only an admin can override errors", extra={"gate": gate})
            if not override_reason:
                raise StoreError("overrideReason required to override errors", code="overrideReason required to override errors", extra={"gate": gate})

        if gate["warningCount"] > 0 and not acknowledge_warnings:
            raise StoreError("warnings need acknowledgement", code="warnings-need-acknowledgement", extra={"gate": gate})

        author = {"name": user["displayName"], "email": user["email"] or f"{user['windowsId']}@local"}
        result = self.repo.merge(target["branch"], author, instance_branch(code))
        if not result["ok"]:
            raise StoreError("merge conflict", code="merge-conflict", extra={"conflicts": result["conflicts"]})

        target["mergedCommit"] = result["commit"]
        if all(t.get("mergedCommit") for t in change["targets"]):
            change["status"] = "merged"
        # keep live in sync with the newly merged instance content
        self.live[f"{code}:{MANAGED_FILE}"] = self.repo.read_file(instance_branch(code))
        self._save("changes", self.changes)
        self._save("live", self.live)
        self._save_repo()
        self._audit(user["windowsId"], "merge", branch=instance_branch(code), commit=result["commit"],
                    details={
                        "changeId": change_id, "instance": code,
                        "acknowledgedWarnings": acknowledge_warnings and gate["warningCount"] > 0,
                        "override": override and gate["errorCount"] > 0,
                        "overrideReason": override_reason if (override and gate["errorCount"] > 0) else None,
                    })
        return {"merged": True, "instance": code, "commit": result["commit"]}

    # -- emails ------------------------------------------------------------
    def build_email(self, change_id: str, kind: str, user: dict) -> tuple[str, str]:
        change = self.get_change(change_id)
        if not change:
            raise StoreError("change not found")
        if kind not in ("approval", "recap"):
            raise StoreError("unknown email kind")
        if kind == "approval" and change["status"] != "submitted":
            raise StoreError("The approval email is only available once the change is submitted for approval.")
        if kind == "recap" and change["status"] != "merged":
            raise StoreError("The recap email is only available after the change is merged.")
        sender = user["displayName"] or user["windowsId"]
        if kind == "approval":
            recipients = [u["email"] for u in self.users if can_approve(u["roles"]) and u["email"]]
            distro = self.settings.get("quantDistributionEmail", "")
            cc = [distro] if distro else []
            email = email_drafts.approval_email(change, recipients, cc, self.app_base_url, sender)
        else:
            email = email_drafts.recap_email(change, self.app_base_url, sender)
        return email_drafts.to_eml(email), f"change-{change_id}-{kind}.eml"

    # -- history -----------------------------------------------------------
    def history(self) -> dict:
        return {"commits": self.repo.log(), "audit": list(self.audit)}

    def commit(self, commit_hash: str) -> dict:
        try:
            return self.repo.commit_detail(commit_hash)
        except Exception:
            raise StoreError("commit not found")
