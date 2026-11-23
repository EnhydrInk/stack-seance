import '../compiler/helpers/noNetwork';
// Property tests for Bug 2 of worker-body-limit-and-model-error-log-fix. Requirement numbers
// here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError } from '@anthropic-ai/sdk';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModelInput } from '../../src/compiler/index';
import { MODEL, failureEntry, makeAsk, toModelReply } from '../../worker/src/ask';
import {
  FAILURE_ROWS,
  INPUT,
  KEY,
  MARK,
  apiFetch,
  errorBody,
  expectedRequest,
  messageBody,
  messageOf,
  sentBetas,
  textBody,
  usageEntryOf,
  type FailureRow,
  type Success,
} from './helpers/fakeApi';

/** The Identifier_Rule of design.md: what an API error type looks like. */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Every generated message and text body starts with this. Its capitals and hyphens cannot occur
 * in an identifier or an SDK class name, so a hit in the logs can only be a leak.
 */
const LEAK = 'Leak-Marker-';

/** The error types the API documents. */
const KNOWN_TYPES = [
  'invalid_request_error',
  'authentication_error',
  'billing_error',
  'permission_error',
  'not_found_error',
  'request_too_large',
  'rate_limit_error',
  'timeout_error',
  'api_error',
  'overloaded_error',
];

/** Pairs from the error-code table of the installed SDK 1.12.0 (core/error-classes.mjs). Each picks its own error class. */
const KNOWN_CODES: readonly (readonly [number, string])[] = [
  [400, 'organization_on_hold'],
  [400, 'available_tools_limit_exceeded'],
  [402, 'linked_organization_spend_limit_reached'],
  [402, 'linked_organization_billing_unavailable'],
  [403, 'sandbox_egress_restricted'],
  [404, 'file_expired'],
  [409, 'concurrent_membership_change'],
  [413, 'request_body_too_large_after_decoding'],
  [429, 'enforced_spend_limit_reached'],
  [429, 'contract_spend_limit_reached'],
  [429, 'ramp_limit_exceeded'],
  [503, 'cmek_key_unreachable'],
  [529, 'compaction_unavailable'],
];

const statusArb = fc.integer({ min: 400, max: 599 });
/** An identifier, a documented type, free text, any other JSON value, or no type at all. */
const typeArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(...KNOWN_TYPES),
  fc.stringMatching(IDENTIFIER),
  fc.string({ maxLength: 40 }),
  fc.constant('weird type with spaces'),
  fc.jsonValue({ maxDepth: 2 }),
);
const codeArb = fc.oneof(fc.constantFrom(...KNOWN_CODES.map(([, code]) => code)), fc.stringMatching(/^leakcode_[a-z0-9_]{1,16}$/));
const messageArb = fc.tuple(fc.nat(), fc.string({ maxLength: 60 })).map(([n, rest]) => `${LEAK}${n} ${rest}`);
const requestIdArb = fc.stringMatching(/^req_LEAK[A-Za-z0-9]{1,24}$/);

type Case =
  | { kind: 'json'; status: number; type: unknown; code: string | undefined; message: string; requestId: string }
  | { kind: 'text'; status: number; text: string; contentType: string; requestId: string };

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  // Any status, with or without an error code.
  fc.record({
    kind: fc.constant('json' as const),
    status: statusArb,
    type: typeArb,
    code: fc.option(codeArb, { nil: undefined }),
    message: messageArb,
    requestId: requestIdArb,
  }),
  // A status and error code the SDK maps to one of its error-code classes.
  fc
    .record({ pair: fc.constantFrom(...KNOWN_CODES), type: typeArb, message: messageArb, requestId: requestIdArb })
    .map(({ pair: [status, code], type, message, requestId }) => ({ kind: 'json' as const, status, type, code, message, requestId })),
  // A body that is not JSON, even under a JSON media type.
  fc.record({
    kind: fc.constant('text' as const),
    status: statusArb,
    text: messageArb,
    contentType: fc.constantFrom('text/html; charset=utf-8', 'text/plain', 'application/json'),
    requestId: requestIdArb,
  }),
);

function answer(c: Case): Response {
  if (c.kind === 'text') return textBody(c.status, c.text, { contentType: c.contentType, requestId: c.requestId });
  return errorBody(c.status, c.type, c.message, c.code === undefined ? {} : { details: { error_code: c.code } }, c.requestId);
}

const FAILED = 'model-call-failed';
/** The only fields a failure entry may hold (bugfix 2.5). */
const ENTRY_KEYS = ['event', 'status', 'error_type', 'error_class'];

