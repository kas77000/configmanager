import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, runGit } from './run-git';

export interface Author {
  name: string;
  email: string;
}

export interface CommitInfo {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string;
  subject: string;
  /** Instance codes whose branch history contains this commit. */
  instances: string[];
}

export interface MergeResult {
  ok: boolean;
  commit?: string;
  conflicts?: string[];
}

export interface CommitFileChange {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CommitDetail {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  parents: string[];
  refs: string;
  subject: string;
  /** Instances whose branches contain this commit. */
  instances: string[];
  files: CommitFileChange[];
}

/** Splits a `git show --patch` body into per-file chunks. */
function splitPatchByFile(patch: string): { file: string; patch: string }[] {
  const chunks: { file: string; patch: string }[] = [];
  let current: { file: string; lines: string[] } | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) chunks.push({ file: current.file, patch: current.lines.join('\n') });
      const m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      current = { file: m ? m[1] : line, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chunks.push({ file: current.file, patch: current.lines.join('\n') });
  return chunks;
}

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

export function isValidBranchName(name: string): boolean {
  return BRANCH_RE.test(name) && !name.startsWith('-') && !name.includes('..');
}

/** A Git-backed store for a single managed config file. Write/merge ops are serialized. */
export class ConfigRepo {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly dir: string,
    public readonly file: string,
    public readonly mainBranch = 'main',
  ) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Creates the repo if absent, seeding `file` with `seedContent` on `initialBranch`.
   * Returns true if it created the repo, false if it already existed (so callers can
   * seed additional branches only once).
   */
  async init(seedContent: string, initialBranch: string = this.mainBranch): Promise<boolean> {
    await mkdir(this.dir, { recursive: true });
    // Detect OUR repo by its own .git, not `rev-parse` — the managed dir may live inside a
    // parent worktree (e.g. under the app repo), where rev-parse would report the parent.
    if (await this.hasOwnGitDir()) return false;

    await git(this.dir, ['init', '-b', initialBranch]);
    await git(this.dir, ['config', 'user.name', 'Configuration Manager']);
    await git(this.dir, ['config', 'user.email', 'config-manager@local']);
    await git(this.dir, ['config', 'core.autocrlf', 'false']);
    await writeFile(join(this.dir, this.file), seedContent);
    await git(this.dir, ['add', this.file]);
    await git(this.dir, ['commit', '-m', `seed: initial import of ${this.file}`]);
    return true;
  }

