import '../compiler/helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import type { CompileRequest } from '../../src/compiler/index';
import { verifyAccess } from '../../worker/src/access';
import { MAX_BODY_BYTES, handle, type Deps, type WorkerVars } from '../../worker/src/handle';
import { readLimits, take } from '../../worker/src/limits';
import { mouseUp, nothingText, replyText } from '../compiler/helpers/fixtures';
import { refusalStep, rejectStep, replyStep, scriptedAsk, type Step } from '../compiler/helpers/fakeModel';
import { AUD, keys, signToken } from './helpers/accessKeys';
import { MemoryStore } from './helpers/memoryStore';

const ORIGIN = 'https://stack-seance.enhydrink.com';
const NOON = Date.UTC(2026, 11, 5, 12, 0, 0);
const IP = '203.0.113.99';

/** Names no other part of a request or reply holds, so a leak shows up in a plain substring search. */
const SENTENCE = 'Clicking this opens the Quokka cellar and lets a Wombat bat out';
const request: CompileRequest = {
  sentence: SENTENCE,
  stackName: 'Platypus Manor',
  cardNames: ['Quokka Gate', 'Quokka Hall', 'Quokka Attic'],
  cardName: 'Quokka Hall',
  fieldNames: ['quokkafield'],
  buttonNames: ['Quokka button'],
  stackNames: ['Platypus Manor', 'Echidna Help'],
};
const SECRETS = [SENTENCE, 'Platypus', 'Quokka', 'quokkafield', 'Echidna', IP];

const VALID = { script: mouseUp('go to card "Cellar"', 'release bat'), newCards: ['Cellar'], label: 'To the cellar', skipped: [] };

const TOKEN = await signToken();

interface Setup {
  steps?: Step[];
  vars?: WorkerVars;
  store?: MemoryStore;
  limiter?: Deps['limiter'];
}

function setup({ steps = [], vars = { REQUIRE_ACCESS: 'true', ACCESS_AUD: AUD }, store = new MemoryStore(), limiter }: Setup = {}) {
  const { ask, inputs } = scriptedAsk(steps);
  const logs: Record<string, unknown>[] = [];
  const deps: Deps = {
    vars,
    verifyAccess: (r) => verifyAccess(r, vars.ACCESS_AUD, keys),
    limiter: limiter ?? { take: async (key) => take(store, key, NOON, readLimits(vars)) },
    ask,
    log: (entry) => logs.push(entry),
  };
  return { deps, inputs, logs, store };
}

interface Send {
  path?: string;
  method?: string;
  body?: string | Uint8Array | null;
  contentType?: string | null;
  token?: string | null;
  ip?: string | null;
}

function http({ path = '/api/compile', method = 'POST', body = JSON.stringify(request), contentType = 'application/json', token = TOKEN, ip = IP }: Send = {}): Request {
  const headers = new Headers();
  if (contentType !== null) headers.set('Content-Type', contentType);
  if (token !== null) headers.set('Cf-Access-Jwt-Assertion', token);
  if (ip !== null) headers.set('CF-Connecting-IP', ip);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(`${ORIGIN}${path}`, { method, headers, body: hasBody ? body : undefined });
}

async function expectJson(response: Response, status: number, body: unknown): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toStrictEqual(body);
}

/** The body of a request as raw bytes, so no default Content-Type is added. */
const bytes = (text: string) => new TextEncoder().encode(text);

describe('Requirement 1, 3.1, 3.6 answers from the compiler', () => {
  it('answers 200 with the accepted button', async () => {
    const { deps, logs, inputs } = setup({ steps: [replyStep(replyText(VALID))] });
    await expectJson(await handle(http(), deps), 200, { ok: true, ...VALID });
    expect(inputs).toHaveLength(1);
    expect(logs).toStrictEqual([{ event: 'request', status: 200, error: null, calls: [{ call: 1, result: 'accepted' }] }]);
  });

  it('answers 422 with the skipped phrases of a Nothing_Reply', async () => {
    const { deps } = setup({ steps: [replyStep(nothingText({ skipped: ['send an email'] }))] });
    await expectJson(await handle(http(), deps), 422, { ok: false, error: 'nothing', skipped: ['send an email'] });
  });

  it('answers 502 model after three broken replies, a Refusal, or a failed call', async () => {
    const broken = () => replyStep(replyText({ ...VALID, label: '' }));
    for (const steps of [[broken(), broken(), broken()], [refusalStep()], [rejectStep()]]) {
      const { deps } = setup({ steps });
      await expectJson(await handle(http(), deps), 502, { ok: false, error: 'model' });
    }
  });

  it('logs one line with the status, the error code and every CallEvent', async () => {
    const { deps, logs } = setup({ steps: [replyStep(replyText({ ...VALID, newCards: [] })), replyStep(replyText(VALID))] });
    await handle(http(), deps);
    expect(logs).toStrictEqual([
      {
        event: 'request',
        status: 200,
        error: null,
        calls: [{ call: 1, result: 'broken', rules: [3] }, { call: 2, result: 'accepted' }],
      },
    ]);
  });
});

