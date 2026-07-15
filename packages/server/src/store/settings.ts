import { JsonStore } from './json-store';

export interface Settings {
  /** Quant-team distribution list, CC'd on every approval request. */
  quantDistributionEmail: string;
  /** Jira epic that all config-change tickets are created under. */
  jiraEpicKey: string;
  /** Service account used to connect to the instances (to read live configs). */
  serviceAccountUser: string;
  serviceAccountPassword: string;
}

export const defaultSettings: Settings = {
  quantDistributionEmail: '',
  jiraEpicKey: 'BSGPTALGO-550',
  serviceAccountUser: '',
  serviceAccountPassword: '',
};

/** Settings safe to send to the client: the password is never returned, only whether it is set. */
export interface PublicSettings {
  quantDistributionEmail: string;
  jiraEpicKey: string;
  serviceAccountUser: string;
  serviceAccountConfigured: boolean;
}

export function toPublicSettings(s: Partial<Settings>): PublicSettings {
  return {
    quantDistributionEmail: s.quantDistributionEmail ?? '',
    jiraEpicKey: s.jiraEpicKey ?? defaultSettings.jiraEpicKey,
    serviceAccountUser: s.serviceAccountUser ?? '',
    serviceAccountConfigured: (s.serviceAccountPassword ?? '').length > 0,
  };
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
