import '../compiler/helpers/noNetwork';
// Property tests for Bug 2 of worker-body-limit-and-model-error-log-fix. Requirement numbers
// here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { APIError } from '@anthropic-ai/sdk';
import { makeAsk } from '../../worker/src/ask';
import { INPUT, KEY, MARK, apiFetch, errorBody, textBody } from './helpers/fakeApi';

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
  // fails until task 6.1 fixes bug 2
  it.fails(
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
