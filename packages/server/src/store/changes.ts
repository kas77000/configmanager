import { JsonStore } from './json-store';
import { changeBranch } from '../config';

export interface ChangeTarget {
  instance: string;
  /** Working branch for this instance's edits within the change. */
  branch: string;
  /** Config files this change edits on this instance. */
  files: string[];
  /** Commit the branch was merged into its instance at, once applied. */
  mergedCommit?: string;
}

export type ChangeStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'merged' | 'cancelled';

export interface ChangeDecision {
  by: string;
  at: string;
  action: 'approved' | 'rejected';
  reason?: string;
}

export interface JiraTicket { file: string; key: string; url: string; }

/** One modification within a change: a config file, its own description, and the instances it applies to. */
export interface ChangeItem {
  file: string;
  description: string;
  instances: string[];
}

export interface Change {
  id: string;
  /** Short title for the whole change (shown in lists and the email subject). */
  description: string;
  /** Date the change becomes effective for trading (YYYY-MM-DD). */
  effectiveDate?: string;
  /** Per-file modifications, each with its own description and instances. */
  items: ChangeItem[];
  createdBy: string;
  createdAt: string;
  targets: ChangeTarget[];
  status: ChangeStatus;
  submittedBy?: string;
  submittedAt?: string;
  /** Jira tickets created on approval, one per config file. */
  jiraTickets?: JiraTicket[];
  decision?: ChangeDecision;
}

export interface NewChange {
  description: string;
  effectiveDate?: string;
  createdBy: string;
  items: ChangeItem[];
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
      const instanceCodes = [...new Set(input.items.flatMap((it) => it.instances))];
      const targets: ChangeTarget[] = instanceCodes.map((instance) => ({
        instance,
        branch: changeBranch(id, instance),
        files: [...new Set(input.items.filter((it) => it.instances.includes(instance)).map((it) => it.file))],
      }));
      const change: Change = {
        id,
        description: input.description,
        effectiveDate: input.effectiveDate,
        items: input.items,
        createdBy: input.createdBy,
        createdAt: this.now().toISOString(),
        status: 'draft',
        targets,
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

  /** Cancels a draft change. */
  async cancel(id: string, _by: string): Promise<Change | undefined> {
    return this.store.update((changes) => {
      const change = changes.find((c) => c.id === id);
      if (!change) return undefined;
      if (change.status === 'draft') change.status = 'cancelled';
      return change;
    });
  }

  /** Submits a draft/rejected change for approval. */
  async submit(id: string, by: string): Promise<Change | undefined> {
    return this.store.update((changes) => {
      const change = changes.find((c) => c.id === id);
      if (!change) return undefined;
      if (change.status !== 'draft' && change.status !== 'rejected') return change;
      change.status = 'submitted';
      change.submittedBy = by;
      change.submittedAt = this.now().toISOString();
      change.decision = undefined;
      return change;
    });
  }

  async setJiraTickets(id: string, tickets: JiraTicket[]): Promise<Change | undefined> {
    return this.store.update((changes) => {
      const change = changes.find((c) => c.id === id);
      if (!change) return undefined;
      change.jiraTickets = tickets;
      return change;
    });
  }

  /** Records an approve/reject decision on a submitted change. */
  async decide(id: string, by: string, action: 'approved' | 'rejected', reason?: string): Promise<Change | undefined> {
    return this.store.update((changes) => {
      const change = changes.find((c) => c.id === id);
      if (!change) return undefined;
      if (change.status !== 'submitted') return change;
      change.status = action;
      change.decision = { by, at: this.now().toISOString(), action, reason };
      return change;
    });
  }
}
