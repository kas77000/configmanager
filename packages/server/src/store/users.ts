import { JsonStore } from './json-store';

/**
 * A person can hold several roles (a "boss" is simply quant + stakeholder).
 * admin      = app owner (manage users/instances; implies edit + approve)
 * editor     = quant team (create + review changes)
 * stakeholder= approve/reject requests; sees description + instances, not the config
 * No roles   = pending (unassigned).
 */
export type Role = 'admin' | 'editor' | 'stakeholder';

export const ROLES: Role[] = ['admin', 'editor', 'stakeholder'];

export function isAdmin(roles: Role[]): boolean {
  return roles.includes('admin');
}
/** Can create and edit changes / config. */
export function canEdit(roles: Role[]): boolean {
  return roles.includes('admin') || roles.includes('editor');
}
/** Can approve or reject a submitted change. */
export function canApprove(roles: Role[]): boolean {
  return roles.includes('admin') || roles.includes('stakeholder');
}
export function isPending(roles: Role[]): boolean {
  return roles.length === 0;
}

export interface User {
  windowsId: string;
  displayName: string;
  email: string;
  roles: Role[];
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
   * to connect becomes `admin` (bootstrap); everyone after that starts pending (no roles).
   */
  async ensure(windowsId: string): Promise<User> {
    return this.store.update((users) => {
      let user = users.find((u) => u.windowsId === windowsId);
      if (!user) {
        user = { windowsId, displayName: windowsId, email: '', roles: users.length === 0 ? ['admin'] : [] };
        users.push(user);
      }
      return { ...user, roles: [...user.roles] };
    });
  }

  async setRoles(windowsId: string, roles: Role[]): Promise<User | undefined> {
    return this.store.update((users) => {
      const user = users.find((u) => u.windowsId === windowsId);
      if (!user) return undefined;
      user.roles = roles;
      return { ...user, roles: [...user.roles] };
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
