"""Official-git backend — drives the real `git` CLI, mirroring the original
server/src/git/repo.ts. Exposes the same interface as the built-in `vcs.Repo`,
so `Store` can swap between the two with no other code changes.

Requires the `git` binary on PATH (see `git_available`). All mutating operations
check out branches in a single working tree, so they are serialized with a lock.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Optional

_SEP = "\x1f"
_FMT = f"%H{_SEP}%an{_SEP}%ae{_SEP}%aI{_SEP}%P{_SEP}%s"
_DIFF_FILE_RE = re.compile(r"^diff --git a/.+ b/(.+)$")


def git_available() -> bool:
    return shutil.which("git") is not None


def _short(h: str) -> str:
    return h[:7]


class GitRepo:
    def __init__(self, repo_dir: Path, managed_file: str = "ai.fixmsg.properties"):
        self.dir = Path(repo_dir)
        self.managed_file = managed_file
        self._lock = threading.RLock()

    # -- persistence (git persists itself on disk) -------------------------
    def to_dict(self) -> dict:
        return {"backend": "git"}

    # -- process helpers ---------------------------------------------------
    def _run(self, args: list[str]) -> tuple[int, str, str]:
        proc = subprocess.run(
            ["git", "-C", str(self.dir), *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return proc.returncode, proc.stdout, proc.stderr

    def _git(self, args: list[str]) -> str:
        code, out, err = self._run(args)
        if code != 0:
            raise RuntimeError(f"git {' '.join(args)} failed: {err.strip() or out.strip()}")
        return out

    # -- branch primitives -------------------------------------------------
    def branch_exists(self, name: str) -> bool:
        code, _, _ = self._run(["rev-parse", "--verify", "--quiet", f"refs/heads/{name}"])
        return code == 0

    def head(self, branch: str) -> Optional[dict]:
        if not self.branch_exists(branch):
            return None
        return {"hash": self._git(["rev-parse", branch]).strip()}

    def init(self, seed_content: str, initial_branch: str) -> bool:
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            if (self.dir / ".git").exists():
                return False
            self._git(["init", "-b", initial_branch])
            self._git(["config", "user.name", "Configuration Manager"])
            self._git(["config", "user.email", "config-manager@local"])
            self._git(["config", "core.autocrlf", "false"])
            (self.dir / self.managed_file).write_text(seed_content, encoding="utf-8", newline="")
            self._git(["add", self.managed_file])
            self._git(["commit", "-m", "seed: initial import of ai.fixmsg.properties"])
            return True

    def create_branch(self, name: str, from_branch: str) -> None:
        with self._lock:
            self._git(["branch", name, from_branch])

    def delete_branch(self, name: str) -> None:
        with self._lock:
            # move off the branch first so git will delete it
            current = self._git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
            if current == name:
                other = next((b for b in self._branches() if b != name), None)
                if other:
                    self._git(["checkout", "-f", other])
            self._run(["branch", "-D", name])

    # -- reads -------------------------------------------------------------
    def read_file(self, branch: str) -> str:
        return self.read_named_file(branch, self.managed_file)

    def read_named_file(self, branch: str, file: str) -> str:
        return self._git(["show", f"{branch}:{file}"])

    def file_exists_at(self, branch: str, file: str) -> bool:
        code, _, _ = self._run(["cat-file", "-e", f"{branch}:{file}"])
        return code == 0

    # -- writes ------------------------------------------------------------
    def commit_file(self, branch: str, file: str, content: str, author: dict, message: str) -> str:
        with self._lock:
            self._git(["checkout", "-f", branch])
            (self.dir / file).write_text(content, encoding="utf-8", newline="")
            self._git(["add", file])
            who = f'{author.get("name", "Unknown")} <{author.get("email", "unknown@local")}>'
            # --allow-empty keeps parity with the built-in store (which always commits)
            self._git(["commit", "--allow-empty", "-m", message, "--author", who])
            return self._git(["rev-parse", "HEAD"]).strip()

    # -- merge -------------------------------------------------------------
    def merge(self, branch: str, author: dict, into: str) -> dict:
        with self._lock:
            self._git(["checkout", "-f", into])
            name = author.get("name", "Unknown")
            email = author.get("email", "unknown@local")
            code, _, _ = self._run([
                "-c", f"user.name={name}", "-c", f"user.email={email}",
                "merge", "--no-ff", "-m", f"Merge {branch} into {into}", branch,
            ])
            if code == 0:
                return {"ok": True, "commit": self._git(["rev-parse", "HEAD"]).strip()}
            conflicts = [c for c in self._git(["diff", "--name-only", "--diff-filter=U"]).splitlines() if c]
            self._run(["merge", "--abort"])
            return {"ok": False, "conflicts": conflicts}

    def diff_named(self, branch: str, base_branch: str, file: str) -> str:
        code, out, _ = self._run(["diff", f"{base_branch}...{branch}", "--", file])
        return out

    # -- history -----------------------------------------------------------
    def _branches(self) -> list[str]:
        out = self._git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
        return [b for b in out.splitlines() if b]

    def _instance_membership(self) -> dict[str, list[str]]:
        membership: dict[str, list[str]] = {}
        for branch in self._branches():
            if not branch.startswith("instance/"):
                continue
            code = branch.split("/", 1)[1]
            for h in self._git(["rev-list", branch]).splitlines():
                membership.setdefault(h, [])
                if code not in membership[h]:
                    membership[h].append(code)
        return membership

    @staticmethod
    def _parse_line(line: str) -> dict:
        h, an, ae, ai, parents, subject = (line.split(_SEP) + [""] * 6)[:6]
        return {
            "hash": h, "short": _short(h), "authorName": an, "authorEmail": ae,
            "date": ai, "parents": [p for p in parents.split(" ") if p], "subject": subject,
        }

    def log(self) -> list[dict]:
        if not (self.dir / ".git").exists():
            return []
        code, out, _ = self._run(["log", "--all", f"--pretty=format:{_FMT}"])
        if code != 0 or not out.strip():
            return []
        membership = self._instance_membership()
        commits = []
        for line in out.splitlines():
            if not line.strip():
                continue
            c = self._parse_line(line)
            c["instances"] = membership.get(c["hash"], [])
            commits.append(c)
        return commits

    def commit_detail(self, commit_hash: str) -> dict:
        if not re.match(r"^[0-9a-fA-F]{4,40}$", commit_hash):
            raise ValueError("commit not found")
        meta = self._git(["show", "-s", f"--format={_FMT}", commit_hash]).strip()
        c = self._parse_line(meta)

        numstat = self._git(["show", commit_hash, "--numstat", "--format="])
        stats: dict[str, tuple[int, int]] = {}
        for row in numstat.splitlines():
            parts = row.split("\t")
            if len(parts) == 3:
                adds = int(parts[0]) if parts[0].isdigit() else 0
                dels = int(parts[1]) if parts[1].isdigit() else 0
                stats[parts[2]] = (adds, dels)

        patch = self._git(["show", commit_hash, "--patch", "--format="])
        patches = self._split_patch_by_file(patch)

        contains = self._git(["branch", "--contains", commit_hash, "--format=%(refname:short)"])
        instances = []
        for ref in contains.splitlines():
            ref = ref.strip()
            if ref.startswith("instance/"):
                inst = ref.split("/", 1)[1]
            elif ref.startswith("change/"):
                inst = ref.split("/")[-1]
            else:
                continue
            if inst not in instances:
                instances.append(inst)

        files = []
        for f in sorted(set(stats) | set(patches)):
            adds, dels = stats.get(f, (0, 0))
            files.append({"file": f, "additions": adds, "deletions": dels, "patch": patches.get(f, "")})

        c["instances"] = instances
        c["files"] = files
        return c

    @staticmethod
    def _split_patch_by_file(patch: str) -> dict[str, str]:
        out: dict[str, str] = {}
        current_file = None
        current: list[str] = []
        for line in patch.splitlines():
            m = _DIFF_FILE_RE.match(line)
            if m:
                if current_file is not None:
                    out[current_file] = "\n".join(current)
                current_file = m.group(1)
                current = [line]
            elif current_file is not None:
                current.append(line)
        if current_file is not None:
            out[current_file] = "\n".join(current)
        return out