/** Any status an SDK error can be built with: a number, or a value that is not one. */
const anyStatusArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: 100, max: 599 }),
  fc.integer(),
  fc.constant(undefined),
  fc.constant(null),
  fc.constantFrom('401', '529'),
);
/** An error code from the SDK's table or a marked one, or any other JSON value as the details. */
const detailsArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ error_code: fc.oneof(fc.constantFrom(...KNOWN_CODES.map(([, code]) => code)), messageArb) }),
  fc.jsonValue({ maxDepth: 2 }),
);
const headerTextArb = fc.stringMatching(/^[A-Za-z0-9]{1,24}$/).map((id) => `${LEAK}${id}`);
const headersArb = fc.record({
  requestId: headerTextArb,
  workspaceId: headerTextArb,
  extra: fc.dictionary(fc.stringMatching(/^x-[a-z0-9-]{1,12}$/), headerTextArb, { maxKeys: 3 }),
});

/** The built-in Error classes, each with the name its errors carry. */
const ERROR_CLASSES = [
  [Error, 'Error'],
  [TypeError, 'TypeError'],
  [RangeError, 'RangeError'],
  [SyntaxError, 'SyntaxError'],
  [ReferenceError, 'ReferenceError'],
  [EvalError, 'EvalError'],
  [URIError, 'URIError'],
] as const;

/** A rejection value, described as data so the expected entry can be worked out from it by hand. */
type Thrown =
  | { kind: 'anything'; value: unknown }
  | { kind: 'error'; index: number; message: string }
  | {
      kind: 'api';
      className: 'APIError' | 'AuthenticationError';
      status: unknown;
      type: unknown;
      /** Where the type goes: the body's error.type, or the constructor's last argument. */
      typeVia: 'body' | 'argument';
      withBody: boolean;
      message: string;
      details: unknown;
      headers: { requestId: string; workspaceId: string; extra: Record<string, string> } | undefined;
    }
  | { kind: 'connection'; message: string | undefined; cause: string | undefined }
  | { kind: 'timeout'; message: string | undefined };

const thrownArb: fc.Arbitrary<Thrown> = fc.oneof(
  fc.record({
    kind: fc.constant('anything' as const),
    value: fc.anything({
      withBigInt: true,
      withBoxedValues: true,
      withDate: true,
      withMap: true,
      withNullPrototype: true,
      withObjectString: true,
      withSet: true,
      withSparseArray: true,
      withTypedArray: true,
    }),
  }),
  fc.record({ kind: fc.constant('error' as const), index: fc.nat({ max: ERROR_CLASSES.length - 1 }), message: messageArb }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('api' as const),
      className: fc.constantFrom('APIError' as const, 'AuthenticationError' as const),
      status: anyStatusArb,
      type: typeArb,
      typeVia: fc.constantFrom('body' as const, 'argument' as const),
      withBody: fc.boolean(),
      message: messageArb,
      details: fc.option(detailsArb, { nil: undefined }),
      headers: fc.option(headersArb, { nil: undefined }),
    }),
  },
  fc.record({
    kind: fc.constant('connection' as const),
    message: fc.option(messageArb, { nil: undefined }),
    cause: fc.option(messageArb, { nil: undefined }),
  }),
  fc.record({ kind: fc.constant('timeout' as const), message: fc.option(messageArb, { nil: undefined }) }),
);

/**
 * The value `t` describes, built with the SDK's own constructors, and the failure entry that
 * design.md's rules give for it, worked out here without calling failureEntry.
 */
function build(t: Thrown): { value: unknown; expected: Record<string, unknown> } {
  switch (t.kind) {
    case 'anything':
      return { value: t.value, expected: { event: FAILED, error_class: typeof t.value } };
    case 'error': {
      const [make, name] = ERROR_CLASSES[t.index]!;
      return { value: new make(t.message), expected: { event: FAILED, error_class: name } };
    }
    case 'api': {
      const inner: Record<string, unknown> = { message: t.message };
      if (t.typeVia === 'body') inner.type = t.type;
      if (t.details !== undefined) inner.details = t.details;
      const body = t.withBody ? { type: 'error', error: inner } : undefined;
      const headers =
        t.headers && new Headers({ ...t.headers.extra, 'request-id': t.headers.requestId, 'anthropic-workspace-id': t.headers.workspaceId });
      const make = (t.className === 'APIError' ? APIError : AuthenticationError) as unknown as new (...args: unknown[]) => APIError;
      const value = new make(t.status, body, t.message, headers, t.typeVia === 'argument' ? t.type : undefined);
      // The SDK keeps the type argument, or else the body's error.type, or else null.
      const type = (t.typeVia === 'argument' || t.withBody ? t.type : undefined) ?? null;
      expect(value.type, 'the type the SDK keeps').toBe(type);
      return {
        value,
        expected: {
          event: FAILED,
          ...(typeof t.status === 'number' ? { status: t.status } : {}),
          ...(typeof type === 'string' && IDENTIFIER.test(type) ? { error_type: type } : {}),
          error_class: t.className,
        },
      };
    }
    case 'connection': {
      const cause = t.cause === undefined ? undefined : new TypeError(t.cause);
      return { value: new APIConnectionError({ message: t.message, cause }), expected: { event: FAILED, error_class: 'APIConnectionError' } };
    }
    case 'timeout':
      return { value: new APIConnectionTimeoutError({ message: t.message }), expected: { event: FAILED, error_class: 'APIConnectionTimeoutError' } };
  }
}

