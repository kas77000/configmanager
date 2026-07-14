import { JsonStore } from './json-store';

export interface AuditEvent {
  id: number;
  timestamp: string;
  windowsId: string;
  ip?: string;
  action: string;
  branch?: string;
  commit?: string;
  details?: Record<string, unknown>;
}

export type NewAuditEvent = Omit<AuditEvent, 'id' | 'timestamp'>;

/** Append-only record of who did what. Never mutated or deleted. */
export class AuditLog {
  constructor(
    private readonly store: JsonStore<AuditEvent[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async append(event: NewAuditEvent): Promise<AuditEvent> {
    return this.store.update((events) => {
      const nextId = events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      const full: AuditEvent = { id: nextId, timestamp: this.now().toISOString(), ...event };
      events.push(full);
      return full;
    });
  }

  async list(): Promise<AuditEvent[]> {
    return [...(await this.store.read())];
  }
}
