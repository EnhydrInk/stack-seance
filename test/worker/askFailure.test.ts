import '../compiler/helpers/noNetwork';
// Bug 2 of worker-body-limit-and-model-error-log-fix: a failed SDK call writes one failure entry
// and rejects with the same error. Requirement numbers here refer to that spec's bugfix.md.
//
// In each test the assertions that already hold on the unfixed code come first, and the exact
// `logs` check comes last, so the only thing the unfixed code can fail is the missing entry.
import { describe, it, expect } from 'vitest';
import { verifyAccess } from '../../worker/src/access';
import { failureEntry, makeAsk, toModelReply } from '../../worker/src/ask';
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
  REFUSAL,
  REQUEST,
  REQUEST_ID,
  REQUEST_TEXTS,
  SUCCESS,
  TIMEOUT,
  apiFetch,
  expectedRequest,
  messageBody,
  messageOf,
  sentBetas,
  usageEntryOf,
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
  it.each(FAILURE_ROWS)('$name: logs exactly the failure entry, and rejects with the SDK error unwrapped', async (row) => {
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
  it.each([AUTHENTICATION, CONNECTION, TIMEOUT])(
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

// Property 4 (preservation): everything below holds on the unfixed code and must keep holding
// after the fix. Where a call fails, only the entries whose event is model-call-failed are left
// out of the comparison, because the fix adds exactly those (3.14).
const FAILED = 'model-call-failed';

/** The entries of `logs` other than failure entries. */
function withoutFailures(logs: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return logs.filter((entry) => entry.event !== FAILED);
}

describe('Property 4, bugfix 3.12 and 3.15 a call that succeeds sends, logs and returns as before', () => {
  it.each([
    { name: 'end_turn', success: SUCCESS, reply: { kind: 'reply', text: '{"hasButton":false}', turn: SUCCESS.content } },
    { name: 'refusal after a fallback', success: REFUSAL, reply: { kind: 'refusal' } },
  ])('$name: writes exactly the usage entry and nothing else, and returns the Model_Reply', async ({ success, reply }) => {
    const { fetch, calls } = apiFetch(() => messageBody(success));
    const logs: Record<string, unknown>[] = [];
    const ask = makeAsk({ apiKey: KEY, fetch, log: (entry) => logs.push(entry) });

    const result = await ask(INPUT);

    expect(result).toStrictEqual(reply);
    expect(result).toStrictEqual(toModelReply(messageOf(success)));
    expect(logs).toStrictEqual([usageEntryOf(success)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toStrictEqual(expectedRequest(INPUT).body);
    expect(sentBetas(calls[0]!)).toEqual(expect.arrayContaining(expectedRequest(INPUT).betas));
  });

  it.each([AUTHENTICATION, CONNECTION, TIMEOUT])(
    "after $name, the same Ask's next successful call writes exactly its usage entry",
    async (row) => {
      const answers = [row.respond, () => messageBody(SUCCESS)];
      let next = 0;
      const { fetch, calls } = apiFetch((init) => answers[next++]!(init));
      const logs: Record<string, unknown>[] = [];
      const ask = makeAsk({ apiKey: KEY, fetch, timeoutMs: row.timeoutMs, log: (entry) => logs.push(entry) });

      const rejection = await rejectionOf(ask(INPUT));
      expect(rejection).toBeInstanceOf(row.rejects);
      expect(withoutFailures(logs)).toStrictEqual([]);

      // Only the entries written during the second call are compared, so this holds before and after the fix.
      const before = logs.length;
      const result = await ask(INPUT);
      expect(result).toStrictEqual(toModelReply(messageOf(SUCCESS)));
      expect(logs.slice(before)).toStrictEqual([usageEntryOf(SUCCESS)]);
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.body)).toStrictEqual([expectedRequest(INPUT).body, expectedRequest(INPUT).body]);
    },
  );
});

describe('Property 4, bugfix 3.13 a missing or empty key', () => {
  it.each([
    { name: 'missing', apiKey: undefined },
    { name: 'empty', apiKey: '' },
  ])('$name: rejects with Error ANTHROPIC_API_KEY is not set, with no fetch call and no entry', async ({ apiKey }) => {
    const { fetch, calls } = apiFetch(() => messageBody(SUCCESS));
    const logs: Record<string, unknown>[] = [];
    const ask = makeAsk({ apiKey, fetch, log: (entry) => logs.push(entry) });

    const rejection = await rejectionOf(ask(INPUT));

    expect(rejection).toStrictEqual(new Error('ANTHROPIC_API_KEY is not set'));
    expect(Object.getPrototypeOf(rejection)).toBe(Error.prototype);
    expect(calls).toHaveLength(0);
    expect(logs).toStrictEqual([]);
  });
});

describe('Property 4, bugfix 3.14 through handle, a failed call answers, counts and logs the request as before', () => {
  it('401 authentication_error: 502 model, counted once, one fetch, and the same request line', async () => {
    const { fetch, calls } = apiFetch(AUTHENTICATION.respond);
    const { deps, logs, store } = wired(fetch, undefined);

    const response = await handle(jsonRequest({ body: JSON.stringify(REQUEST), token: TOKEN }), deps);

    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({ ok: false, error: 'model' });
    expect(store.snapshot()).toEqual({ day: '2026-12-05', [`ip:${IP}`]: 1, site: 1 });
    expect(calls).toHaveLength(1);
    expect(withoutFailures(logs)).toStrictEqual([REQUEST_LINE]);
  });
});

describe('failureEntry, bugfix 2.5 reads fields only from an SDK APIError', () => {
  it.each([
    { name: "the string 'boom'", value: 'boom' as unknown, errorClass: 'string' },
    { name: 'undefined', value: undefined as unknown, errorClass: 'undefined' },
    { name: 'null', value: null as unknown, errorClass: 'object' },
    {
      name: 'a plain object shaped like an API error',
      value: { status: 401, type: 'authentication_error', message: MARK } as unknown,
      errorClass: 'object',
    },
    { name: 'an Error that is not from the SDK', value: new Error(MARK) as unknown, errorClass: 'Error' },
  ])('$name gives only the event and error_class $errorClass', ({ value, errorClass }) => {
    const entry = failureEntry(value);

    expect(entry).toStrictEqual({ event: FAILED, error_class: errorClass });
    expect(JSON.stringify(entry)).not.toContain(MARK);
  });
});
