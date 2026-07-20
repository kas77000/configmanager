"""Lightweight, self-contained version control — a JSON-backed stand-in for the
original git-CLI `ConfigRepo`.

The upstream app kept each instance's canonical config on a long-lived git branch
(`instance/<CODE>`) and edited changes on working branches (`change/<id>/<CODE>`),
merging with `git merge --no-ff`. To make the Streamlit port runnable anywhere
without a `git` install, this module reproduces that model in pure Python:

- A "branch" is an ordered list of commits (oldest -> newest); HEAD is the last.
- A commit snapshots every managed file's full content, plus parent hashes.
- `create_branch` forks a branch at the source's current HEAD (shared commit).
- `merge` does a real 3-way line merge against the fork point and reports
  conflicting files, mirroring git's behaviour closely enough for the workflow.

Diffs are unified diffs (difflib). Commit hashes are sha1 hex, displayed short.
"""
from __future__ import annotations

import difflib
import hashlib
from datetime import datetime, timezone
from typing import Optional


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _short(h: str) -> str:
    return h[:7]


def three_way_merge(base: str, ours: str, theirs: str) -> tuple[bool, Optional[str], bool]:
    """Line-based 3-way merge. Returns (ok, merged_text, had_conflict).

    Non-overlapping edits from both sides are combined; overlapping edits to the
    same base region conflict (as git would)."""
    if ours == theirs:
        return True, ours, False
    if base == ours:
        return True, theirs, False
    if base == theirs:
        return True, ours, False

    b = base.split("\n")
    o = ours.split("\n")
    t = theirs.split("\n")

    def edits(a_lines: list[str], c_lines: list[str]):
        sm = difflib.SequenceMatcher(a=a_lines, b=c_lines, autojunk=False)
        res = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != "equal":
                res.append((i1, i2, c_lines[j1:j2]))
        return res

    oe = edits(b, o)
    te = edits(b, t)

    def overlaps(e1, e2) -> bool:
        for (i1, i2, _) in e1:
            for (k1, k2, _) in e2:
                if i1 < k2 and k1 < i2:
                    return True
                if i1 == i2 and k1 == k2 and i1 == k1:  # both insert at same point
                    return True
        return False

    if overlaps(oe, te):
        return False, None, True

    combined = sorted(oe + te, key=lambda e: (e[0], e[1]))
    out: list[str] = []
    pos = 0
    for (i1, i2, repl) in combined:
        out.extend(b[pos:i1])
        out.extend(repl)
        pos = i2
    out.extend(b[pos:])
    return True, "\n".join(out), False


def unified_diff(base_text: str, new_text: str, path: str) -> str:
    base_lines = base_text.splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    diff = difflib.unified_diff(
        base_lines, new_lines, fromfile=f"a/{path}", tofile=f"b/{path}", n=3
    )
    return "".join(diff)


def diff_stats(base_text: str, new_text: str) -> tuple[int, int]:
    """Returns (additions, deletions) counting changed content lines."""
    additions = deletions = 0
    for line in difflib.unified_diff(base_text.split("\n"), new_text.split("\n"), lineterm=""):
        if line.startswith("+") and not line.startswith("+++"):
            additions += 1
        elif line.startswith("-") and not line.startswith("---"):
            deletions += 1
    return additions, deletions


