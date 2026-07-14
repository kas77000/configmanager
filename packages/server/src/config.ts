import { join } from 'node:path';

/** The single config file managed in Phase 1. */
export const MANAGED_FILE = 'ai.fixmsg.properties';

/** The trading instances, each with its own canonical version of the file. */
export const INSTANCES = [
  'APIA', 'APIB', 'APIC', 'APID', 'APIE', 'APIF', 'APIG',
  'APIH', 'APII', 'APIJ', 'APIK', 'APIL', 'APIM',
] as const;

export type Instance = (typeof INSTANCES)[number];

export function isInstance(code: string): code is Instance {
  return (INSTANCES as readonly string[]).includes(code);
}

/** The long-lived branch holding an instance's canonical version. */
export function instanceBranch(code: string): string {
  return `instance/${code}`;
}

/** The working branch for one instance within a change. */
export function changeBranch(changeId: string, code: string): string {
  return `change/${changeId}/${code}`;
}

/** Rollout tier of an instance. Pilots roll out first, then production. */
export type Environment = 'pilot' | 'production';

/** Pilot instances (roll out first). APIH is a pilot that also serves as UAT. */
export const PILOT_INSTANCES: readonly Instance[] = ['APIC', 'APIF', 'APIG', 'APIH'];

/** The single UAT instance. */
export const UAT_INSTANCE: Instance = 'APIH';

export function environmentOf(code: Instance): Environment {
  return PILOT_INSTANCES.includes(code) ? 'pilot' : 'production';
}

export interface InstanceInfo {
  code: Instance;
  environment: Environment;
  /** True for the UAT instance (APIH). */
  uat: boolean;
}

export function instanceInfos(): InstanceInfo[] {
  return INSTANCES.map((code) => ({
    code,
    environment: environmentOf(code),
    uat: code === UAT_INSTANCE,
  }));
}

/** HTTP header the reverse proxy sets with the authenticated Windows identity. */
export const IDENTITY_HEADER = 'x-remote-user';

/** Env var used to impersonate a Windows ID during local development (off-domain). */
export const DEV_USER_ENV = 'CONFIG_MANAGER_DEV_USER';

export interface ServerConfig {
  /** Directory holding the managed Git repo. */
  repoDir: string;
  /** Directory holding JSON stores (users, audit). */
  dataDir: string;
  /** Path to the file whose contents seed the repo on first init. */
  seedFile: string;
  port: number;
  /** Base URL of the web app, used in email links. */
  appBaseUrl: string;
}

const root = process.cwd();

export const defaultConfig: ServerConfig = {
  repoDir: join(root, 'data', 'config-repo'),
  dataDir: join(root, 'data'),
  seedFile: join(root, MANAGED_FILE),
  port: Number(process.env.PORT ?? 4000),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',
};
