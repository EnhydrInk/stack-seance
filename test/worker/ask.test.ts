import '../compiler/helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import { REPLY_SCHEMA, SYSTEM_PROMPT, type ModelInput } from '../../src/compiler/index';
import { MAX_TOKENS, MODEL, makeAsk, type AskOptions } from '../../worker/src/ask';

type FakeFetch = NonNullable<AskOptions['fetch']>;

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const KEY = 'sk-ant-test-key-0123456789';
const MARK = 'ZEBRA-MARKER';

/** A fake fetch that records each request and answers with the next canned response. */
function fakeFetch(...responses: (() => Response | Promise<Response>)[]) {
  const calls: Recorded[] = [];
  const fetch: FakeFetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses[calls.length - 1];
    if (!next) throw new Error('fakeFetch has no more responses');
    return next();
  };
  return { fetch, calls };
}

function message(fields: Record<string, unknown> = {}): () => Response {
  const body = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: '{"hasButton":false}', citations: null }],
    usage: { input_tokens: 3500, output_tokens: 640, cache_creation_input_tokens: 0, cache_read_input_tokens: 3400, iterations: null },
    ...fields,
  };
  return () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
}

function apiError(status: number): () => Response {
  return () =>
    new Response(JSON.stringify({ type: 'error', error: { type: status === 400 ? 'invalid_request_error' : 'api_error', message: 'nope' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const THINKING = { type: 'thinking', thinking: `Plan the ${MARK} button.`, signature: 'sig-abc123' };

const input: ModelInput = {
  system: SYSTEM_PROMPT,
  schema: REPLY_SCHEMA,
  messages: [{ role: 'user', text: `Compile this request:\n{"sentence":"${MARK}"}` }],
};

function setup(responses: (() => Response)[], options: Partial<AskOptions> = {}) {
  const { fetch, calls } = fakeFetch(...responses);
  const logs: Record<string, unknown>[] = [];
  const ask = makeAsk({ apiKey: KEY, fetch, log: (entry) => logs.push(entry), ...options });
  return { ask, calls, logs };
}

describe('Requirement 7.1 to 7.5, 7.8, 7.9 the request', () => {
  it('posts to the beta Messages API with the key, the fallback beta and the planned body', async () => {
    const { ask, calls } = setup([message()]);
    await ask(input);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call!.method).toBe('POST');
    // SDK 1.x sends the key as a bearer token; there is no x-api-key header.
    expect(call!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(call!.headers['x-api-key']).toBeUndefined();
    expect(call!.headers['anthropic-beta']?.split(',').map((b) => b.trim())).toContain('server-side-fallback-2026-07-01');
    expect(call!.headers['x-stainless-retry-count']).toBe('0');
    expect(call!.headers['x-stainless-timeout']).toBe('60');
    expect(call!.body).toStrictEqual({
      model: 'claude-opus-5-5',
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Compile this request:\n{"sentence":"${MARK}"}` }],
    });
    expect(MAX_TOKENS).toBe(8000);
  });

  it('sends an earlier Assistant_Turn back unchanged, between the user messages', async () => {
    const turn = [THINKING, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: '{"hasButton":true}', citations: null }];
    const { ask, calls } = setup([message()]);
    await ask({
      ...input,
      messages: [...input.messages, { role: 'assistant', turn }, { role: 'user', text: 'Your reply broke these rules.' }],
    });
    expect(calls[0]!.body.messages).toStrictEqual([
      { role: 'user', content: `Compile this request:\n{"sentence":"${MARK}"}` },
      { role: 'assistant', content: turn },
      { role: 'user', content: 'Your reply broke these rules.' },
    ]);
  });

  it('uses the given timeout per call', async () => {
    const { ask, calls } = setup([message()], { timeoutMs: 5000 });
    await ask(input);
    expect(calls[0]!.headers['x-stainless-timeout']).toBe('5');
  });
});

describe('Requirement 7.6, 7.7 the response', () => {
  it('maps end_turn to a reply with the joined text and the content as the turn', async () => {
    const content = [
      THINKING,
      { type: 'text', text: '{"hasButton":', citations: null },
      { type: 'text', text: 'false}', citations: null },
    ];
    const { ask } = setup([message({ content })]);
    const reply = await ask(input);
    expect(reply).toStrictEqual({ kind: 'reply', text: '{"hasButton":false}', turn: content });
  });

  it('maps refusal to a Refusal', async () => {
    const { ask } = setup([message({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: null } })]);
    expect(await ask(input)).toStrictEqual({ kind: 'refusal' });
  });

  it('maps max_tokens to a reply, whose cut-off text Rule 10 will report', async () => {
    const content = [THINKING, { type: 'text', text: '{"hasButton":true,"scr', citations: null }];
    const { ask } = setup([message({ stop_reason: 'max_tokens', content })]);
    expect(await ask(input)).toStrictEqual({ kind: 'reply', text: '{"hasButton":true,"scr', turn: content });
  });

  it('keeps the fallback block in the turn of a fallback-served response', async () => {
    const fallback = { type: 'fallback', from: { model: MODEL }, to: { model: 'claude-sonnet-5-5' }, trigger: { type: 'refusal', category: 'cyber' } };
    const content = [fallback, { type: 'text', text: '{"hasButton":false}', citations: null }];
    const usage = {
      input_tokens: 3600,
      output_tokens: 700,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3400,
      iterations: [
        { type: 'message', model: MODEL, input_tokens: 3500, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 3400, cache_creation: null },
        { type: 'fallback_message', model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 680, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
      ],
    };
    const { ask, logs } = setup([message({ model: 'claude-sonnet-5-5', content, usage })]);
    const reply = await ask(input);
    expect(reply).toStrictEqual({ kind: 'reply', text: '{"hasButton":false}', turn: content });
    expect(logs).toStrictEqual([
      {
        event: 'model-call',
        model: 'claude-sonnet-5-5',
        stop_reason: 'end_turn',
        input_tokens: 3600,
        output_tokens: 700,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3400,
        fallback: true,
      },
    ]);
  });
});

describe('Requirement 7.10 failed calls', () => {
  it('rejects on a 400 after exactly one fetch call', async () => {
    const { ask, calls } = setup([apiError(400), message()]);
    await expect(ask(input)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('rejects on a 500 after exactly one fetch call, so the SDK never retries', async () => {
    const { ask, calls } = setup([apiError(500), message()]);
    await expect(ask(input)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('rejects on a network error after exactly one fetch call', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.reject(new TypeError('network down')), message());
    const ask = makeAsk({ apiKey: KEY, fetch, log: () => {} });
    await expect(ask(input)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('rejects with a missing or empty key, and never calls fetch', async () => {
    for (const apiKey of [undefined, '']) {
      const { ask, calls, logs } = setup([message()], { apiKey });
      await expect(ask(input)).rejects.toThrow(new Error('ANTHROPIC_API_KEY is not set'));
      expect(calls).toHaveLength(0);
      expect(logs).toHaveLength(0);
    }
  });
});

describe('Requirement 11.2 the usage log', () => {
  it('holds the model, the stop reason, the token counts and the fallback flag, and no message text', async () => {
    const content = [THINKING, { type: 'text', text: `{"label":"${MARK}"}`, citations: null }];
    const { ask, logs } = setup([message({ content }), message({ stop_reason: 'refusal', content: [] })]);
    await ask(input);
    await ask(input);
    expect(logs).toStrictEqual([
      {
        event: 'model-call',
        model: MODEL,
        stop_reason: 'end_turn',
        input_tokens: 3500,
        output_tokens: 640,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3400,
        fallback: false,
      },
      expect.objectContaining({ stop_reason: 'refusal', fallback: false }),
    ]);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('Compile this request');
  });
});
