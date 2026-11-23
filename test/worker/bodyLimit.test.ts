import '../compiler/helpers/noNetwork';
// Bug 1 of worker-body-limit-and-model-error-log-fix: the body limit is held while the body is
// read, not after. Requirement numbers here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import { replyText } from '../compiler/helpers/fixtures';
import { replyStep } from '../compiler/helpers/fakeModel';
import { signToken } from './helpers/accessKeys';
import { MemoryStore } from './helpers/memoryStore';
import { ACCESS_ON, BAD_REQUEST, compileBody, countingBody, jsonRequest, observe, repeated } from './helpers/bodies';

/** Repro 1: 90 MB in 1,440 chunks of 64 KiB, and a Content-Length that declares it. */
const REPRO_LENGTH = '94371840';
const ninetyMegabytes = () => countingBody(repeated(65536, 1440));
/** Four chunks of 64 KiB hold exactly MAX_BODY_BYTES, which is not above it. The fifth passes it. */
const CROSSING = 5;
/** One valid reply, so a request that gets through is compiled and answered 200. */
const oneReply = () => [replyStep(replyText())];

describe('Property 1, bugfix 2.1 a declared length above MAX_BODY_BYTES is turned away unread', () => {
  // fails until task 5.1 fixes bug 1
  it.fails('Repro 1: Content-Length 94371840 with a small valid body gets 400, is not counted and makes no Model_Call', async () => {
    const request = jsonRequest({ body: compileBody(150), contentLength: REPRO_LENGTH });
    expect(await observe(request, { steps: oneReply() })).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false });
  });

  // fails until task 5.1 fixes bug 1
  it.fails('Repro 1: Content-Length 94371840 with a 90 MB body takes no chunk and leaves the body undisturbed', async () => {
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, contentLength: REPRO_LENGTH });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false, taken: 0, cancels: 0 });
  });
});

describe('Property 1, bugfix 2.2 reading stops once more than MAX_BODY_BYTES arrive', () => {
  // fails until task 5.1 fixes bug 1
  it.fails('Repro 1 streamed: without Content-Length, 5 chunks are taken and the reader is cancelled once', async () => {
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
  });

  // fails until task 5.1 fixes bug 1
  it.fails.each(['abc', '-1', '1e3', '12.5', '', '12, 12', '3'])(
    'Content-Length %j does not stop the limit: 5 chunks are taken and the reader is cancelled once',
    async (contentLength) => {
      const body = ninetyMegabytes();
      const request = jsonRequest({ body: body.stream, contentLength });
      expect(request.headers.get('Content-Length')).toBe(contentLength);
      expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
    },
  );

  // fails until task 5.1 fixes bug 1
  it.fails('a stream that would error after passing the limit gets 400 with no thrown, because reading stops first', async () => {
    const body = countingBody(repeated(65536, 5), { errorAfter: 5 });
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
  });

  // fails until task 5.1 fixes bug 1
  it.fails('with Access on, a signed-in request without Content-Length is cut off the same way and leaves the store unchanged', async () => {
    const store = new MemoryStore();
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, token: await signToken() });
    expect(await observe(request, { steps: oneReply(), vars: ACCESS_ON, store }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
    expect(store.snapshot()).toEqual({});
  });
});
