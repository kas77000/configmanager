import { JsonStore } from './json-store';

export type Environment = 'pilot' | 'production';

/** Where an instance's config lives: a local folder, a shared/network drive, or a server. */
export type LocationType = 'local' | 'shared' | 'server';
export const LOCATION_TYPES: LocationType[] = ['local', 'shared', 'server'];
export function isLocationType(v: unknown): v is LocationType {
  return v === 'local' || v === 'shared' || v === 'server';
}

export interface ManagedInstance {
  code: string;
  environment: Environment;
  /** True for the UAT instance. */
  uat: boolean;
  /** Config files managed for this instance. */
  files: string[];
  /** How the instance's config is reached. Defaults to 'server' for existing instances. */
  locationType?: LocationType;
  /** Where the config lives: a local path, a UNC share, or a server hostname. */
  serverAddress?: string;
  /** Each managed file's path *relative to* the location above (filename -> relative path).
   *  Blank/absent means the file sits directly in the location, under its own name. */
  paths?: Record<string, string>;
}

const CODE_RE = /^[A-Za-z0-9_-]+$/;

export function isValidInstanceCode(code: string): boolean {
  return CODE_RE.test(code);
}

/** True when reaching this instance requires the service account (server-hosted only, for now). */
export function needsServiceAccount(inst: Pick<ManagedInstance, 'locationType'>): boolean {
  return (inst.locationType ?? 'server') === 'server';
}

/** Effective path to a managed file: the instance location joined with the file's relative path,
 *  defaulting to the file name when no relative path is set (so the base is never retyped). */
export function resolveFilePath(inst: ManagedInstance, file: string): string {
  const base = (inst.serverAddress ?? '').trim().replace(/[\\/]+$/, '');
  const rel = ((inst.paths?.[file] ?? '').trim().replace(/^[\\/]+/, '')) || file;
  if (!base) return rel;
  const sep = /\\/.test(base) || /^[a-zA-Z]:/.test(base) ? '\\' : '/';
  return `${base}${sep}${rel}`;
}

/** Persistent, admin-managed registry of instances and the files tracked for each. */
export class InstanceStore {
  constructor(private readonly store: JsonStore<ManagedInstance[]>) {}

  async list(): Promise<ManagedInstance[]> {
    return [...(await this.store.read())];
  }

  async get(code: string): Promise<ManagedInstance | undefined> {
    return (await this.store.read()).find((i) => i.code === code);
  }

  async has(code: string): Promise<boolean> {
    return (await this.store.read()).some((i) => i.code === code);
  }

  async create(inst: ManagedInstance): Promise<ManagedInstance> {
    return this.store.update((list) => {
      if (list.some((i) => i.code === inst.code)) throw new Error(`instance ${inst.code} already exists`);
      if (inst.uat) list.forEach((i) => (i.uat = false)); // at most one UAT
      const created: ManagedInstance = { ...inst };
      list.push(created);
      return { ...created };
    });
  }

  async update(code: string, patch: Partial<Pick<ManagedInstance, 'environment' | 'uat' | 'serverAddress' | 'locationType'>>): Promise<ManagedInstance | undefined> {
    return this.store.update((list) => {
      const inst = list.find((i) => i.code === code);
      if (!inst) return undefined;
      if (patch.uat === true) list.forEach((i) => (i.uat = false));
      if (patch.environment) inst.environment = patch.environment;
      if (patch.uat !== undefined) inst.uat = patch.uat;
      if (patch.serverAddress !== undefined) inst.serverAddress = patch.serverAddress;
      if (patch.locationType !== undefined) inst.locationType = patch.locationType;
      return { ...inst };
    });
  }

  async setFilePath(code: string, file: string, path: string): Promise<ManagedInstance | undefined> {
    return this.store.update((list) => {
      const inst = list.find((i) => i.code === code);
      if (!inst) return undefined;
      inst.paths = { ...(inst.paths ?? {}), [file]: path };
      return { ...inst };
    });
  }

  async remove(code: string): Promise<boolean> {
    return this.store.update((list) => {
      const idx = list.findIndex((i) => i.code === code);
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    });
  }

  async addFile(code: string, file: string): Promise<ManagedInstance | undefined> {
    return this.store.update((list) => {
      const inst = list.find((i) => i.code === code);
      if (!inst) return undefined;
      if (!inst.files.includes(file)) inst.files.push(file);
      return { ...inst, files: [...inst.files] };
    });
  }

  async removeFile(code: string, file: string): Promise<ManagedInstance | undefined> {
    return this.store.update((list) => {
      const inst = list.find((i) => i.code === code);
      if (!inst) return undefined;
      inst.files = inst.files.filter((f) => f !== file);
      return { ...inst, files: [...inst.files] };
    });
  }
}
