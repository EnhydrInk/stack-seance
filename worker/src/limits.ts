// Daily limits (Requirement 10; design.md, "worker/src/limits.ts and the Limit_Store").
// The Limit_Store is the DailyLimits Durable Object, used through its synchronous KV API.
// `take` makes no `await`, so inside the one instance the check and the count are one step
// and two requests that arrive together cannot both take the last slot (10.4).
//
// Keys: `day` holds the current UTC_Day as YYYY-MM-DD, `site` the site count, and
// `ip:<Client_Key>` a client's count. No other data is stored.

export interface Limits { perIp: number; perSite: number }

export type TakeResult = { ok: true } | { ok: false; scope: 'ip' | 'site' };

/** The part of the Durable Object's `ctx.storage.kv` that `take` uses. Tests pass a Map. */
export interface CountStore {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
  delete(key: string): boolean;
  list(options: { prefix: string }): Iterable<[string, unknown]>;
}

export const DEFAULT_LIMITS: Limits = { perIp: 20, perSite: 200 };

/** `LIMIT_PER_IP` and `LIMIT_PER_SITE` when they are whole numbers of 0 or more, else 20 and 200 (10.6). */
export function readLimits(vars: { LIMIT_PER_IP?: string; LIMIT_PER_SITE?: string }): Limits {
  return {
    perIp: wholeNumber(vars.LIMIT_PER_IP) ?? DEFAULT_LIMITS.perIp,
    perSite: wholeNumber(vars.LIMIT_PER_SITE) ?? DEFAULT_LIMITS.perSite,
  };
}

function wholeNumber(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * The Client_Key from `CF-Connecting-IP` (10.7): `unknown` without the header, an IPv4 address
 * as written, and an IPv6 address by its first 64 bits, so `2001:DB8:0:0:1::5` and
 * `2001:db8::abcd` both give `2001:db8:0:0::/64`. Cloudflare sets the header, so the value is
 * always a well-formed address.
 */
export function clientKey(header: string | null): string {
  if (header === null) return 'unknown';
  if (!header.includes(':')) return header;
  const [head = '', tail = ''] = header.split('::');
  const before = head === '' ? [] : head.split(':');
  const after = tail === '' ? [] : tail.split(':');
  const groups = header.includes('::')
    ? [...before, ...Array<string>(Math.max(0, 8 - before.length - after.length)).fill('0'), ...after]
    : before;
  const prefix = groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=[0-9a-f])/, ''));
  return `${prefix.join(':')}::/64`;
}

/** The UTC_Day of a time, as YYYY-MM-DD. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Checks both limits for `key` and, when neither is reached, counts the request once. */
export function take(store: CountStore, key: string, now: number, limits: Limits): TakeResult {
  // 1. A new UTC_Day drops the counts of earlier days with their Client_Keys (10.5, 10.9). The keys
  //    are collected before any is deleted, so nothing is deleted while the listing is being read.
  const day = utcDay(now);
  if (store.get('day') !== day) {
    const old = Array.from(store.list({ prefix: 'ip:' }), ([k]) => k);
    for (const k of old) store.delete(k);
    store.put('site', 0);
    store.put('day', day);
  }

  // 2. The client's limit comes first, so the scope is ip when both are reached (10.2, 10.3).
  const ipKey = `ip:${key}`;
  const mine = count(store.get(ipKey));
  if (mine >= limits.perIp) return { ok: false, scope: 'ip' };

  // 3. The site's limit.
  const site = count(store.get('site'));
  if (site >= limits.perSite) return { ok: false, scope: 'site' };

  // 4. Count the request. Only this branch writes a count.
  store.put(ipKey, mine + 1);
  store.put('site', site + 1);
  return { ok: true };
}
