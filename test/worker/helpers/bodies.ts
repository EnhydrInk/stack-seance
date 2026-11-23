// Request bodies, requests and deps for the body-limit tests
// (worker-body-limit-and-model-error-log-fix, design.md "Test helpers").
import type { CompileRequest } from '../../../src/compiler/index';
import { verifyAccess } from '../../../worker/src/access';
import { COMPILE_PATH, handle, type Deps, type WorkerVars } from '../../../worker/src/handle';
import { readLimits, take } from '../../../worker/src/limits';
import { scriptedAsk, type Step } from '../../compiler/helpers/fakeModel';
import { AUD, keys } from './accessKeys';
import { MemoryStore } from './memoryStore';

const ORIGIN = 'https://stack-seance.enhydrink.com';
const NOON = Date.UTC(2026, 11, 5, 12, 0, 0);
export const IP = '203.0.113.99';

/** Vars with Access on and the local key set's audience, for the tests that ask for Access. */
export const ACCESS_ON: WorkerVars = { REQUIRE_ACCESS: 'true', ACCESS_AUD: AUD };

export interface CountingBody {
  stream: ReadableStream<Uint8Array>;
  /** The chunks the reader has pulled from the stream so far. */
  taken(): number;
  /** How often the stream's source was cancelled. */
  cancels(): number;
}

/**
 * A body stream that hands out `chunks` one per pull, then closes, or errors with
 * `RangeError('stream broke')` once `errorAfter` chunks have gone out. `highWaterMark: 0`
 * makes one read one pull: with the default of 1 the stream pulls once before anyone reads,
 * and the count would include a chunk the Worker never took.
 */
export function countingBody(chunks: readonly Uint8Array[], { errorAfter }: { errorAfter?: number } = {}): CountingBody {
  let taken = 0;
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (errorAfter !== undefined && taken >= errorAfter) controller.error(new RangeError('stream broke'));
        else if (taken < chunks.length) controller.enqueue(chunks[taken++]!);
        else controller.close();
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, taken: () => taken, cancels: () => cancels };
}

/** `count` views of one shared buffer of `size` bytes, so a 90 MB body costs `size` bytes of test memory. */
export function repeated(size: number, count: number): Uint8Array[] {
  const shared = new Uint8Array(size).fill(0x78);
  return Array.from({ length: count }, () => new Uint8Array(shared.buffer, 0, size));
}

/** `bytes` split at `offsets` (clamped and sorted). Repeated offsets give empty chunks. */
export function cut(bytes: Uint8Array, offsets: readonly number[]): Uint8Array[] {
  const points = offsets.map((o) => Math.max(0, Math.min(bytes.byteLength, o))).sort((a, b) => a - b);
  const bounds = [0, ...points, bytes.byteLength];
  return bounds.slice(1).map((end, i) => bytes.subarray(bounds[i]!, end));
}

/** A short valid CompileRequest, so `compileBody` can reach sizes as small as 150 bytes. */
export const SMALL_REQUEST: CompileRequest = {
  sentence: 'Go to the next card.',
  stackName: 'S',
  cardNames: ['A', 'B'],
  cardName: 'A',
  fieldNames: [],
  buttonNames: [],
  stackNames: ['S'],
};

const encoder = new TextEncoder();
/** The size of SMALL_REQUEST with an empty `pad`: the smallest size `compileBody` can give. */
export const MIN_COMPILE_BODY = encoder.encode(JSON.stringify({ ...SMALL_REQUEST, pad: '' })).byteLength;
/** 2, 3 and 4 bytes in UTF-8, so a cut often falls inside a character. */
const MULTI_BYTE = 'é€🦦';
const MULTI_BYTE_SIZE = encoder.encode(MULTI_BYTE).byteLength;

/**
 * The UTF-8 bytes of SMALL_REQUEST padded to exactly `size` bytes through an extra `pad` field,
 * which `readCompileRequest` drops. With `multiByte`, the pad is mostly é, € and 🦦.
 */