describe('Requirement 2 bad requests', () => {
  async function expectBad(send: Send, label: string): Promise<void> {
    const { deps, inputs, store, logs } = setup({ steps: [replyStep(replyText(VALID))] });
    const response = await handle(http(send), deps);
    expect(response.status, label).toBe(400);
    await expectJson(response, 400, { ok: false, error: 'bad-request' });
    expect(inputs, label).toHaveLength(0);
    expect(store.snapshot(), label).toEqual({});
    expect(logs, label).toStrictEqual([{ event: 'request', status: 400, error: 'bad-request', calls: [] }]);
  }

  const body = (overrides: Record<string, unknown>) => JSON.stringify({ ...request, ...overrides });

  it('needs the media type application/json', async () => {
    await expectBad({ contentType: null, body: bytes(JSON.stringify(request)) }, 'no Content-Type');
    await expectBad({ contentType: 'text/plain' }, 'text/plain');
    await expectBad({ contentType: 'application/jsonx' }, 'application/jsonx');
    await expectBad({ contentType: 'application/json-patch+json' }, 'a json subtype');
    await expectBad({ contentType: 'multipart/form-data; boundary=application/json' }, 'json only in a parameter');
  });

  it('takes application/json with parameters and in any case', async () => {
    for (const contentType of ['application/json; charset=utf-8', 'APPLICATION/JSON', ' application/json ;charset=UTF-8']) {
      const { deps } = setup({ steps: [replyStep(replyText(VALID))] });
      expect((await handle(http({ contentType }), deps)).status, contentType).toBe(200);
    }
  });

  it('takes a body of 256 KiB and rejects one byte more', async () => {
    const base = JSON.stringify({ ...request, pad: '' });
    const exact = JSON.stringify({ ...request, pad: 'x'.repeat(MAX_BODY_BYTES - bytes(base).byteLength) });
    expect(bytes(exact).byteLength).toBe(MAX_BODY_BYTES);
    const { deps } = setup({ steps: [replyStep(replyText(VALID))] });
    expect((await handle(http({ body: exact }), deps)).status).toBe(200);
    await expectBad({ body: `${exact} ` }, 'one byte over');
  });

  it('rejects invalid UTF-8, text that is not JSON, and JSON that is not an object', async () => {
    const valid = bytes(JSON.stringify(request));
    const broken = new Uint8Array([...valid.slice(0, 14), 0xff, 0xfe, ...valid.slice(14)]);
    await expectBad({ body: broken }, 'invalid UTF-8');
    await expectBad({ body: 'hello' }, 'not JSON');
    await expectBad({ body: '' }, 'empty body');
    await expectBad({ body: JSON.stringify([request]) }, 'an array');
    await expectBad({ body: 'null' }, 'null');
  });

  it('rejects a missing field and a field of the wrong type', async () => {
    const { stackNames: _, ...missing } = request;
    await expectBad({ body: JSON.stringify(missing) }, 'missing stackNames');
    await expectBad({ body: body({ cardNames: ['Quokka Gate', 3] }) }, 'a number in cardNames');
    await expectBad({ body: body({ sentence: 7 }) }, 'a number as sentence');
  });

  it('rejects the sentence and name limits', async () => {
    await expectBad({ body: body({ sentence: '' }) }, 'empty sentence');
    await expectBad({ body: body({ sentence: 's'.repeat(501) }) }, '501 characters');
    await expectBad({ body: body({ sentence: ' \t\n\u3000' }) }, 'blank sentence');
    await expectBad({ body: body({ buttonNames: Array.from({ length: 101 }, (_, i) => `b${i}`) }) }, '101 names');
    await expectBad({ body: body({ cardName: 'c'.repeat(101) }) }, 'a name of 101 characters');
  });

  it('ignores fields that CompileRequest does not define', async () => {
    const { deps, inputs } = setup({ steps: [replyStep(replyText(VALID))] });
    const response = await handle(http({ body: body({ label: 'Injected label', extra: 'x' }) }), deps);
    expect(response.status).toBe(200);
    const first = inputs[0]!.messages[0]!;
    expect(first.role === 'user' && first.text).not.toContain('Injected label');
  });
});

