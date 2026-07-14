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
import { InstanceStore, type ManagedInstance } from '../src/store/instances';
import { StaticInstanceReader } from '../src/instance-reader';
import { seedInstances, seedRepo } from '../src/bootstrap';

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
  const instances = new InstanceStore(new JsonStore<ManagedInstance[]>(join(dir, 'instances.json'), []));
  await seedInstances(instances);
  const reader = new StaticInstanceReader();
  reader.set('APIA', FILE, CLEAN); // live matches recorded by default
  await users.upsert({ windowsId: 'root', displayName: 'Root Admin', email: 'root@x', role: 'admin' });
  await users.upsert({ windowsId: 'ed', displayName: 'Ed Editor', email: 'ed@x', role: 'editor' });
  const app = createApp({ repo, users, audit, changes, instances, reader, identity: { header: HEADER } });
  return { app, dir, reader };
}

const as = (app: Express, id: string) => (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string) =>
  request(app)[method](url).set(HEADER, id);

async function newChange(app: Express, instances: string[]): Promise<string> {
  const res = await as(app, 'ed')('post', '/api/changes')
    .send({ description: 'apply methodology', instances })
    .expect(201);
  return res.body.id as string;
}

async function submitAndApprove(app: Express, id: string): Promise<void> {
  await as(app, 'ed')('post', `/api/changes/${id}/submit`).expect(200);
  await as(app, 'root')('post', `/api/changes/${id}/approve`).expect(200);
}

