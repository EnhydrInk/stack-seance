import '../compiler/helpers/noNetwork';
// Property tests for Bug 2 of worker-body-limit-and-model-error-log-fix. Requirement numbers
// here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { APIError } from '@anthropic-ai/sdk';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModelInput } from '../../src/compiler/index';
import { MODEL, makeAsk, toModelReply } from '../../worker/src/ask';
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

describe('Property 4: Ask calls that do not fail send, log and return as before', () => {
  // Feature: worker-body-limit-and-model-error-log-fix, Property 4: Ask calls that do not fail send, log and return as before
  // **Validates: Requirements 3.12, 3.14, 3.15**
  it(
    'P4 mixed sequences: on one Ask, each success writes exactly its usage entry and returns its reply, and each failure rejects and writes no other entry',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(fc.tuple(outcomeArb, inputArb), { minLength: 1, maxLength: 6 }), async (steps) => {
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
});
