import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app';
import { ConfigRepo } from './git/repo';
import { seedRepo } from './bootstrap';
import { JsonStore } from './store/json-store';
import { UserDirectory, type User } from './store/users';
import { AuditLog, type AuditEvent } from './store/audit';
import { ChangeStore, type Change } from './store/changes';
import { DEV_USER_ENV, IDENTITY_HEADER, MANAGED_FILE, defaultConfig } from './config';

export async function main(): Promise<void> {
  const cfg = defaultConfig;

  const repo = new ConfigRepo(cfg.repoDir, MANAGED_FILE);
  const seed = await readFile(cfg.seedFile, 'utf8');
  await seedRepo(repo, seed);

  const users = new UserDirectory(new JsonStore<User[]>(join(cfg.dataDir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(cfg.dataDir, 'audit.json'), []));
  const changes = new ChangeStore(new JsonStore<Change[]>(join(cfg.dataDir, 'changes.json'), []));

  const app = createApp({
    repo,
    users,
    audit,
    changes,
    identity: { header: IDENTITY_HEADER, devUser: process.env[DEV_USER_ENV] },
  });

  app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Configuration Manager API listening on http://localhost:${cfg.port}`);
  });
}

// Only start the server when run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