describe('API (per-instance)', () => {
  it('rejects requests with no identity', async () => {
    const h = await makeHarness();
    await request(h.app).get('/api/me').expect(401);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('lists all instances with environment and UAT flag', async () => {
    const h = await makeHarness();
    const list = await as(h.app, 'ed')('get', '/api/instances').expect(200);
    const byCode = Object.fromEntries(
      list.body.map((i: { code: string }) => [i.code, i]),
    ) as Record<string, { environment: string; uat: boolean; files: string[] }>;
    expect(byCode.APIH).toMatchObject({ environment: 'pilot', uat: true });
    expect(byCode.APIC).toMatchObject({ environment: 'pilot', uat: false });
    expect(byCode.APIF.environment).toBe('pilot');
    expect(byCode.APIG.environment).toBe('pilot');
    expect(byCode.APIA).toMatchObject({ environment: 'production', uat: false });
    expect(byCode.APIA.files).toContain(FILE);
    const file = await as(h.app, 'ed')('get', '/api/instances/APIA/file').expect(200);
    expect(file.body.content).toBe(CLEAN);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('lets an admin create, edit, add a file to, and delete an instance', async () => {
    const h = await makeHarness();
    const admin = as(h.app, 'root');
    const ed = as(h.app, 'ed');

    // non-admin cannot create
    await ed('post', '/api/instances').send({ code: 'APIZ', environment: 'production' }).expect(403);

    // create (branches from an existing instance, inheriting its files)
    const created = await admin('post', '/api/instances').send({ code: 'APIZ', environment: 'pilot', uat: false }).expect(201);
    expect(created.body).toMatchObject({ code: 'APIZ', environment: 'pilot', files: [FILE] });
    // its git branch exists and is usable in a change
    const cid = (await ed('post', '/api/changes').send({ description: 'x', instances: ['APIZ'] }).expect(201)).body.id;
    expect(cid).toBeTruthy();

    // edit environment + make it the UAT box (moves UAT off APIH)
    await admin('patch', '/api/instances/APIZ').send({ environment: 'production', uat: true }).expect(200);
    const list = await admin('get', '/api/instances').expect(200);
    const byCode = Object.fromEntries(list.body.map((i: any) => [i.code, i]));
    expect(byCode.APIZ).toMatchObject({ environment: 'production', uat: true });
    expect(byCode.APIH.uat).toBe(false);

    // add a second managed file, committed onto the instance branch
    const withFile = await admin('post', '/api/instances/APIZ/files').send({ file: 'risk.properties', content: 'x=1\n' }).expect(201);
    expect(withFile.body.files).toContain('risk.properties');
    const f = await admin('get', '/api/instances/APIZ/file?file=risk.properties').expect(200);
    expect(f.body.content).toBe('x=1\n');

    // remove the managed file (metadata) and delete the instance
    await admin('delete', '/api/instances/APIZ/files/risk.properties').expect(200);
    await admin('delete', '/api/instances/APIZ').expect(200);
    const after = await admin('get', '/api/instances').expect(200);
    expect(after.body.some((i: any) => i.code === 'APIZ')).toBe(false);
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
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'JP' }).expect(200);
    await ed('put', `/api/changes/${id}/instances/APIB/files/${FILE}`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=KS\n', message: 'KS' }).expect(200);

    const a = await ed('get', `/api/changes/${id}/instances/APIA/files/${FILE}`).expect(200);
    const b = await ed('get', `/api/changes/${id}/instances/APIB/files/${FILE}`).expect(200);
    expect(a.body.content).toContain('JP');
    expect(b.body.content).toContain('KS');
    await rm(h.dir, { recursive: true, force: true });
  });

  it('supports a change spanning multiple files on one instance', async () => {
    const h = await makeHarness();
    const admin = as(h.app, 'root');
    const ed = as(h.app, 'ed');
    await admin('post', '/api/instances/APIA/files').send({ file: 'risk.properties', content: 'r=0\n' }).expect(201);
    const cid = (await ed('post', '/api/changes').send({ description: 'multi', instances: ['APIA'], files: [FILE, 'risk.properties'] }).expect(201)).body.id;

    await ed('put', `/api/changes/${cid}/instances/APIA/files/${FILE}`).send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'fixmsg' }).expect(200);
    await ed('put', `/api/changes/${cid}/instances/APIA/files/risk.properties`).send({ content: 'r=1\n', message: 'risk' }).expect(200);

    // analysis on a non-fixmsg file yields no findings
    const ra = await ed('get', `/api/changes/${cid}/instances/APIA/files/risk.properties/analysis`).expect(200);
    expect(ra.body.errorCount).toBe(0);
    expect(ra.body.warningCount).toBe(0);

    // one merge applies both files to the instance (after approval)
    await submitAndApprove(h.app, cid);
    await ed('post', `/api/changes/${cid}/instances/APIA/merge`).send({}).expect(200);
    const f1 = await ed('get', '/api/instances/APIA/file').expect(200);
    expect(f1.body.content).toContain('JP');
    const f2 = await ed('get', '/api/instances/APIA/file?file=risk.properties').expect(200);
    expect(f2.body.content).toBe('r=1\n');
    await rm(h.dir, { recursive: true, force: true });
  });

  it('runs clean analysis and merges one instance of a change', async () => {
    const h = await makeHarness();
    const id = await newChange(h.app, ['APIA']);
    const ed = as(h.app, 'ed');
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'JP' }).expect(200);
    const analysis = await ed('get', `/api/changes/${id}/instances/APIA/files/${FILE}/analysis`).expect(200);
    expect(analysis.body.errorCount).toBe(0);
    expect(analysis.body.warningCount).toBe(0);
    await submitAndApprove(h.app, id);
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
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`).send({ content: bad, message: 'oops' }).expect(200);
    await submitAndApprove(h.app, id);

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
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`).send({ content: warn, message: 'dup' }).expect(200);
    await submitAndApprove(h.app, id);
    const needsAck = await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({});
    expect(needsAck.status).toBe(409);
    const ok = await ed('post', `/api/changes/${id}/instances/APIA/merge`)
      .send({ acknowledgeWarnings: true }).expect(200);
    expect(ok.body.merged).toBe(true);
    await rm(h.dir, { recursive: true, force: true });
  });

  it('gates merge behind approval and enforces roles', async () => {
    const h = await makeHarness();
    const ed = as(h.app, 'ed');
    await as(h.app, 'root')('post', '/api/users').send({ windowsId: 'stake', role: 'stakeholder' }).expect(201);

    const id = (await ed('post', '/api/changes').send({ description: 'Korea 144=1', instances: ['APIA'] }).expect(201)).body.id;
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`).send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'e' }).expect(200);

    // cannot merge before approval
    await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(403);

    await ed('post', `/api/changes/${id}/submit`).expect(200);
    // an editor cannot approve
    await ed('post', `/api/changes/${id}/approve`).expect(403);
    // a stakeholder cannot see the config
    await as(h.app, 'stake')('get', `/api/changes/${id}/instances/APIA/files/${FILE}`).expect(403);
    // but can approve
    const approved = await as(h.app, 'stake')('post', `/api/changes/${id}/approve`).expect(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.decision).toMatchObject({ by: 'stake', action: 'approved' });

    // now an editor can merge
    await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(200);
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
    await ed('put', `/api/changes/${id}/instances/APIA/files/${FILE}`)
      .send({ content: '9012=1=1 :: compositeExchangeCode=JP\n', message: 'edit' }).expect(200);
    await submitAndApprove(h.app, id);
    await ed('post', `/api/changes/${id}/instances/APIA/merge`).send({}).expect(200);
    const history = await ed('get', '/api/history').expect(200);
    const actions = history.body.audit.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['create-change', 'edit', 'submit-change', 'approve-change', 'merge']);
    expect(history.body.audit.find((e: { action: string; windowsId: string }) => e.action === 'merge')?.windowsId).toBe('ed');
    expect(history.body.audit.find((e: { action: string; windowsId: string }) => e.action === 'approve-change')?.windowsId).toBe('root');
    await rm(h.dir, { recursive: true, force: true });
  });
});
