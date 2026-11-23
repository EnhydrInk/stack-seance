import '../compiler/helpers/noNetwork';
// Bug 2 of worker-body-limit-and-model-error-log-fix: a failed SDK call writes one failure entry
// and rejects with the same error. Requirement numbers here refer to that spec's bugfix.md.
//
// In each test the assertions that already hold on the unfixed code come first, and the exact
// `logs` check comes last, so the only thing the unfixed code can fail is the missing entry.
import { describe, it, expect } from 'vitest';
import { verifyAccess } from '../../worker/src/access';
import { makeAsk } from '../../worker/src/ask';
import { handle, type Deps } from '../../worker/src/handle';
import { readLimits, take } from '../../worker/src/limits';
import { keys, signToken } from './helpers/accessKeys';
import { ACCESS_ON, IP, jsonRequest } from './helpers/bodies';
import {
  AUTHENTICATION,
  CONNECTION,
  FAILURE_ROWS,
  INPUT,
  KEY,
  MARK,
  REQUEST,
  REQUEST_ID,
  REQUEST_TEXTS,
  TIMEOUT,
  apiFetch,
  type FailureRow,
  type FakeFetch,
} from './helpers/fakeApi';
import { MemoryStore } from './helpers/memoryStore';

const NOON = Date.UTC(2026, 11, 5, 12, 0, 0);
const TOKEN = await signToken();

/** Texts no failure entry may hold, whatever the call failed with (bugfix 2.5). */
const NEVER_LOGGED = [REQUEST_ID, 'enforced_spend_limit_reached', KEY, MARK, 'Compile this request'];

/** The rejection of `promise`. A promise that resolves fails the test. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(`expected the Ask to reject, but it resolved with ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}

function expectNoLeak(text: string, leaks: readonly string[]): void {
  for (const leak of leaks) if (leak !== '') expect(text, leak).not.toContain(leak);
}

/** One Ask call against `row`'s fake, with its own log. */
async function failOnce(row: FailureRow) {
  const { fetch, calls } = apiFetch(row.respond);
  const logs: Record<string, unknown>[] = [];
  const ask = makeAsk({ apiKey: KEY, fetch, timeoutMs: row.timeoutMs, log: (entry) => logs.push(entry) });
  const rejection = await rejectionOf(ask(INPUT));
  return { rejection: rejection as Error & { status?: unknown; requestID?: unknown }, calls, logs };
}

describe('Property 3, bugfix 2.3 to 2.5 a failed SDK call writes one failure entry and rejects with the same error', () => {
  // fails until task 6.1 fixes bug 2
  it.fails.each(FAILURE_ROWS)('$name: logs exactly the failure entry, and rejects with the SDK error unwrapped', async (row) => {
    const { rejection, calls, logs } = await failOnce(row);

    expect(rejection).toBeInstanceOf(row.rejects);
    expect(rejection.name).toBe(row.className);
    expect(rejection.status).toBe(row.status);
    // The request id and the cause are still on it, so it was not wrapped (3.14).
    expect(rejection.requestID).toBe(row.requestID);
    expect(rejection.cause).toBe(row.cause);
    expect(calls).toHaveLength(1);
    expectNoLeak(JSON.stringify(logs), [...NEVER_LOGGED, ...row.leaks, rejection.message]);
    expect(logs, 'logs').toStrictEqual([row.entry]);
  });
});

/** handle with the real Ask and the same log for both, as worker/src/index.ts wires them, with Access on. */
function wired(fetch: FakeFetch, timeoutMs: number | undefined) {
  const logs: Record<string, unknown>[] = [];
  const log = (entry: Record<string, unknown>) => logs.push(entry);
  const store = new MemoryStore();
  const deps: Deps = {
    vars: ACCESS_ON,
    verifyAccess: (r) => verifyAccess(r, ACCESS_ON.ACCESS_AUD, keys),
    limiter: { take: async (key) => take(store, key, NOON, readLimits(ACCESS_ON)) },
    ask: makeAsk({ apiKey: KEY, fetch, timeoutMs, log }),
    log,
  };
  return { deps, logs, store };
}

/** The request line of a compile whose one Model_Call failed: unchanged by the fix (3.14). */
const REQUEST_LINE = { event: 'request', status: 502, error: 'model', calls: [{ call: 1, result: 'failed' }] };

describe('Property 3, bugfix 2.3, 2.4 and 3.14 through handle, wired as worker/src/index.ts wires it', () => {
  // fails until task 6.1 fixes bug 2
  it.fails.each([AUTHENTICATION, CONNECTION, TIMEOUT])(
    '$name: 502 model, counted once, one fetch, and the failure entry before the request line',
    async (row) => {
      const { fetch, calls } = apiFetch(row.respond);
      const { deps, logs, store } = wired(fetch, row.timeoutMs);
      const response = await handle(jsonRequest({ body: JSON.stringify(REQUEST), token: TOKEN }), deps);
      const text = await response.text();

      expect(response.status).toBe(502);
      expect(JSON.parse(text)).toStrictEqual({ ok: false, error: 'model' });
      expect(store.snapshot()).toEqual({ day: '2026-12-05', [`ip:${IP}`]: 1, site: 1 });
      expect(calls).toHaveLength(1);
      const outputs = [text, JSON.stringify([...response.headers]), JSON.stringify(logs)].join('\n');
      expectNoLeak(outputs, [KEY, ...REQUEST_TEXTS, IP, TOKEN, REQUEST_ID, 'Compile this request', ...row.leaks]);
      expect(logs, 'logs').toStrictEqual([row.entry, REQUEST_LINE]);
    },
  );
});
