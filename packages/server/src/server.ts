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
import { DEV_USER_ENV, IDENTITY_HEADER, MANAGED_FILE, defaultConfig, instanceBranch } from './config';

export async function main(): Promise<void> {
  // Load secrets/config from a .env file if present (SERVICE_ACCOUNT_*, APP_BASE_URL, ...).
  try { process.loadEnvFile(); } catch { /* no .env file, use real env */ }
  const cfg = {
    ...defaultConfig,
    appBaseUrl: process.env.APP_BASE_URL ?? defaultConfig.appBaseUrl,
    port: Number(process.env.PORT ?? defaultConfig.port),
  };

  const repo = new ConfigRepo(cfg.repoDir, MANAGED_FILE);
  // The seed file (a sample config, kept out of git under configsMoc/) is only used the
  // first time the repo is initialized. If it is absent, fall back to a placeholder so a
  // fresh clone still starts; a real config can be dropped into configsMoc/ later.
  const seed = await readFile(cfg.seedFile, 'utf8').catch(
    () => `# ${MANAGED_FILE}\n# Seed file not found at ${cfg.seedFile}.\n# Add your own config here (see configsMoc/) to seed instance branches.\n`,
  );
  await seedRepo(repo, seed);

  const users = new UserDirectory(new JsonStore<User[]>(join(cfg.dataDir, 'users.json'), []));
  const audit = new AuditLog(new JsonStore<AuditEvent[]>(join(cfg.dataDir, 'audit.json'), []));
  const changes = new ChangeStore(new JsonStore<Change[]>(join(cfg.dataDir, 'changes.json'), []));
  const instances = new InstanceStore(new JsonStore<ManagedInstance[]>(join(cfg.dataDir, 'instances.json'), []));
  await seedInstances(instances);

  // Dev convenience: outside production, the default dev identity is an admin so you can
  // drive the whole app immediately. A real reverse proxy + Windows auth is used in prod.
  if (process.env.NODE_ENV !== 'production') {
    const devUser = process.env[DEV_USER_ENV] || 'admin';
    await users.ensure(devUser);
    await users.setRoles(devUser, ['admin']);
  }

  const reader = new StaticInstanceReader();
  // Dev stand-in: with no real instances to reach, seed each instance's "live" file from the
  // version currently recorded in the repo, so a Sync is a clean no-op until the live content
  // actually drifts. A real reader (network share / SSH via the service account) replaces this
  // behind the same interface in production.
  if (process.env.NODE_ENV !== 'production') {
    for (const inst of await instances.list()) {
      try {
        reader.set(inst.code, MANAGED_FILE, await repo.readFile(instanceBranch(inst.code)));
      } catch { /* no recorded file yet — leave unset so Sync honestly reports it unreachable */ }
    }
  }
  const settings = new SettingsStore(new JsonStore<Settings>(join(cfg.dataDir, 'settings.json'), defaultSettings));

  const app = createApp({
    repo, users, audit, changes, instances, reader, settings,
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
