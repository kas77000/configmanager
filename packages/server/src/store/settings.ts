import { JsonStore } from './json-store';

export interface Settings {
  /** Quant-team distribution list, CC'd on every approval request. */
  quantDistributionEmail: string;
}

export const defaultSettings: Settings = {
  quantDistributionEmail: '',
};

/**
 * The service account used to reach the instances. It is provided by the environment
 * (a .env file / real env vars), not stored by the app. Only the username and a
 * "configured" flag are ever exposed; the password stays in the server's environment.
 */
export interface ServiceAccount { user: string; configured: boolean }

export function serviceAccountFromEnv(env: NodeJS.ProcessEnv): ServiceAccount {
  return { user: env.SERVICE_ACCOUNT_USER ?? '', configured: (env.SERVICE_ACCOUNT_PASSWORD ?? '').length > 0 };
}

export class SettingsStore {
  constructor(private readonly store: JsonStore<Settings>) {}

  async get(): Promise<Settings> {
    return { ...(await this.store.read()) };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    return this.store.update((s) => {
      Object.assign(s, patch);
      return { ...s };
    });
  }
}
