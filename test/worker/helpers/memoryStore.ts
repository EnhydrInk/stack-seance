// A Map-backed CountStore for the limit tests, standing in for the Durable Object's
// synchronous KV storage.
import type { CountStore } from '../../../worker/src/limits';

export class MemoryStore implements CountStore {
  readonly map = new Map<string, unknown>();
  /** Bumped on every write, so `list` can tell when the store changed while it was being read. */
  private version = 0;

  constructor(entries: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, value);
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  put(key: string, value: unknown): void {
    this.version++;
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    this.version++;
    return this.map.delete(key);
  }

  /** The entries whose keys start with `prefix`, sorted by key. Fails if the store changes while it is read. */
  *list(options: { prefix: string }): Iterable<[string, unknown]> {
    const start = this.version;
    const keys = [...this.map.keys()].filter((k) => k.startsWith(options.prefix)).sort();
    for (const key of keys) {
      if (this.version !== start) throw new Error('the store changed while list() was being read');
      yield [key, this.map.get(key)];
    }
  }

  /** Every entry, sorted by key, for comparing whole stores. */
  snapshot(): Record<string, unknown> {
    return Object.fromEntries([...this.map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
}
