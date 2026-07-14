import { JsonStore } from './json-store';

/**
 * admin      = app owner (manage users/instances, do everything)
 * approver   = boss (create/review changes AND approve/reject)
 * editor     = quant team (create + review changes)
 * stakeholder= approve/reject only; sees request description + instances, not the config
 * pending    = unassigned
 */
export type Role = 'admin' | 'approver' | 'editor' | 'stakeholder' | 'pending';

export const ROLES: Role[] = ['admin', 'approver', 'editor', 'stakeholder', 'pending'];

/** Can create and edit changes / config. */
export function canEdit(role: Role): boolean {
  return role === 'admin' || role === 'approver' || role === 'editor';
}
/** Can approve or reject a submitted change. */
export function canApprove(role: Role): boolean {
  return role === 'admin' || role === 'approver' || role === 'stakeholder';
}

export interface User {
  windowsId: string;
  displayName: string;
  email: string;
  role: Role;
}

/** Lightweight directory of people (not credentials): Windows ID -> name, email, role. */
export class UserDirectory {
  constructor(private readonly store: JsonStore<User[]>) {}

  async list(): Promise<User[]> {
    return [...(await this.store.read())];
  }

  async get(windowsId: string): Promise<User | undefined> {
    return (await this.store.read()).find((u) => u.windowsId === windowsId);
  }

  /**
   * Returns the user for a Windows ID, auto-registering an unknown one. The very first user
   * to connect becomes `admin` (bootstrap); everyone after that is `pending` until assigned.
   */
  async ensure(windowsId: string): Promise<User> {
    return this.store.update((users) => {
      let user = users.find((u) => u.windowsId === windowsId);
      if (!user) {
        const role: Role = users.length === 0 ? 'admin' : 'pending';
        user = { windowsId, displayName: windowsId, email: '', role };
        users.push(user);
      }
      return { ...user };
    });
  }

  async setRole(windowsId: string, role: Role): Promise<User | undefined> {
    return this.store.update((users) => {
      const user = users.find((u) => u.windowsId === windowsId);
      if (!user) return undefined;
      user.role = role;
      return { ...user };
    });
  }

  async upsert(user: User): Promise<User> {
    return this.store.update((users) => {
      const existing = users.find((u) => u.windowsId === user.windowsId);
      if (existing) Object.assign(existing, user);
      else users.push(user);
      return { ...user };
    });
  }

  async remove(windowsId: string): Promise<boolean> {
    return this.store.update((users) => {
      const i = users.findIndex((u) => u.windowsId === windowsId);
      if (i === -1) return false;
      users.splice(i, 1);
      return true;
    });
  }
}