describe('Requirement 8.1, 8.2 routes', () => {
  it('answers 404 in plain text for any other method or path', async () => {
    for (const [method, path] of [['GET', '/api/compile'], ['HEAD', '/api/compile'], ['PUT', '/api/compile'], ['POST', '/api/compile/'], ['POST', '/api/other'], ['GET', '/'], ['POST', '/API/compile']]) {
      const { deps, store, logs } = setup();
      const response = await handle(http({ method, path }), deps);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('text/plain');
      // The runtime drops the body of a HEAD answer on the wire; the Response still holds it.
      expect(await response.text()).toBe('Not found');
      expect(store.snapshot()).toEqual({});
      expect(logs).toStrictEqual([{ event: 'request', status: 404, error: 'not-found', calls: [] }]);
    }
  });

  it('ignores a query string', async () => {
    const { deps } = setup({ steps: [replyStep(replyText(VALID))] });
    expect((await handle(http({ path: '/api/compile?debug=1&x=y' }), deps)).status).toBe(200);
  });

  it('answers 401 before 404 while Access is required', async () => {
    const { deps } = setup();
    await expectJson(await handle(http({ method: 'GET', path: '/api/other', token: null }), deps), 401, { ok: false, error: 'unauthorized' });
    expect((await handle(http({ method: 'GET', path: '/api/other' }), deps)).status).toBe(404);
  });
});

describe('Requirement 9 Access through handle', () => {
  it('answers 401 without a valid token, and does not count or call the model', async () => {
    for (const token of [null, 'not.a.jwt', await signToken({ aud: 'another-app' })]) {
      const { deps, inputs, store } = setup({ steps: [replyStep(replyText(VALID))] });
      await expectJson(await handle(http({ token }), deps), 401, { ok: false, error: 'unauthorized' });
      expect(inputs).toHaveLength(0);
      expect(store.snapshot()).toEqual({});
    }
  });

  it('answers 401 to every request while ACCESS_AUD is empty', async () => {
    const { deps } = setup({ vars: { REQUIRE_ACCESS: 'true', ACCESS_AUD: '' } });
    expect((await handle(http(), deps)).status).toBe(401);
    const { deps: missing } = setup({ vars: {} });
    expect((await handle(http(), missing)).status).toBe(401);
  });

  it('needs no token with REQUIRE_ACCESS "false"', async () => {
    const { deps } = setup({ steps: [replyStep(replyText(VALID))], vars: { REQUIRE_ACCESS: 'false' } });
    await expectJson(await handle(http({ token: null }), deps), 200, { ok: true, ...VALID });
  });

  it('answers 401 when the Access check itself throws', async () => {
    const { deps } = setup();
    const throwing: Deps = { ...deps, verifyAccess: async () => { throw new Error('boom'); } };
    expect((await handle(http(), throwing)).status).toBe(401);
  });
});

