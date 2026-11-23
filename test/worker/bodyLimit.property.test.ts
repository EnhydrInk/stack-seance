import '../compiler/helpers/noNetwork';
// Property tests for Bug 1 of worker-body-limit-and-model-error-log-fix. Requirement numbers
// here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MAX_BODY_BYTES } from '../../worker/src/handle';
import { replyText } from '../compiler/helpers/fixtures';
import { replyStep } from '../compiler/helpers/fakeModel';
import {
  ACCEPTED,
  BAD_REQUEST,
  MIN_COMPILE_BODY,
  compileBody,
  countingBody,
  crossingIndex,
  cut,
  jsonRequest,
  observe,
  referenceAnswer,
  repeated,
  type CountingBody,
} from './helpers/bodies';

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
  it(
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
  it(
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

/** A size from `min` to MAX, with the last 64 bytes before MAX weighted up. */
const sizeUpToMaxArb = (min: number) => fc.oneof(fc.integer({ min, max: MAX }), fc.integer({ min: MAX - 64, max: MAX }));

const BOM = [0xef, 0xbb, 0xbf];

/**
 * A body of at most MAX bytes: a valid CompileRequest padded with multi-byte characters, sometimes
 * after a byte order mark (3.8), or noise from a seed. Noise of any byte is almost always invalid
 * UTF-8, and printable ASCII noise is valid UTF-8 that is almost never JSON.
 */
type WithinBody =
  | { kind: 'compile'; size: number; bom: boolean }
  | { kind: 'noise'; size: number; seed: number; ascii: boolean };

const withinBodyArb: fc.Arbitrary<WithinBody> = fc.oneof(
  fc.record({ kind: fc.constant('compile' as const), size: sizeUpToMaxArb(MIN_COMPILE_BODY + BOM.length), bom: fc.boolean() }),
  fc.record({ kind: fc.constant('noise' as const), size: sizeUpToMaxArb(1), seed: fc.integer(), ascii: fc.boolean() }),
);

/** `size` bytes from a xorshift32 stream, so a body of 256 KiB costs one seed instead of 262,144 generated values. */
function noise(seed: number, size: number, ascii: boolean): Uint8Array {
  const bytes = new Uint8Array(size);
  let x = seed | 0 || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const r = x >>> 0;
    bytes[i] = ascii ? 0x20 + (r % 95) : r & 0xff;
  }
  return bytes;
}

function bytesOf(body: WithinBody): Uint8Array {
  if (body.kind === 'noise') return noise(body.seed, body.size, body.ascii);
  if (!body.bom) return compileBody(body.size, { multiByte: true });
  const bytes = new Uint8Array(body.size);
  bytes.set(BOM);
  bytes.set(compileBody(body.size - BOM.length, { multiByte: true }), BOM.length);
  return bytes;
}

describe('Property 2: Requests within the limit are read, decoded and answered as before', () => {
  // Feature: worker-body-limit-and-model-error-log-fix, Property 2: Requests within the limit are read, decoded and answered as before
  // **Validates: Requirements 3.1, 3.4, 3.5, 3.8, 3.9**
  it(
    'P2 chunking: a body of at most MAX bytes in any chunks is answered as referenceAnswer says and as the same bytes in one chunk',
    async () => {
      const caseArb = withinBodyArb.chain((body) =>
        fc.record({
          body: fc.constant(body),
          offsets: fc.array(fc.integer({ min: 0, max: body.size }), { maxLength: 20 }),
          contentLength: undecidingLengthArb,
        }),
      );
      await fc.assert(
        fc.asyncProperty(caseArb, async ({ body, offsets, contentLength }) => {
          const bytes = bytesOf(body);
          expect(bytes.byteLength).toBe(body.size);
          const passes = referenceAnswer(bytes) !== null;
          if (body.kind === 'compile') expect(passes).toBe(true);
          const expected = passes ? ACCEPTED : BAD_REQUEST;

          const chunks = cut(bytes, offsets);
          const chunked = countingBody(chunks);
          const inChunks = await observe(jsonRequest({ body: chunked.stream, contentLength }), { steps: oneReply() }, chunked);
          const single = countingBody([bytes]);
          const inOne = await observe(jsonRequest({ body: single.stream, contentLength }), { steps: oneReply() }, single);

          expect(inChunks).toStrictEqual({ ...expected, bodyUsed: true, taken: chunks.length, cancels: 0 });
          expect(inOne).toStrictEqual({ ...expected, bodyUsed: true, taken: 1, cancels: 0 });
        }),
        { numRuns: 100 },
      );
    },
    60_000,
  );
});
