import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/store/json-store';
import { UserDirectory, type User } from '../src/store/users';
import { AuditLog, type AuditEvent } from '../src/store/audit';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cfgstore-'));
}

describe('UserDirectory', () => {
  it('makes the first user admin, then auto-registers later ones as pending', async () => {
    const dir = await tmp();
    const users = new UserDirectory(new JsonStore<User[]>(join(dir, 'users.json'), []));
    const first = await users.ensure('root');
    expect(first.roles).toEqual(['admin']);
    const second = await users.ensure('salavat');
    expect(second.roles).toEqual([]);
    // ensure is idempotent
    await users.ensure('salavat');
    expect((await users.list()).length).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it('updates roles and persists them', async () => {
    const dir = await tmp();
    const path = join(dir, 'users.json');
    const users = new UserDirectory(new JsonStore<User[]>(path, []));
    await users.ensure('salavat');
    await users.setRoles('salavat', ['editor', 'stakeholder']);

    // fresh instance reads from disk
    const reloaded = new UserDirectory(new JsonStore<User[]>(path, []));
    expect((await reloaded.get('salavat'))?.roles).toEqual(['editor', 'stakeholder']);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('AuditLog', () => {
  it('appends events with incrementing ids and a timestamp', async () => {
    const dir = await tmp();
    let clock = 0;
    const audit = new AuditLog(
      new JsonStore<AuditEvent[]>(join(dir, 'audit.json'), []),
      () => new Date(1_700_000_000_000 + clock++ * 1000),
    );
    const a = await audit.append({ windowsId: 'salavat', action: 'create-branch', branch: 'x' });
    const b = await audit.append({ windowsId: 'eric', action: 'merge', branch: 'x', commit: 'abc' });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(a.timestamp).not.toBe(b.timestamp);
    expect((await audit.list()).length).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});
