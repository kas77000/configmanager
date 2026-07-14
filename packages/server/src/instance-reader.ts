/**
 * Reads the live config file from an instance (via the service account). Read-only:
 * the app pulls from instances but never writes to them. `read` returns null when the
 * instance/file is unreachable or absent.
 *
 * Phase 1 ships a StaticInstanceReader (in-memory) for dev/tests. A real implementation
 * (network share / SSH via the service account) plugs in behind this same interface.
 */
export interface InstanceReader {
  read(instance: string, file: string): Promise<string | null>;
}

export class StaticInstanceReader implements InstanceReader {
  private readonly contents = new Map<string, string>();

  private key(instance: string, file: string): string {
    return `${instance}:${file}`;
  }

  set(instance: string, file: string, content: string): void {
    this.contents.set(this.key(instance, file), content);
  }

  async read(instance: string, file: string): Promise<string | null> {
    return this.contents.get(this.key(instance, file)) ?? null;
  }
}