describe('Requirement 10 counting through handle', () => {
  it('answers 429 with the scope, and does not count it', async () => {
    const atIp = new MemoryStore({ day: '2026-12-05', site: 20, [`ip:${IP}`]: 20 });
    const before = atIp.snapshot();
    const { deps, inputs } = setup({ store: atIp, steps: [replyStep(replyText(VALID))] });
    await expectJson(await handle(http(), deps), 429, { ok: false, error: 'limit', scope: 'ip' });
    expect(atIp.snapshot()).toEqual(before);
    expect(inputs).toHaveLength(0);

    const atSite = new MemoryStore({ day: '2026-12-05', site: 200 });
    const { deps: siteDeps } = setup({ store: atSite });
    await expectJson(await handle(http(), siteDeps), 429, { ok: false, error: 'limit', scope: 'site' });
    expect(atSite.snapshot()).toEqual({ day: '2026-12-05', site: 200 });
  });

  it('takes the limits from the vars', async () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 0, [`ip:${IP}`]: 2 });
    const { deps } = setup({ store, vars: { REQUIRE_ACCESS: 'false', LIMIT_PER_IP: '2' } });
    expect((await handle(http(), deps)).status).toBe(429);
  });

  it('leaves the store unchanged for 400, 401 and 404', async () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 7, [`ip:${IP}`]: 3 });
    const before = store.snapshot();
    const { deps } = setup({ store });
    expect((await handle(http({ body: 'hello' }), deps)).status).toBe(400);
    expect((await handle(http({ token: null }), deps)).status).toBe(401);
    expect((await handle(http({ path: '/api/other' }), deps)).status).toBe(404);
    expect(store.snapshot()).toEqual(before);
  });

  it('counts a request whose ask fails once, and a 3-call request once', async () => {
    const failing = setup({ steps: [rejectStep()] });
    expect((await handle(http(), failing.deps)).status).toBe(502);
    expect(failing.store.snapshot()).toEqual({ day: '2026-12-05', [`ip:${IP}`]: 1, site: 1 });

    const broken = () => replyStep(replyText({ ...VALID, label: '' }));
    const three = setup({ steps: [broken(), broken(), broken()] });
    expect((await handle(http(), three.deps)).status).toBe(502);
    expect(three.inputs).toHaveLength(3);
    expect(three.store.snapshot()).toEqual({ day: '2026-12-05', [`ip:${IP}`]: 1, site: 1 });
  });

  it('counts by the Client_Key: an IPv6 /64, and unknown without the header', async () => {
    const store = new MemoryStore();
    const steps = () => [replyStep(replyText(VALID))];
    const first = setup({ store, steps: steps() });
    await handle(http({ ip: '2001:db8:aa:bb::1' }), first.deps);
    const second = setup({ store, steps: steps() });
    await handle(http({ ip: '2001:db8:aa:bb:ffff::2' }), second.deps);
    const third = setup({ store, steps: steps() });
    await handle(http({ ip: null }), third.deps);
    expect(store.snapshot()).toEqual({ day: '2026-12-05', 'ip:2001:db8:aa:bb::/64': 2, 'ip:unknown': 1, site: 3 });
  });

  it('answers 502 model without a model call when the limiter throws, and logs the error name only', async () => {
    const limiter = { take: async () => { throw new TypeError(`storage failed for ${IP}`); } };
    const { deps, inputs, logs } = setup({ limiter, steps: [replyStep(replyText(VALID))] });
    await expectJson(await handle(http(), deps), 502, { ok: false, error: 'model' });
    expect(inputs).toHaveLength(0);
    expect(logs).toStrictEqual([{ event: 'request', status: 502, error: 'model', calls: [], thrown: 'TypeError' }]);
  });
});

describe('Requirement 1.5 anything that throws after the route', () => {
  it('answers 502 model when reading the body fails', async () => {
    const { deps, logs } = setup();
    const req = http();
    const failing = new Proxy(req, {
      get(target, prop) {
        if (prop === 'arrayBuffer') return () => Promise.reject(new RangeError('stream broke'));
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expectJson(await handle(failing, deps), 502, { ok: false, error: 'model' });
    expect(logs).toStrictEqual([{ event: 'request', status: 502, error: 'model', calls: [], thrown: 'RangeError' }]);
  });
});

describe('Requirement 11 nothing personal in logs or responses', () => {
  it('no log line and no response body holds the sentence, a name, the IP or the token', async () => {
    const outputs: string[] = [];
    const run = async (s: Setup, send: Send = {}) => {
      const { deps, logs } = setup(s);
      const response = await handle(http(send), deps);
      outputs.push(await response.text(), JSON.stringify(logs), JSON.stringify([...response.headers]));
    };
    // A reply that echoes request names and breaks Rules 3 and 7: its reports go to the model, never to the log.
    const echoing = replyText({ ...VALID, script: mouseUp('go to card "Quokka Nowhere"'), newCards: [], label: 'Quokka button' });
    await run({ steps: [replyStep(replyText(VALID))] });
    await run({ steps: [replyStep(nothingText())] });
    await run({ steps: [replyStep(echoing), replyStep(echoing), replyStep(echoing)] });
    await run({ steps: [rejectStep(new Error(`failed for ${SENTENCE}`))] });
    await run({}, { body: JSON.stringify({ ...request, sentence: '' }) });
    await run({}, { token: null });
    await run({}, { path: '/api/other' });
    await run({ store: new MemoryStore({ day: '2026-12-05', site: 200 }) });
    await run({ limiter: { take: async () => { throw new Error(`no slot for ${IP} ${TOKEN}`); } } });
    const all = outputs.join('\n');
    for (const secret of [...SECRETS, TOKEN]) expect(all, secret).not.toContain(secret);
  });
});
