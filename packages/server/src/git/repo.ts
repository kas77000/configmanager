import { mkdir, writeFile } from 'node:fs/promises';
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
}

export interface MergeResult {
  ok: boolean;
  commit?: string;
  conflicts?: string[];
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
    const inside = await runGit(this.dir, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code === 0) return false;

    await git(this.dir, ['init', '-b', initialBranch]);
    await git(this.dir, ['config', 'user.name', 'Configuration Manager']);
    await git(this.dir, ['config', 'user.email', 'config-manager@local']);
    await git(this.dir, ['config', 'core.autocrlf', 'false']);
    await writeFile(join(this.dir, this.file), seedContent);
    await git(this.dir, ['add', this.file]);
    await git(this.dir, ['commit', '-m', `seed: initial import of ${this.file}`]);
    return true;
  }

  async listBranches(): Promise<string[]> {
    const out = await git(this.dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async createBranch(name: string, from = this.mainBranch): Promise<void> {
    if (!isValidBranchName(name)) throw new Error(`invalid branch name: ${name}`);
    await this.serialize(() => git(this.dir, ['branch', name, from]));
  }

  /** Returns the file's content at a ref/branch without checking it out. */
  async readFile(ref: string): Promise<string> {
    return git(this.dir, ['show', `${ref}:${this.file}`]);
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

  /** Commit graph across all branches, newest first. */
  async log(): Promise<CommitInfo[]> {
    const sep = '\x1f';
    const fmt = ['%H', '%an', '%ae', '%aI', '%P', '%D', '%s'].join(sep);
    const out = await git(this.dir, ['log', '--all', `--pretty=format:${fmt}`]);
    if (out.trim() === '') return [];
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
        };
      });
  }
}
