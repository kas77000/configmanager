import { JsonStore } from './json-store';
import { changeBranch } from '../config';

export interface ChangeTarget {
  instance: string;
  /** Working branch for this instance's edit within the change. */
  branch: string;
  /** Commit the branch was merged into its instance at, once applied. */
  mergedCommit?: string;
}

export type ChangeStatus = 'draft' | 'merged' | 'cancelled';

export interface Change {
  id: string;
  /** The methodology being applied (free text). */
  description: string;
  createdBy: string;
  createdAt: string;
  targets: ChangeTarget[];
  status: ChangeStatus;
}

export interface NewChange {
  description: string;
  createdBy: string;
  instances: string[];
}

/** Groups the per-instance edits that make up one logical change. */
export class ChangeStore {
  constructor(
    private readonly store: JsonStore<Change[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: NewChange): Promise<Change> {
    return this.store.update((changes) => {
      const nextN = changes.reduce((max, c) => Math.max(max, Number(c.id.replace(/^C/, '')) || 0), 0) + 1;
      const id = `C${nextN}`;
      const change: Change = {
        id,
        description: input.description,
        createdBy: input.createdBy,
        createdAt: this.now().toISOString(),
        status: 'draft',
        targets: input.instances.map((instance) => ({ instance, branch: changeBranch(id, instance) })),
      };
      changes.push(change);
      return change;
    });
  }

  async list(): Promise<Change[]> {
    return [...(await this.store.read())];
  }

  async get(id: string): Promise<Change | undefined> {
    return (await this.store.read()).find((c) => c.id === id);
  }

  /** Marks one instance target as merged; flips the change to 'merged' once all targets are applied. */
  async markMerged(id: string, instance: string, commit: string): Promise<Change | undefined> {
    return this.store.update((changes) => {
      const change = changes.find((c) => c.id === id);
      if (!change) return undefined;
      const target = change.targets.find((t) => t.instance === instance);
      if (target) target.mergedCommit = commit;
      if (change.targets.every((t) => t.mergedCommit)) change.status = 'merged';
      return change;
    });
  }
}