export function compileBody(size: number, { multiByte = false }: { multiByte?: boolean } = {}): Uint8Array {
  let room = size - MIN_COMPILE_BODY;
  if (room < 0) throw new RangeError(`compileBody needs at least ${MIN_COMPILE_BODY} bytes, not ${size}`);
  let pad = '';
  if (multiByte) {
    const cycles = Math.floor(room / MULTI_BYTE_SIZE);
    pad = MULTI_BYTE.repeat(cycles);
    room -= cycles * MULTI_BYTE_SIZE;
  }
  pad += 'x'.repeat(room);
  const bytes = encoder.encode(JSON.stringify({ ...SMALL_REQUEST, pad }));
  if (bytes.byteLength !== size) throw new Error(`compileBody built ${bytes.byteLength} bytes, not ${size}`);
  return bytes;
}

export interface JsonSend {
  /** A string body gets Node's text/plain Content-Type when `contentType` is null, so pass bytes for that. */
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
  /** Content-Length, set only when given. Node's Request adds none of its own. A list appends the header once per value. */
  contentLength?: string | readonly string[] | null;
  contentType?: string | null;
  token?: string | null;
  path?: string;
  ip?: string | null;
}

/**
 * A POST to the Compile_Route. A stream body goes in with `duplex: 'half'`, and `request.body`
 * is then that same stream, so `taken()` and `request.bodyUsed` describe what the Worker did.
 */
export function jsonRequest({ body = null, contentLength = null, contentType = 'application/json', token = null, path = COMPILE_PATH, ip = IP }: JsonSend = {}): Request {
  const headers = new Headers();
  if (contentType !== null) headers.set('Content-Type', contentType);
  if (token !== null) headers.set('Cf-Access-Jwt-Assertion', token);
  if (ip !== null) headers.set('CF-Connecting-IP', ip);
  const lengths = contentLength === null ? [] : typeof contentLength === 'string' ? [contentLength] : contentLength;
  for (const value of lengths) headers.append('Content-Length', value);
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body, duplex: 'half' });
}

export interface BodySetup {
  steps?: Step[];
  vars?: WorkerVars;
  store?: MemoryStore;
}

/** Deps shaped like `setup()` in handle.test.ts, with Access off unless asked, that count `take` calls and Model_Calls. */
export function bodyDeps({ steps = [], vars = { REQUIRE_ACCESS: 'false' }, store = new MemoryStore() }: BodySetup = {}) {
  const { ask, inputs } = scriptedAsk(steps);
  const logs: Record<string, unknown>[] = [];
  let takes = 0;
  const deps: Deps = {
    vars,
    verifyAccess: (r) => verifyAccess(r, vars.ACCESS_AUD, keys),
    limiter: {
      take: async (key) => {
        takes++;
        return take(store, key, NOON, readLimits(vars));
      },
    },
    ask,
    log: (entry) => logs.push(entry),
  };
  return { deps, logs, store, takes: () => takes, modelCalls: () => inputs.length };
}

/** What one request through `handle` did, in one record, so a failed comparison shows all of it. */
export interface Outcome {
  status: number;
  body: unknown;
  logs: Record<string, unknown>[];
  takes: number;
  modelCalls: number;
  bodyUsed: boolean;
  /** Only with a Counting_Body. */
  taken?: number;
  cancels?: number;
}

/**
 * Sends `request` through `handle` and records the outcome. The chunk counts are read after a
 * macrotask, so a read that goes on in the background after the answer still shows up.
 */
export async function observe(request: Request, setup: BodySetup = {}, counting?: CountingBody): Promise<Outcome> {
  const s = bodyDeps(setup);
  const response = await handle(request, s.deps);
  const text = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const outcome: Outcome = {
    status: response.status,
    body: parseOrText(text),
    logs: s.logs,
    takes: s.takes(),
    modelCalls: s.modelCalls(),
    bodyUsed: request.bodyUsed,
  };
  if (counting) {
    outcome.taken = counting.taken();
    outcome.cancels = counting.cancels();
  }
  return outcome;
}

function parseOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The bad-request answer of Property 1: 400, the bad-request log line, no `take` and no Model_Call. */
export const BAD_REQUEST = {
  status: 400,
  body: { ok: false, error: 'bad-request' },
  logs: [{ event: 'request', status: 400, error: 'bad-request', calls: [] }],
  takes: 0,
  modelCalls: 0,
} as const;

/** The least k whose first k chunks hold more than `limit` bytes, or undefined when the whole body does not. */
export function crossingIndex(chunks: readonly Uint8Array[], limit: number): number | undefined {
  let received = 0;
  for (let k = 0; k < chunks.length; k++) {
    received += chunks[k]!.byteLength;
    if (received > limit) return k + 1;
  }
  return undefined;
}
