import { ConfigRepo } from './git/repo';
import { INSTANCES, instanceBranch } from './config';

/** Seeds one branch per instance from the same starting file on first init (idempotent). */
export async function seedRepo(repo: ConfigRepo, seed: string): Promise<void> {
  const first = INSTANCES[0];
  const created = await repo.init(seed, instanceBranch(first));
  if (!created) return;
  for (const code of INSTANCES.slice(1)) {
    await repo.createBranch(instanceBranch(code), instanceBranch(first));
  }
}
