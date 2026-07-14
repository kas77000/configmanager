import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigRepo } from '../src/git/repo';

const FILE = 'ai.fixmsg.properties';
const SEED = 'line1\nline2\nline3\n';
const AUTHOR = { name: 'Alice Example', email: 'alice@example.com' };

async function newRepo(): Promise<ConfigRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'cfgrepo-'));
  const repo = new ConfigRepo(dir, FILE);
  await repo.init(SEED);
  return repo;
}

describe('ConfigRepo', () => {
  it('seeds main with the initial content', async () => {
    const repo = await newRepo();
    expect(await repo.readFile('main')).toBe(SEED);
    expect(await repo.listBranches()).toEqual(['main']);
    await rm(repo.dir, { recursive: true, force: true });
  });

  it('isolates edits on a branch and records the author', async () => {
    const repo = await newRepo();
    await repo.createBranch('feature');
    const changed = 'line1\nCHANGED\nline3\n';
    const hash = await repo.writeCommit('feature', changed, AUTHOR, 'edit line2');

    expect(await repo.readFile('feature')).toBe(changed);
    expect(await repo.readFile('main')).toBe(SEED); // main untouched

    const log = await repo.log();
    const commit = log.find((c) => c.hash === hash);
    expect(commit?.authorName).toBe('Alice Example');
    expect(commit?.authorEmail).toBe('alice@example.com');
    await rm(repo.dir, { recursive: true, force: true });
  });

  it('produces a diff of a branch against main', async () => {
    const repo = await newRepo();
    await repo.createBranch('feature');
    await repo.writeCommit('feature', 'line1\nCHANGED\nline3\n', AUTHOR, 'edit');
    const diff = await repo.diff('feature');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+CHANGED');
    await rm(repo.dir, { recursive: true, force: true });
  });

  it('cleanly merges a non-conflicting branch into main', async () => {
    const repo = await newRepo();
    await repo.createBranch('feature');
    await repo.writeCommit('feature', 'line1\nline2\nCHANGED3\n', AUTHOR, 'edit line3');
    const result = await repo.merge('feature', AUTHOR);
    expect(result.ok).toBe(true);
    expect(await repo.readFile('main')).toBe('line1\nline2\nCHANGED3\n');
    await rm(repo.dir, { recursive: true, force: true });
  });

  it('reports a conflict and leaves main clean', async () => {
    const repo = await newRepo();
    await repo.createBranch('a');
    await repo.createBranch('b');
    await repo.writeCommit('a', 'line1\nAAA\nline3\n', AUTHOR, 'a edits line2');
    await repo.writeCommit('b', 'line1\nBBB\nline3\n', AUTHOR, 'b edits line2');

    const first = await repo.merge('a', AUTHOR);
    expect(first.ok).toBe(true);

    const second = await repo.merge('b', AUTHOR);
    expect(second.ok).toBe(false);
    expect(second.conflicts).toContain(FILE);
    // main still holds a's version; repo is not left mid-merge
    expect(await repo.readFile('main')).toBe('line1\nAAA\nline3\n');
    await rm(repo.dir, { recursive: true, force: true });
  });
});