class Repo:
    """A collection of branches, each an ordered list of file-snapshot commits."""

    def __init__(self, data: Optional[dict] = None, managed_file: str = "ai.fixmsg.properties"):
        self.managed_file = managed_file
        self.data = data or {"branches": {}, "counter": 0}
        self.data.setdefault("branches", {})
        self.data.setdefault("counter", 0)

    # -- serialization -----------------------------------------------------
    def to_dict(self) -> dict:
        return self.data

    @property
    def branches(self) -> dict:
        return self.data["branches"]

    # -- hashing -----------------------------------------------------------
    def _new_hash(self, message: str, files: dict) -> str:
        self.data["counter"] += 1
        payload = f"{self.data['counter']}|{message}|{now_iso()}|{sorted(files.items())}"
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    # -- branch primitives -------------------------------------------------
    def branch_exists(self, name: str) -> bool:
        return name in self.branches and len(self.branches[name]) > 0

    def head(self, branch: str) -> Optional[dict]:
        commits = self.branches.get(branch)
        return commits[-1] if commits else None

    def init(self, seed_content: str, initial_branch: str) -> bool:
        if self.branch_exists(initial_branch):
            return False
        files = {self.managed_file: seed_content}
        commit = {
            "hash": self._new_hash("seed", files),
            "parents": [],
            "author_name": "Configuration Manager",
            "author_email": "config-manager@local",
            "date": now_iso(),
            "message": "seed: initial import of ai.fixmsg.properties",
            "files": files,
        }
        self.branches[initial_branch] = [commit]
        return True

    def create_branch(self, name: str, from_branch: str) -> None:
        src_head = self.head(from_branch)
        if src_head is None:
            raise ValueError(f"no source branch to fork: {from_branch}")
        # New branch shares the source HEAD commit as its base (same hash).
        self.branches[name] = [src_head]

    def delete_branch(self, name: str) -> None:
        self.branches.pop(name, None)

    # -- reads -------------------------------------------------------------
    def read_file(self, branch: str) -> str:
        return self.read_named_file(branch, self.managed_file)

    def read_named_file(self, branch: str, file: str) -> str:
        head = self.head(branch)
        if head is None or file not in head["files"]:
            raise ValueError(f"file not found: {branch}:{file}")
        return head["files"][file]

    def file_exists_at(self, branch: str, file: str) -> bool:
        head = self.head(branch)
        return head is not None and file in head["files"]

    # -- writes ------------------------------------------------------------
    def commit_file(self, branch: str, file: str, content: str, author: dict, message: str) -> str:
        head = self.head(branch)
        files = dict(head["files"]) if head else {}
        files[file] = content
        commit = {
            "hash": self._new_hash(message, files),
            "parents": [head["hash"]] if head else [],
            "author_name": author.get("name", "Unknown"),
            "author_email": author.get("email", "unknown@local"),
            "date": now_iso(),
            "message": message,
            "files": files,
        }
        self.branches.setdefault(branch, []).append(commit)
        return commit["hash"]

    # -- merge base --------------------------------------------------------
    def _merge_base(self, branch_a: str, branch_b: str) -> Optional[dict]:
        hashes_b = {c["hash"] for c in self.branches.get(branch_b, [])}
        for commit in reversed(self.branches.get(branch_a, [])):
            if commit["hash"] in hashes_b:
                return commit
        return None

    def diff_named(self, branch: str, base_branch: str, file: str) -> str:
        base = self._merge_base(branch, base_branch)
        base_content = base["files"].get(file, "") if base else ""
        new_content = self.read_named_file(branch, file)
        return unified_diff(base_content, new_content, file)

    def merge(self, branch: str, author: dict, into: str) -> dict:
        """3-way merge `branch` into `into`. Returns
        {ok, commit?, conflicts?}."""
        base = self._merge_base(branch, into)
        base_files = base["files"] if base else {}
        ours = self.head(into)["files"] if self.head(into) else {}
        theirs = self.head(branch)["files"] if self.head(branch) else {}

        all_files = set(base_files) | set(ours) | set(theirs)
        merged: dict[str, str] = {}
        conflicts: list[str] = []
        for f in sorted(all_files):
            b = base_files.get(f, "")
            o = ours.get(f, b)
            t = theirs.get(f, b)
            ok, text, _ = three_way_merge(b, o, t)
            if not ok:
                conflicts.append(f)
            else:
                merged[f] = text

        if conflicts:
            return {"ok": False, "conflicts": conflicts}

        into_head = self.head(into)
        branch_head = self.head(branch)
        commit = {
            "hash": self._new_hash(f"Merge {branch} into {into}", merged),
            "parents": [into_head["hash"] if into_head else None,
                        branch_head["hash"] if branch_head else None],
            "author_name": author.get("name", "Unknown"),
            "author_email": author.get("email", "unknown@local"),
            "date": now_iso(),
            "message": f"Merge {branch} into {into}",
            "files": merged,
        }
        self.branches.setdefault(into, []).append(commit)
        return {"ok": True, "commit": commit["hash"]}

    # -- history -----------------------------------------------------------
    def _instance_membership(self) -> dict[str, list[str]]:
        """Map commit hash -> list of instance codes whose branch contains it."""
        membership: dict[str, list[str]] = {}
        for branch, commits in self.branches.items():
            if not branch.startswith("instance/"):
                continue
            code = branch.split("/", 1)[1]
            for c in commits:
                membership.setdefault(c["hash"], [])
                if code not in membership[c["hash"]]:
                    membership[c["hash"]].append(code)
        return membership

    def _all_commits(self) -> dict[str, dict]:
        seen: dict[str, dict] = {}
        for commits in self.branches.values():
            for c in commits:
                seen[c["hash"]] = c
        return seen

    def log(self) -> list[dict]:
        membership = self._instance_membership()
        commits = list(self._all_commits().values())
        commits.sort(key=lambda c: c["date"], reverse=True)
        out = []
        for c in commits:
            out.append({
                "hash": c["hash"],
                "short": _short(c["hash"]),
                "authorName": c["author_name"],
                "authorEmail": c["author_email"],
                "date": c["date"],
                "parents": [p for p in c["parents"] if p],
                "subject": c["message"],
                "instances": membership.get(c["hash"], []),
            })
        return out

    def commit_detail(self, commit_hash: str) -> dict:
        commits = self._all_commits()
        # allow short-hash lookup
        full = commit_hash
        if commit_hash not in commits:
            matches = [h for h in commits if h.startswith(commit_hash)]
            if len(matches) == 1:
                full = matches[0]
            else:
                raise ValueError("commit not found")
        c = commits[full]
        parent = commits.get(c["parents"][0]) if c["parents"] and c["parents"][0] else None
        parent_files = parent["files"] if parent else {}

        files = []
        all_files = set(parent_files) | set(c["files"])
        for f in sorted(all_files):
            before = parent_files.get(f, "")
            after = c["files"].get(f, "")
            if before == after:
                continue
            adds, dels = diff_stats(before, after)
            files.append({
                "file": f,
                "additions": adds,
                "deletions": dels,
                "patch": unified_diff(before, after, f),
            })

        membership = self._instance_membership()
        return {
            "hash": c["hash"],
            "short": _short(c["hash"]),
            "authorName": c["author_name"],
            "authorEmail": c["author_email"],
            "date": c["date"],
            "parents": [p for p in c["parents"] if p],
            "subject": c["message"],
            "instances": membership.get(c["hash"], []),
            "files": files,
        }
