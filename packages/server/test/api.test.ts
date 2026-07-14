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
import { ChangeStore, type Change } from '../src/store/changes';
import { StaticInstanceReader } from '../src/instance-reader';
import { seedRepo } from '../src/bootstrap';

const FILE = 'ai.fixmsg.properties';
const CLEAN = '9012=1=1 :: compositeExchangeCode=HK\n';
const HEADER = 'x-remote-user';

interface Harness {
  app: Express;
  dir: string;
  reader: StaticInstanceReader;
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'cfgapi-'));
  const repo = new ConfigRepo(join(dir, 'repo'), FILE);
  await seedRepo(repo, CLEAN);
  const users = new UserDirectory(new JsonStore<User[]>(join(dir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(dir, 'audit.json'), []));
  const changes = new ChangeStore(new JsonStore<Change[]>(join(dir, 'changes.json'), []));
  const reader = new StaticInstanceReader();
  reader.set('APIA', FILE, CLEAN); // live matches recorded by default
  await users.upsert({ windowsId: 'root', displayName: 'Root Admin', email: 'root@x', role: 'admin' });
  await users.upsert({ windowsId: 'ed', displayName: 'Ed Editor', email: 'ed@x', role: 'editor' });
  const app = createApp({ repo, users, audit, changes, reader, identity: { header: HEADER } });
  return { app, dir, reader };
}

const as = (app: Express, id: string) => (method: 'get' | 'post' | 'put', url: string) =>
  request(app)[method](url).set(HEADER, id);

async function newChange(app: Express, instances: string[]): Promise<string> {
  const res = await as(app, 'ed')('post', '/api/changes')
    .send({ description: 'apply methodology', instances })
    .expect(201);
  return res.body.id as string;
}

describe('API (per-instance)', () => {
  it('rejects requests with no identity', async () => {
    const h = await makeHarness();
    await request(h.app).get('/api/me').expect(401);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('lists all instances with their environment (APIH is UAT)', async () => {
    const h = await makeHarness();
    const list = await as(h.app, 'ed')('get', '/api/instances').expect(200);
    const codes = list.body.map((i: { code: string }) => i.code);
    expect(codes).toContain('APIA');
    expect(codes).toContain('APIM');
    const uat = list.body.find((i: { code: string }) => i.code === 'APIH');
    expect(uat.environment).toBe('uat');
    const file = await as(h.app, 'ed')('get', '/api/instances/APIA/file').expect(200);
    expect(file.body.content).toBe(CLEAN);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('forbids a pending user from creating a change', async () => {
    const h = await makeHarness();
    await as(h.app, 'newcomer')('post', '/api/changes')
      .send({ description: 'x', instances: ['APIA'] })
      .expect(403);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('fans a change across instances with independent edits', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA', 'APIB']);
    const ed = as(h.app, 'ed');
    // APIA gets one edit, APIB a different one — same change, different files
    await ed('put', `/api/changes/${id}/instances/APIA/file`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'JP' }).expect(200);
    await ed('put', `/api/changes/${id}/instances/APIB/file`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=KS\n', message: 'KS' }).expect(200);

    const a = await ed('get', `/api/changes/${id}/instances/APIA/file`).expect(200);
    const b = await ed('get', `/api/changes/${id}/instances/APIB/file`).expect(200);
    expect(a.body.content).toContain('JP');
    expect(b.body.content).toContain('KS');
    await rm(h.dir, { recursive: true, force: true });
  });

  it('runs clean analysis and merges one instance of a change', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA']);
    const ed = as(h.app, 'ed');
    await ed('put', `/api/changes/${id}/instances/APIA/file`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'JP' }).expect(200);
    const analysis = await ed('get', `/api/changes/${id}/instances/APIA/analysis`).expect(200);
    expect(analysis.body.errorCount).toBe(0);
    expect(analysis.body.warningCount).toBe(0);
    const merge = await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(200);
    expect(merge.body.merged).toBe(true);
    const file = await ed('get', '/api/instances/APIA/file').expect(200);
    expect(file.body.content).toContain('JP');
    await rm(h.dir, { recursive: true, force: true });
  });

  it('blocks ERROR merges and allows admin override with a reason', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA']);
    const ed = as(h.app, 'ed');
    const bad = '9012=1=1 :: orderSizeADV < 0.07, orderSizeADV >= 0.15\n';
    await ed('put', `/api/changes/${id}/instances/APIA/file`).send({ content: bad, message: 'oops' }).expect(200);

    await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(403);
    await ed('post', `/api/changes/${id}/instances/APIA/merge`)
      .send({ override: true, overrideReason: 'x' }).expect(403); // editor cannot override

    const admin = as(h.app, 'root');
    await admin('post', `/api/changes/${id}/instances/APIA/merge`).send({ override: true }).expect(400);
    const ok = await admin('post', `/api/changes/${id}/instances/APIA/merge`)
      .send({ override: true, overrideReason: 'accepted risk JIRA-123' }).expect(200);
    expect(ok.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('requires acknowledgement for WARNING merges', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA']);
    const ed = as(h.app, 'ed');
    const warn = '9012=6=8 :: compositeExchangeCode=HK\n9012=6=12 :: compositeExchangeCode=HK\n';
    await ed('put', `/api/changes/${id}/instances/APIA/file`).send({ content: warn, message: 'dup' }).expect(200);
    const needsAck = await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({});
    expect(needsAck.status).toBe(409);
    const ok = await ed('post', `/api/changes/${id}/instances/APIA/merge`)
      .send({ acknowledgeWarnings: true }).expect(200);
    expect(ok.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('verifies drift read-only by fetching the live file', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    const same = await ed('post', '/api/instances/APIA/verify').send({}).expect(200);
    expect(same.body.inSync).toBe(true);

    h.reader.set('APIA', FILE, '9012=1=1 :: compositeExchangeCode=JP\n');
    const drifted = await ed('post', '/api/instances/APIA/verify').send({}).expect(200);
    expect(drifted.body.inSync).toBe(false);
    // verify does not ingest — recorded version is unchanged
    const file = await ed('get', '/api/instances/APIA/file').expect(200);
    expect(file.body.content).toBe(CLEAN);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('pulls the live version only when it differs, then is a no-op', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    // identical live content -> no update
    const noop = await ed('post', '/api/instances/APIA/sync').send({}).expect(200);
    expect(noop.body.updated).toBe(false);

    // live drifts -> sync ingests it as a new commit on the instance branch
    h.reader.set('APIA', FILE, '9012=1=1 :: compositeExchangeCode=JP\n');
    const pulled = await ed('post', '/api/instances/APIA/sync').send({}).expect(200);
    expect(pulled.body.updated).toBe(true);
    const file = await ed('get', '/api/instances/APIA/file').expect(200);
    expect(file.body.content).toContain('JP');

    // second sync is a no-op again (now in sync)
    const again = await ed('post', '/api/instances/APIA/sync').send({}).expect(200);
    expect(again.body.updated).toBe(false);

    // unreachable instance reports 502
    await ed('post', '/api/instances/APIB/sync').send({}).expect(502);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('records who-did-what across the change lifecycle', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA']);
    const ed = as(h.app, 'ed');
    await ed('put', `/api/changes/${id}/instances/APIA/file`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'edit' }).expect(200);
    await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(200);
    const history = await ed('get', '/api/history').expect(200);
    const actions = history.body.audit.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['create-change', 'edit', 'merge']);
    expect(history.body.audit.every((e: { windowsId: string }) => e.windowsId === 'ed')).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });
});
