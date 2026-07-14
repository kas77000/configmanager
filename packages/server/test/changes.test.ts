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
  it('derives per-instance targets from per-file modifications', async () => {
    const changes = await store();
    const c = await changes.create({
      description: 'Korea 144=1', createdBy: 'ed', items: [
        { file: 'ai.fixmsg.properties', description: 'add 144=1', instances: ['APIA', 'APIB'] },
        { file: 'risk.properties', description: 'tighten risk', instances: ['APIA'] },
      ],
    });
    expect(c.id).toBe('C1');
    expect(c.status).toBe('draft');
    // APIA gets both files, APIB only the one whose modification targets it
    expect(c.targets).toEqual([
      { instance: 'APIA', branch: 'change/C1/APIA', files: ['ai.fixmsg.properties', 'risk.properties'] },
      { instance: 'APIB', branch: 'change/C1/APIB', files: ['ai.fixmsg.properties'] },
    ]);
  });

  it('flips to merged only once every target is applied', async () => {
    const changes = await store();
    const c = await changes.create({ description: 'x', createdBy: 'ed', items: [{ file: 'ai.fixmsg.properties', description: 'x', instances: ['APIA', 'APIB'] }] });
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
