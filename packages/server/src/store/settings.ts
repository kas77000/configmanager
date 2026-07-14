import { JsonStore } from './json-store';

export interface Settings {
  /** Quant-team distribution list, CC'd on every approval request. */
  quantDistributionEmail: string;
}

export const defaultSettings: Settings = { quantDistributionEmail: '' };

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
