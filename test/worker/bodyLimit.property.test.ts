import '../compiler/helpers/noNetwork';
// Property tests for Bug 1 of worker-body-limit-and-model-error-log-fix. Requirement numbers
// here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MAX_BODY_BYTES } from '../../worker/src/handle';
import { replyText } from '../compiler/helpers/fixtures';
import { replyStep } from '../compiler/helpers/fakeModel';
import { BAD_REQUEST, MIN_COMPILE_BODY, compileBody, countingBody, crossingIndex, cut, jsonRequest, observe, repeated, type CountingBody } from './helpers/bodies';

const MAX = MAX_BODY_BYTES;
const EXTRA = 200_000;
/** One buffer that every over-limit body is a slice of, so a run allocates nothing. */
const OVER = new Uint8Array(MAX + EXTRA).fill(0x78);

const oneReply = () => [replyStep(replyText())];

/**
 * Content-Length values that leave the received bytes to decide: none, a value that is not a
 * declared length, or a declared length of at most MAX. Headers trims surrounding spaces, so the
 * filter looks at the trimmed value.
 */
const notDeclaredArb = fc
  .string({ unit: fc.constantFrom(...'0123456789+-.e,aZx '), maxLength: 12 })
  .filter((s) => !/^[0-9]+$/.test(s.trim()));
const undecidingLengthArb = fc.oneof(fc.constant(null), notDeclaredArb, fc.integer({ min: 0, max: MAX }).map(String));

/** A declared length above MAX: digits only, up to 30 of them, sometimes with leading zeros. */
const aboveMaxArb = fc
  .oneof(
    fc.integer({ min: MAX + 1, max: MAX + 64 }).map(String),
    fc.integer({ min: MAX + 1, max: Number.MAX_SAFE_INTEGER }).map(String),
    fc.stringMatching(/^[1-9][0-9]{6,29}$/),
  )
  .chain((digits) => fc.nat({ max: 30 - digits.length }).map((zeros) => '0'.repeat(zeros) + digits));

type AnyBody =
  | { kind: 'none' }
  | { kind: 'empty' }
  | { kind: 'valid'; size: number }
  | { kind: 'chunks'; size: number; count: number }
  | { kind: 'error' };

const anyBodyArb: fc.Arbitrary<AnyBody> = fc.oneof(
  fc.constant({ kind: 'none' as const }),
  fc.constant({ kind: 'empty' as const }),
  fc.integer({ min: MIN_COMPILE_BODY, max: 4096 }).map((size) => ({ kind: 'valid' as const, size })),
  fc.record({ size: fc.integer({ min: 1, max: 65536 }), count: fc.integer({ min: 0, max: 1440 }) }).map((c) => ({ kind: 'chunks' as const, ...c })),
  fc.constant({ kind: 'error' as const }),
);

describe('Property 1: Over-limit bodies are turned away without being held', () => {
  // Feature: worker-body-limit-and-model-error-log-fix, Property 1: Over-limit bodies are turned away without being held
  // **Validates: Requirements 2.2**
  // fails until task 5.1 fixes bug 1
  it.fails(
    'P1 at MAX: when more than MAX bytes arrive and no declared length is above MAX, the chunk that passes MAX is the last one taken',
    async () => {
      const caseArb = fc.integer({ min: MAX + 1, max: MAX + EXTRA }).chain((total) =>
        fc.record({
          total: fc.constant(total),
          offsets: fc.array(fc.integer({ min: 0, max: total }), { maxLength: 20 }),
          contentLength: undecidingLengthArb,
          errorAtEnd: fc.boolean(),
        }),
      );
      await fc.assert(
        fc.asyncProperty(caseArb, async ({ total, offsets, contentLength, errorAtEnd }) => {
          const chunks = cut(OVER.subarray(0, total), offsets);
          const body = countingBody(chunks, errorAtEnd ? { errorAfter: chunks.length } : {});
          const request = jsonRequest({ body: body.stream, contentLength });
          const outcome = await observe(request, { steps: oneReply() }, body);
          expect(outcome).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: crossingIndex(chunks, MAX), cancels: 1 });
        }),
        { numRuns: 50 },
      );
    },
    30_000,
  );

  // Feature: worker-body-limit-and-model-error-log-fix, Property 1: Over-limit bodies are turned away without being held
  // **Validates: Requirements 2.1**
  // fails until task 5.1 fixes bug 1
  it.fails(
    'P1 declared above MAX: any body, even none, an empty one or a valid one, gets 400 with no chunk taken',
    async () => {
      await fc.assert(
        fc.asyncProperty(aboveMaxArb, anyBodyArb, async (contentLength, kind) => {
          let counting: CountingBody | undefined;
          let body: string | Uint8Array | ReadableStream<Uint8Array> | null = null;
          if (kind.kind === 'empty') body = '';
          if (kind.kind === 'valid') body = compileBody(kind.size);
          if (kind.kind === 'chunks') counting = countingBody(repeated(kind.size, kind.count));
          if (kind.kind === 'error') counting = countingBody([], { errorAfter: 0 });
          if (counting) body = counting.stream;
          const request = jsonRequest({ body, contentLength });
          const outcome = await observe(request, { steps: oneReply() }, counting);
          const unread = counting ? { taken: 0, cancels: 0 } : {};
          expect(outcome).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false, ...unread });
        }),
        { numRuns: 100 },
      );
    },
    30_000,
  );
});