describe('Property 3: A failed SDK call writes one failure entry and rejects with the same error', () => {
  // Feature: worker-body-limit-and-model-error-log-fix, Property 3: A failed SDK call writes one failure entry and rejects with the same error
  // **Validates: Requirements 2.3, 2.5, 3.14**
  it(
    'P3 through the real SDK: any API error answer from 400 to 599 logs exactly the entry built from its status, type and class',
    async () => {
      await fc.assert(
        fc.asyncProperty(caseArb, async (c) => {
          // An error type that happens to contain the error code would make the leak check below meaningless.
          if (c.kind === 'json' && c.code !== undefined && typeof c.type === 'string') fc.pre(!c.type.includes(c.code));
          const { fetch, calls } = apiFetch(() => answer(c));
          const logs: Record<string, unknown>[] = [];
          const ask = makeAsk({ apiKey: KEY, fetch, log: (entry) => logs.push(entry) });
          const rejection = await ask(INPUT).then(
            () => undefined,
            (error: unknown) => error,
          );

          // These hold on the unfixed code too, so only the logs check below can fail there.
          expect(rejection).toBeInstanceOf(APIError);
          const error = rejection as APIError;
          expect(error.status).toBe(c.status);
          expect(calls).toHaveLength(1);
          const text = JSON.stringify(logs);
          const code = c.kind === 'json' && c.code !== undefined ? [c.code] : [];
          for (const leak of [LEAK, c.requestId, KEY, MARK, 'Compile this request', ...code]) expect(text, leak).not.toContain(leak);

          const type = c.kind === 'json' && typeof c.type === 'string' && IDENTIFIER.test(c.type) ? { error_type: c.type } : {};
          expect(logs, 'logs').toStrictEqual([{ event: 'model-call-failed', status: c.status, ...type, error_class: error.name }]);
        }),
        { numRuns: 200 },
      );
    },
    30_000,
  );

  // Feature: worker-body-limit-and-model-error-log-fix, Property 3: A failed SDK call writes one failure entry and rejects with the same error
  // **Validates: Requirements 2.3, 2.4, 2.5**
  it('P3 any rejection value: failureEntry never throws, keeps to its four fields, and holds the status, type and class the rules give', () => {
    fc.assert(
      fc.property(thrownArb, (t) => {
        const { value, expected } = build(t);
        const entry = failureEntry(value);

        expect(ENTRY_KEYS).toEqual(expect.arrayContaining(Object.keys(entry)));
        const text = JSON.stringify(entry);
        expect(text).not.toContain(LEAK);
        if (value instanceof Error && value.message !== '') expect(text).not.toContain(value.message);
        expect(entry).toStrictEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });
});

const textArb = fc.string({ unit: 'grapheme', maxLength: 40 });
const blockArb: fc.Arbitrary<BetaContentBlock> = fc.oneof(
  textArb.map((text): BetaContentBlock => ({ type: 'text', text, citations: null })),
  fc.tuple(textArb, fc.stringMatching(/^sig-[A-Za-z0-9]{1,16}$/)).map(([thinking, signature]): BetaContentBlock => ({ type: 'thinking', thinking, signature })),
);
const contentArb = fc.array(blockArb, { maxLength: 3 });
const tokensArb = fc.nat({ max: 1_000_000 });

const successArb: fc.Arbitrary<Success> = fc.record({
  model: fc.constantFrom(MODEL, 'claude-sonnet-5-5'),
  stopReason: fc.constantFrom('end_turn' as const, 'max_tokens' as const, 'refusal' as const),
  content: contentArb,
  inputTokens: tokensArb,
  outputTokens: tokensArb,
  cacheCreationInputTokens: fc.option(tokensArb, { nil: null }),
  cacheReadInputTokens: fc.option(tokensArb, { nil: null }),
  iterations: fc.constantFrom('none' as const, 'message' as const, 'fallback' as const),
});

type Outcome = { kind: 'success'; success: Success } | { kind: 'failure'; row: FailureRow };

const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  successArb.map((success): Outcome => ({ kind: 'success', success })),
  fc.constantFrom(...FAILURE_ROWS).map((row): Outcome => ({ kind: 'failure', row })),
);

/** The first request of a compile, or a later one that sends an Assistant_Turn back with a follow-up. */
const inputArb: fc.Arbitrary<ModelInput> = fc.oneof(
  fc.constant(INPUT),
  fc.tuple(contentArb, textArb).map(([turn, text]): ModelInput => ({
    ...INPUT,
    messages: [...INPUT.messages, { role: 'assistant', turn }, { role: 'user', text }],
  })),
);

/** One to six calls on one Ask, each with its outcome and its input. */
const stepsArb = fc.array(fc.tuple(outcomeArb, inputArb), { minLength: 1, maxLength: 6 });

describe('Property 4: Ask calls that do not fail send, log and return as before', () => {
  // Feature: worker-body-limit-and-model-error-log-fix, Property 4: Ask calls that do not fail send, log and return as before
  // **Validates: Requirements 3.12, 3.14, 3.15**
  it(
    'P4 mixed sequences: on one Ask, each success writes exactly its usage entry and returns its reply, and each failure rejects and writes no other entry',
    async () => {
      await fc.assert(
        fc.asyncProperty(stepsArb, async (steps) => {
          let next = 0;
          const { fetch, calls } = apiFetch((init) => {
            const [outcome] = steps[next++]!;
            return outcome.kind === 'success' ? messageBody(outcome.success) : outcome.row.respond(init);
          });
          // The timeout row needs the Ask's 20 ms timeout. Every other sequence keeps the default.
          const timeoutMs = steps.flatMap(([o]) => (o.kind === 'failure' && o.row.timeoutMs !== undefined ? [o.row.timeoutMs] : []))[0];
          const logs: Record<string, unknown>[] = [];
          const ask = makeAsk({ apiKey: KEY, fetch, timeoutMs, log: (entry) => logs.push(entry) });

          for (const [i, [outcome, input]] of steps.entries()) {
            const before = logs.length;
            const result = await ask(input).then(
              (value) => ({ ok: true as const, value }),
              (error: unknown) => ({ ok: false as const, error }),
            );
            const written = logs.slice(before);

            // One fetch per call, sending the same request as before (3.14, 3.15).
            expect(calls).toHaveLength(i + 1);
            const sent = expectedRequest(input);
            expect(calls[i]!.body).toStrictEqual(sent.body);
            expect(sentBetas(calls[i]!)).toEqual(expect.arrayContaining(sent.betas));

            if (outcome.kind === 'success') {
              expect(result).toStrictEqual({ ok: true, value: toModelReply(messageOf(outcome.success)) });
              expect(written).toStrictEqual([usageEntryOf(outcome.success)]);
            } else {
              expect(result.ok).toBe(false);
              const { error } = result as { error: unknown };
              expect(error).toBeInstanceOf(outcome.row.rejects);
              expect((error as Error).name).toBe(outcome.row.className);
              // The failure entries themselves belong to Property 3.
              expect(written.filter((entry) => entry.event !== 'model-call-failed')).toStrictEqual([]);
            }
          }
        }),
        { numRuns: 100 },
      );
    },
    30_000,
  );

  // Feature: worker-body-limit-and-model-error-log-fix, Property 4: Ask calls that do not fail send, log and return as before
  // **Validates: Requirements 2.3, 2.4, 3.12, 3.14**
  it(
    'P4 mixed sequences with failure entries: the whole log holds one entry per call, the usage entry for a success and failureEntry(rejection) for a failure',
    async () => {
      await fc.assert(
        fc.asyncProperty(stepsArb, async (steps) => {
          let next = 0;
          const { fetch, calls } = apiFetch((init) => {
            const [outcome] = steps[next++]!;
            return outcome.kind === 'success' ? messageBody(outcome.success) : outcome.row.respond(init);
          });
          const timeoutMs = steps.flatMap(([o]) => (o.kind === 'failure' && o.row.timeoutMs !== undefined ? [o.row.timeoutMs] : []))[0];
          const logs: Record<string, unknown>[] = [];
          const ask = makeAsk({ apiKey: KEY, fetch, timeoutMs, log: (entry) => logs.push(entry) });

          const expected: Record<string, unknown>[] = [];
          for (const [outcome, input] of steps) {
            const result = await ask(input).then(
              () => ({ ok: true as const }),
              (error: unknown) => ({ ok: false as const, error }),
            );
            if (outcome.kind === 'success') {
              expect(result.ok).toBe(true);
              expected.push(usageEntryOf(outcome.success));
            } else {
              expect(result.ok).toBe(false);
              const { error } = result as { error: unknown };
              expect(error).toBeInstanceOf(outcome.row.rejects);
              expect(failureEntry(error), outcome.row.name).toStrictEqual(outcome.row.entry);
              expected.push(failureEntry(error));
            }
          }

          expect(calls).toHaveLength(steps.length);
          expect(logs).toStrictEqual(expected);
        }),
        { numRuns: 100 },
      );
    },
    30_000,
  );
});
