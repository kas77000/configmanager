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
  it('auto-registers an unknown Windows ID as pending', async () => {
    const dir = await tmp();
    const users = new UserDirectory(new JsonStore<User[]>(join(dir, 'users.json'), []));
    const u = await users.ensure('salavat');
    expect(u).toMatchObject({ windowsId: 'salavat', role: 'pending' });
    // ensure is idempotent
    expect((await users.list()).length).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  it('updates a role and persists it', async () => {
    const dir = await tmp();
    const path = join(dir, 'users.json');
    const users = new UserDirectory(new JsonStore<User[]>(path, []));
    await users.ensure('salavat');
    await users.setRole('salavat', 'admin');

    // fresh instance reads from disk
    const reloaded = new UserDirectory(new JsonStore<User[]>(path, []));
    expect((await reloaded.get('salavat'))?.role).toBe('admin');
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
