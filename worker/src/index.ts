// The Worker's entry point (design.md, "worker/src/index.ts and wrangler.toml"): the real
// dependencies wired into handle, and the DailyLimits Durable Object that holds the counts.
// This is the only module that imports cloudflare:workers, so it is checked by
// tsconfig.worker.json alone and every other Worker module runs in Node under vitest.
import { DurableObject } from 'cloudflare:workers';
import { createRemoteJWKSet } from 'jose';
import { CERTS_URL, verifyAccess } from './access';
import { makeAsk } from './ask';
import { handle } from './handle';
import { readLimits, take, type Limits, type TakeResult } from './limits';

export interface Env {
  REQUIRE_ACCESS?: string;
  ACCESS_AUD?: string;
  LIMIT_PER_IP?: string;
  LIMIT_PER_SITE?: string;
  /** A Worker secret, never in wrangler.toml (7.9). */
  ANTHROPIC_API_KEY?: string;
  LIMITS: DurableObjectNamespace<DailyLimits>;
}

/** Made once per isolate: jose caches the Access keys and fetches them again for an unknown kid (9.6). */
const keys = createRemoteJWKSet(new URL(CERTS_URL));

/**
 * The Limit_Store: one SQLite-backed instance for the whole site. `take` is synchronous, so one
 * call checks both limits and counts in one step (10.4).
 */
export class DailyLimits extends DurableObject<Env> {
  take(key: string, limits: Limits): TakeResult {
    return take(this.ctx.storage.kv, key, Date.now(), limits);
  }
}

export default {
  fetch(request, env) {
    const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
    const limits = env.LIMITS.get(env.LIMITS.idFromName('site'));
    return handle(request, {
      vars: env,
      verifyAccess: (r) => verifyAccess(r, env.ACCESS_AUD, keys),
      limiter: { take: (key) => limits.take(key, readLimits(env)) },
      ask: makeAsk({ apiKey: env.ANTHROPIC_API_KEY, log }),
      log,
    });
  },
} satisfies ExportedHandler<Env>;
