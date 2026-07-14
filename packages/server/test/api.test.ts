import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { ConfigRepo } from '../src/git/repo';
import { JsonStore } from '../src/store/json-store';
import { UserDirectory, type User } from '../src/store/users';
import { AuditLog, type AuditEvent } from '../src/store/audit';

const FILE = 'ai.fixmsg.properties';
const CLEAN = '9012=1=1 :: compositeExchangeCode=HK\n';
const HEADER = 'x-remote-user';

interface Harness {
  app: Express;
  repo: ConfigRepo;
  users: UserDirectory;
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'cfgapi-'));
  const repo = new ConfigRepo(join(dir, 'repo'), FILE);
  await repo.init(CLEAN);
  const users = new UserDirectory(new JsonStore<User[]>(join(dir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(dir, 'audit.json'), []));
  await users.upsert({ windowsId: 'root', displayName: 'Root Admin', email: 'root@x', role: 'admin' });
  await users.upsert({ windowsId: 'ed', displayName: 'Ed Editor', email: 'ed@x', role: 'editor' });
  const app = createApp({ repo, users, audit, identity: { header: HEADER } });
  return { app, repo, users, dir };
}

const as = (app: Express, id: string) => (method: 'get' | 'post' | 'put', url: string) =>
  request(app)[method](url).set(HEADER, id);

describe('API', () => {
  it('rejects requests with no identity', async () => {
    const h = await makeHarness();
    await request(h.app).get('/api/me').expect(401);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('returns the caller identity and auto-registers unknown users as pending', async () => {
    const h = await makeHarness();
    const res = await as(h.app, 'newcomer')('get', '/api/me').expect(200);
    expect(res.body).toMatchObject({ windowsId: 'newcomer', role: 'pending' });
    await rm(h.dir, { recursive: true, force: true });
  });

  it('forbids a pending user from creating a branch', async () => {
    const h = await makeHarness();
    await as(h.app, 'newcomer')('post', '/api/branches').send({ name: 'x' }).expect(403);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('runs a clean edit → analysis → merge for an editor', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    await ed('post', '/api/branches').send({ name: 'clean' }).expect(201);
    await ed('put', '/api/branches/clean/file')
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'switch to JP' })
      .expect(200);
    const analysis = await ed('get', '/api/branches/clean/analysis').expect(200);
    expect(analysis.body.errorCount).toBe(0);
    expect(analysis.body.warningCount).toBe(0);
    const merge = await ed('post', '/api/branches/clean/merge').send({}).expect(200);
    expect(merge.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('blocks a merge with ERROR findings and allows an admin override with a reason', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    const bad = '9012=1=1 :: orderSizeADV < 0.07, orderSizeADV >= 0.15\n'; // self-contradiction
    await ed('post', '/api/branches').send({ name: 'bad' }).expect(201);
    await ed('put', '/api/branches/bad/file').send({ content: bad, message: 'oops' }).expect(200);

    // editor blocked
    const blocked = await ed('post', '/api/branches/bad/merge').send({ override: true, overrideReason: 'x' });
    expect(blocked.status).toBe(403); // editor cannot override

    // plain merge blocked
    await ed('post', '/api/branches/bad/merge').send({}).expect(403);

    // admin override without reason -> 400
    const admin = as(h.app, 'root');
    await admin('post', '/api/branches/bad/merge').send({ override: true }).expect(400);

    // admin override with reason -> merged
    const ok = await admin('post', '/api/branches/bad/merge')
      .send({ override: true, overrideReason: 'accepted risk, tracked in JIRA-123' })
      .expect(200);
    expect(ok.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('requires acknowledgement for WARNING findings', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    const warn =
      '9012=6=8 :: compositeExchangeCode=HK\n9012=6=12 :: compositeExchangeCode=HK\n'; // redundant-conditions
    await ed('post', '/api/branches').send({ name: 'warn' }).expect(201);
    await ed('put', '/api/branches/warn/file').send({ content: warn, message: 'dup' }).expect(200);

    const needsAck = await ed('post', '/api/branches/warn/merge').send({});
    expect(needsAck.status).toBe(409);
    expect(needsAck.body.error).toBe('warnings-need-acknowledgement');

    const ok = await ed('post', '/api/branches/warn/merge').send({ acknowledgeWarnings: true }).expect(200);
    expect(ok.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('records who-did-what in the audit log and history', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    await ed('post', '/api/branches').send({ name: 'trace' }).expect(201);
    await ed('put', '/api/branches/trace/file')
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'edit' })
      .expect(200);
    await ed('post', '/api/branches/trace/merge').send({}).expect(200);

    const history = await ed('get', '/api/history').expect(200);
    const actions = history.body.audit.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['create-branch', 'edit', 'merge']);
    expect(history.body.audit.every((e: { windowsId: string }) => e.windowsId === 'ed')).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });
});
