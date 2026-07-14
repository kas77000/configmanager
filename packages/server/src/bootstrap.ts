import { ConfigRepo } from './git/repo';
import { InstanceStore, type ManagedInstance } from './store/instances';
import { INSTANCES, MANAGED_FILE, UAT_INSTANCE, environmentOf, instanceBranch } from './config';

/** The default instance registry, used to seed a fresh store. */
export function defaultInstances(): ManagedInstance[] {
  return INSTANCES.map((code) => ({
    code,
    environment: environmentOf(code),
    uat: code === UAT_INSTANCE,
    files: [MANAGED_FILE],
  }));
}

/** Seeds one git branch per default instance from the same starting file on first init. */
export async function seedRepo(repo: ConfigRepo, seed: string): Promise<void> {
  const first = INSTANCES[0];
  const created = await repo.init(seed, instanceBranch(first));
  if (!created) return;
  for (const code of INSTANCES.slice(1)) {
    await repo.createBranch(instanceBranch(code), instanceBranch(first));
  }
}

/** Seeds the instance registry from defaults if it is empty. */
export async function seedInstances(store: InstanceStore): Promise<void> {
  if ((await store.list()).length > 0) return;
  for (const inst of defaultInstances()) await store.create(inst);
}