  private async hasOwnGitDir(): Promise<boolean> {
    try {
      await stat(join(this.dir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async listBranches(): Promise<string[]> {
    const out = await git(this.dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async createBranch(name: string, from = this.mainBranch): Promise<void> {
    if (!isValidBranchName(name)) throw new Error(`invalid branch name: ${name}`);
    await this.serialize(() => git(this.dir, ['branch', name, from]));
  }

  /** Returns the managed file's content at a ref/branch without checking it out. */
  async readFile(ref: string): Promise<string> {
    return git(this.dir, ['show', `${ref}:${this.file}`]);
  }

  /** Returns a named file's content at a ref/branch. */
  async readNamedFile(ref: string, file: string): Promise<string> {
    return git(this.dir, ['show', `${ref}:${file}`]);
  }

  async fileExistsAt(ref: string, file: string): Promise<boolean> {
    return (await runGit(this.dir, ['cat-file', '-e', `${ref}:${file}`])).code === 0;
  }

  /** Writes `content` on `branch` and commits it authored by `author`. Returns the new commit hash. */
  async writeCommit(branch: string, content: string, author: Author, message: string): Promise<string> {
    if (!isValidBranchName(branch)) throw new Error(`invalid branch name: ${branch}`);
    return this.serialize(async () => {
      await git(this.dir, ['checkout', branch]);
      await writeFile(join(this.dir, this.file), content);
      await git(this.dir, ['add', this.file]);
      const res = await runGit(this.dir, [
        'commit',
        '-m',
        message,
        '--author',
        `${author.name} <${author.email}>`,
      ]);
      if (res.code !== 0) {
        throw new Error(`commit failed: ${res.stderr || res.stdout}`);
      }
      return (await git(this.dir, ['rev-parse', 'HEAD'])).trim();
    });
  }

  /** Unified diff of `branch` against `base`, limited to the managed file. */
  async diff(branch: string, base = this.mainBranch): Promise<string> {
    return git(this.dir, ['diff', `${base}...${branch}`, '--', this.file]);
  }

  /** Unified diff of `branch` against `base` for a named file. */
  async diffNamed(branch: string, base: string, file: string): Promise<string> {
    return git(this.dir, ['diff', `${base}...${branch}`, '--', file]);
  }

  /** 3-way merges `branch` into `into`, committed by `author`. Aborts cleanly on conflict. */
  async merge(branch: string, author: Author, into = this.mainBranch): Promise<MergeResult> {
    if (!isValidBranchName(branch)) throw new Error(`invalid branch name: ${branch}`);
    return this.serialize(async () => {
      await git(this.dir, ['checkout', into]);
      const res = await runGit(this.dir, [
        '-c',
        `user.name=${author.name}`,
        '-c',
        `user.email=${author.email}`,
        'merge',
        '--no-ff',
        '-m',
        `Merge ${branch} into ${into}`,
        branch,
      ]);
      if (res.code === 0) {
        return { ok: true, commit: (await git(this.dir, ['rev-parse', 'HEAD'])).trim() };
      }
      const conflictOut = await runGit(this.dir, ['diff', '--name-only', '--diff-filter=U']);
      const conflicts = conflictOut.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      await runGit(this.dir, ['merge', '--abort']);
      return { ok: false, conflicts };
    });
  }

  async branchExists(name: string): Promise<boolean> {
    return (await runGit(this.dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])).code === 0;
  }

  /** Deletes a branch, first checking out another so git never refuses the current branch. */
  async deleteBranch(name: string): Promise<void> {
    return this.serialize(async () => {
      const others = (await this.listBranches()).filter((b) => b !== name);
      if (others.length > 0) await git(this.dir, ['checkout', others[0]]);
      await git(this.dir, ['branch', '-D', name]);
    });
  }

  /** Writes/commits a single named file on a branch (used to add or update a managed file). */
  async commitFile(branch: string, file: string, content: string, author: Author, message: string): Promise<string> {
    if (!isValidBranchName(branch)) throw new Error(`invalid branch name: ${branch}`);
    return this.serialize(async () => {
      await git(this.dir, ['checkout', branch]);
      await writeFile(join(this.dir, file), content);
      await git(this.dir, ['add', file]);
      const res = await runGit(this.dir, ['commit', '-m', message, '--author', `${author.name} <${author.email}>`]);
      if (res.code !== 0) throw new Error(`commit failed: ${res.stderr || res.stdout}`);
      return (await git(this.dir, ['rev-parse', 'HEAD'])).trim();
    });
  }

  /** Full patch for a single commit (metadata + diff), for the history commit view. */
  async showCommit(hash: string): Promise<string> {
    if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('invalid commit hash');
    return git(this.dir, ['show', hash, '--patch', '--format=fuller']);
  }

  /** Structured detail for one commit: metadata, which instances it touches, and per-file diffs. */
  async commitDetail(hash: string): Promise<CommitDetail> {
    if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('invalid commit hash');
    const sep = '\x1f';
    const fmt = ['%H', '%an', '%ae', '%aI', '%P', '%D', '%s'].join(sep);
    const [meta, numstat, patch, contains] = await Promise.all([
      git(this.dir, ['show', '-s', `--format=${fmt}`, hash]),
      git(this.dir, ['show', hash, '--numstat', '--format=']),
      git(this.dir, ['show', hash, '--patch', '--format=']),
      runGit(this.dir, ['branch', '--contains', hash, '--format=%(refname:short)']),
    ]);

    const [h, authorName, authorEmail, date, parents, refs, subject] = meta.trim().split(sep);

    const stats = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        stats.set(parts[2], { additions: Number(parts[0]) || 0, deletions: Number(parts[1]) || 0 });
      }
    }

    const files = splitPatchByFile(patch).map((f) => ({
      file: f.file,
      additions: stats.get(f.file)?.additions ?? 0,
      deletions: stats.get(f.file)?.deletions ?? 0,
      patch: f.patch,
    }));

    const instances = new Set<string>();
    for (const ref of contains.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (ref.startsWith('instance/')) instances.add(ref.slice('instance/'.length));
      else if (ref.startsWith('change/')) { const seg = ref.split('/'); instances.add(seg[seg.length - 1]); }
    }

    return {
      hash: h,
      authorName,
      authorEmail,
      date,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: refs ?? '',
      subject: subject ?? '',
      instances: [...instances],
      files,
    };
  }

  /** Commit graph across all branches, newest first. */
  async log(): Promise<CommitInfo[]> {
    const sep = '\x1f';
    const fmt = ['%H', '%an', '%ae', '%aI', '%P', '%D', '%s'].join(sep);
    const out = await git(this.dir, ['log', '--all', `--pretty=format:${fmt}`]);
    if (out.trim() === '') return [];

    // Map each commit to the instance branches whose history contains it.
    const membership = new Map<string, string[]>();
    for (const branch of await this.listBranches()) {
      if (!branch.startsWith('instance/')) continue;
      const code = branch.slice('instance/'.length);
      const hashes = (await git(this.dir, ['rev-list', branch])).split('\n').filter(Boolean);
      for (const h of hashes) {
        const arr = membership.get(h) ?? [];
        arr.push(code);
        membership.set(h, arr);
      }
    }

    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, authorName, authorEmail, date, parents, refs, subject] = line.split(sep);
        return {
          hash,
          authorName,
          authorEmail,
          date,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          refs: refs ?? '',
          subject: subject ?? '',
          instances: membership.get(hash) ?? [],
        };
      });
  }
}
