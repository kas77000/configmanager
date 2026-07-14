import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/store/json-store';
import { ChangeStore, type Change } from '../src/store/changes';
import { checkDrift } from '../src/verify';

async function store(): Promise<ChangeStore> {
  const dir = await mkdtemp(join(tmpdir(), 'cfgchg-'));
  return new ChangeStore(new JsonStore<Change[]>(join(dir, 'changes.json'), []), () => new Date(0));
}

describe('ChangeStore', () => {
  it('creates a change with one branch per target instance and a files list', async () => {
    const changes = await store();
    const c = await changes.create({ description: 'Korea 144=1', createdBy: 'ed', instances: ['APIA', 'APIB'], files: ['ai.fixmsg.properties', 'risk.properties'] });
    expect(c.id).toBe('C1');
    expect(c.status).toBe('draft');
    expect(c.targets).toEqual([
      { instance: 'APIA', branch: 'change/C1/APIA', files: ['ai.fixmsg.properties', 'risk.properties'] },
      { instance: 'APIB', branch: 'change/C1/APIB', files: ['ai.fixmsg.properties', 'risk.properties'] },
    ]);
  });

  it('flips to merged only once every target is applied', async () => {
    const changes = await store();
    const c = await changes.create({ description: 'x', createdBy: 'ed', instances: ['APIA', 'APIB'], files: ['ai.fixmsg.properties'] });
    await changes.markMerged(c.id, 'APIA', 'aaa');
    expect((await changes.get(c.id))?.status).toBe('draft');
    await changes.markMerged(c.id, 'APIB', 'bbb');
    expect((await changes.get(c.id))?.status).toBe('merged');
  });
});

describe('checkDrift', () => {
  it('reports in-sync for identical content and drift otherwise', () => {
    expect(checkDrift('APIA', 'x\n', 'x\n').inSync).toBe(true);
    const d = checkDrift('APIA', 'x\n', 'y\n');
    expect(d.inSync).toBe(false);
    expect(d.recordedSha).not.toBe(d.liveSha);
  });
});
