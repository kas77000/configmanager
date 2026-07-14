import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from './app';
import { ConfigRepo } from './git/repo';
import { JsonStore } from './store/json-store';
import { UserDirectory, type User } from './store/users';
import { AuditLog, type AuditEvent } from './store/audit';
import {
  DEV_USER_ENV,
  IDENTITY_HEADER,
  MAIN_BRANCH,
  MANAGED_FILE,
  defaultConfig,
} from './config';

async function main(): Promise<void> {
  const cfg = defaultConfig;

  const repo = new ConfigRepo(cfg.repoDir, MANAGED_FILE, MAIN_BRANCH);
  const seed = await readFile(cfg.seedFile, 'utf8');
  await repo.init(seed);

  const users = new UserDirectory(new JsonStore<User[]>(join(cfg.dataDir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(cfg.dataDir, 'audit.json'), []));

  const app = createApp({
    repo,
    users,
    audit,
    identity: { header: IDENTITY_HEADER, devUser: process.env[DEV_USER_ENV] },
  });

  app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Configuration Manager API listening on http://localhost:${cfg.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
