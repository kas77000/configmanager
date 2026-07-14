import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Minimal JSON-file persistence with in-memory caching and serialized writes. */
export class JsonStore<T> {
  private cache: T | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly initial: T,
  ) {}

  async read(): Promise<T> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      this.cache = JSON.parse(raw) as T;
    } catch {
      this.cache = this.initial;
    }
    return this.cache;
  }

  /** Applies `mutator` to the current value and persists the result atomically-ish. */
  async update<R>(mutator: (data: T) => R | Promise<R>): Promise<R> {
    const run = this.tail.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      this.cache = data;
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(data, null, 2));
      return result;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
