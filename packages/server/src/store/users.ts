import { JsonStore } from './json-store';

export type Role = 'admin' | 'editor' | 'pending';

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
}
