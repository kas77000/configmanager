import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app';
import { ConfigRepo } from './git/repo';
import { seedInstances, seedRepo } from './bootstrap';
import { JsonStore } from './store/json-store';
import { UserDirectory, type User } from './store/users';
import { AuditLog, type AuditEvent } from './store/audit';
import { ChangeStore, type Change } from './store/changes';
import { InstanceStore, type ManagedInstance } from './store/instances';
import { SettingsStore, type Settings, defaultSettings, serviceAccountFromEnv } from './store/settings';
import { StaticInstanceReader } from './instance-reader';
import { makeJiraClient } from './jira';
import { DEV_USER_ENV, IDENTITY_HEADER, MANAGED_FILE, defaultConfig } from './config';

export async function main(): Promise<void> {
  // Load secrets/config from a .env file if present (SERVICE_ACCOUNT_*, JIRA_*, APP_BASE_URL, ...).
  try { process.loadEnvFile(); } catch { /* no .env file, use real env */ }
  const cfg = {
    ...defaultConfig,
    appBaseUrl: process.env.APP_BASE_URL ?? defaultConfig.appBaseUrl,
    port: Number(process.env.PORT ?? defaultConfig.port),
  };

  const repo = new ConfigRepo(cfg.repoDir, MANAGED_FILE);
  const seed = await readFile(cfg.seedFile, 'utf8');
  await seedRepo(repo, seed);

  const users = new UserDirectory(new JsonStore<User[]>(join(cfg.dataDir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(cfg.dataDir, 'audit.json'), []));
  const changes = new ChangeStore(new JsonStore<Change[]>(join(cfg.dataDir, 'changes.json'), []));
  const instances = new InstanceStore(new JsonStore<ManagedInstance[]>(join(cfg.dataDir, 'instances.json'), []));
  await seedInstances(instances);

  // Dev convenience: outside production, the default dev identity is an admin so you can
  // drive the whole app immediately. A real reverse proxy + Windows auth is used in prod.
  if (process.env.NODE_ENV !== 'production') {
    const devUser = process.env[DEV_USER_ENV] || 'salavat';
    await users.ensure(devUser);
    await users.setRoles(devUser, ['admin']);
  }

  const reader = new StaticInstanceReader();
  const jira = makeJiraClient(process.env);
  const settings = new SettingsStore(new JsonStore<Settings>(join(cfg.dataDir, 'settings.json'), defaultSettings));

  const app = createApp({
    repo, users, audit, changes, instances, reader, jira, settings,
    serviceAccount: serviceAccountFromEnv(process.env),
    appBaseUrl: cfg.appBaseUrl,
    identity: { header: IDENTITY_HEADER, devUser: process.env[DEV_USER_ENV] },
  });

  app.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Configuration Manager API listening on http://localhost:${cfg.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
