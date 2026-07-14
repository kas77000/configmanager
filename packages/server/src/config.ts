import { join } from 'node:path';

/** The single config file managed in Phase 1. */
export const MANAGED_FILE = 'ai.fixmsg.properties';

/** The canonical production branch inside the managed repo. */
export const MAIN_BRANCH = 'main';

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
}

const root = process.cwd();

export const defaultConfig: ServerConfig = {
  repoDir: join(root, 'data', 'config-repo'),
  dataDir: join(root, 'data'),
  seedFile: join(root, MANAGED_FILE),
  port: Number(process.env.PORT ?? 4000),
};
