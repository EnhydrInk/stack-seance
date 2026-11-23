import '../compiler/helpers/noNetwork';
// Bug 1 of worker-body-limit-and-model-error-log-fix: the body limit is held while the body is
// read, not after. Requirement numbers here refer to that spec's bugfix.md.
import { describe, it, expect } from 'vitest';
import { MAX_BODY_BYTES } from '../../worker/src/handle';
import { replyText } from '../compiler/helpers/fixtures';
import { replyStep } from '../compiler/helpers/fakeModel';
import { signToken } from './helpers/accessKeys';
import { MemoryStore } from './helpers/memoryStore';
import { ACCEPTED, ACCESS_ON, BAD_REQUEST, IP, compileBody, countingBody, cut, jsonRequest, observe, repeated, type JsonSend } from './helpers/bodies';

/** Repro 1: 90 MB in 1,440 chunks of 64 KiB, and a Content-Length that declares it. */
const REPRO_LENGTH = '94371840';
const ninetyMegabytes = () => countingBody(repeated(65536, 1440));
/** Four chunks of 64 KiB hold exactly MAX_BODY_BYTES, which is not above it. The fifth passes it. */
const CROSSING = 5;
/** One valid reply, so a request that gets through is compiled and answered 200. */
const oneReply = () => [replyStep(replyText())];

describe('Property 1, bugfix 2.1 a declared length above MAX_BODY_BYTES is turned away unread', () => {
  it('Repro 1: Content-Length 94371840 with a small valid body gets 400, is not counted and makes no Model_Call', async () => {
    const request = jsonRequest({ body: compileBody(150), contentLength: REPRO_LENGTH });
    expect(await observe(request, { steps: oneReply() })).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false });
  });

  it('Repro 1: Content-Length 94371840 with a 90 MB body takes no chunk and leaves the body undisturbed', async () => {
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, contentLength: REPRO_LENGTH });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false, taken: 0, cancels: 0 });
  });
});

describe('Property 1, bugfix 2.2 reading stops once more than MAX_BODY_BYTES arrive', () => {
  it('Repro 1 streamed: without Content-Length, 5 chunks are taken and the reader is cancelled once', async () => {
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
  });

  it.each(['abc', '-1', '1e3', '12.5', '', '12, 12', '3'])(
    'Content-Length %j does not stop the limit: 5 chunks are taken and the reader is cancelled once',
    async (contentLength) => {
      const body = ninetyMegabytes();
      const request = jsonRequest({ body: body.stream, contentLength });
      expect(request.headers.get('Content-Length')).toBe(contentLength);
      expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
    },
  );

  it('a stream that would error after passing the limit gets 400 with no thrown, because reading stops first', async () => {
    const body = countingBody(repeated(65536, 5), { errorAfter: 5 });
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
  });

  it('with Access on, a signed-in request without Content-Length is cut off the same way and leaves the store unchanged', async () => {
    const store = new MemoryStore();
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, token: await signToken() });
    expect(await observe(request, { steps: oneReply(), vars: ACCESS_ON, store }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: CROSSING, cancels: 1 });
    expect(store.snapshot()).toEqual({});
  });
});

// Property 2: Preservation. Each expectation below was observed on the unfixed code at 80c9e62,
// and none of them is one that the fix is meant to change.

describe('Property 2, bugfix 3.2 a declared length of exactly MAX_BODY_BYTES is read and judged by the received bytes', () => {
  it.each<[string, number[], number]>([
    ['one chunk', [], 1],
    ['four chunks of 64 KiB', [65536, 131072, 196608], 4],
  ])('Content-Length 262144 with a valid body of exactly 262,144 bytes in %s gets 200', async (_, offsets, chunks) => {
    const body = countingBody(cut(compileBody(MAX_BODY_BYTES), offsets));
    const request = jsonRequest({ body: body.stream, contentLength: String(MAX_BODY_BYTES) });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...ACCEPTED, bodyUsed: true, taken: chunks, cancels: 0 });
  });
});

describe('Property 2, bugfix 3.4 and 3.5 a Content-Length that does not declare more than MAX_BODY_BYTES leaves the received bytes to decide', () => {
  it('Content-Length 3 with a valid body of 300 bytes gets 200', async () => {
    const request = jsonRequest({ body: compileBody(300), contentLength: '3' });
    expect(await observe(request, { steps: oneReply() })).toStrictEqual({ ...ACCEPTED, bodyUsed: true });
  });

  it.each(['abc', '-1', '1e3', '12.5', '', '12, 12', '+5'])('Content-Length %j with a valid body of 300 bytes gets 200', async (contentLength) => {
    const request = jsonRequest({ body: compileBody(300), contentLength });
    expect(request.headers.get('Content-Length')).toBe(contentLength);
    expect(await observe(request, { steps: oneReply() })).toStrictEqual({ ...ACCEPTED, bodyUsed: true });
  });
});

describe('Property 2, bugfix 3.6 an empty body is a bad request', () => {
  it.each<[string, JsonSend, boolean]>([
    ['no body', { body: null }, false],
    ["the body ''", { body: '' }, true],
    ['Content-Length 0 and no body', { body: null, contentLength: '0' }, false],
  ])('%s gets 400', async (_, send, bodyUsed) => {
    expect(await observe(jsonRequest(send), { steps: oneReply() })).toStrictEqual({ ...BAD_REQUEST, bodyUsed });
  });

  it('an empty Counting_Body gets 400 after one pull that closes it', async () => {
    const body = countingBody([]);
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: true, taken: 0, cancels: 0 });
  });
});

describe('Property 2, bugfix 3.7 the media type is checked before Content-Length and the body', () => {
  it.each(['text/plain', null])('Content-Type %j with Content-Length 94371840 gets 400 and leaves the body untouched', async (contentType) => {
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, contentLength: REPRO_LENGTH, contentType });
    expect(request.headers.get('Content-Type')).toBe(contentType);
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({ ...BAD_REQUEST, bodyUsed: false, taken: 0, cancels: 0 });
  });
});

describe('Property 2, bugfix 3.11 Access and the route are answered before Content-Length and the body', () => {
  const untouched = { takes: 0, modelCalls: 0, bodyUsed: false, taken: 0, cancels: 0 };

  it('with Access on, a request without a token gets 401 and leaves the body and the store untouched', async () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 7, [`ip:${IP}`]: 3 });
    const before = store.snapshot();
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, contentLength: REPRO_LENGTH });
    expect(await observe(request, { steps: oneReply(), vars: ACCESS_ON, store }, body)).toStrictEqual({
      status: 401,
      body: { ok: false, error: 'unauthorized' },
      logs: [{ event: 'request', status: 401, error: 'unauthorized', calls: [] }],
      ...untouched,
    });
    expect(store.snapshot()).toEqual(before);
  });

  it('with Access on, a signed-in request on /api/other gets 404 and leaves the body and the store untouched', async () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 7, [`ip:${IP}`]: 3 });
    const before = store.snapshot();
    const body = ninetyMegabytes();
    const request = jsonRequest({ body: body.stream, contentLength: REPRO_LENGTH, token: await signToken(), path: '/api/other' });
    expect(await observe(request, { steps: oneReply(), vars: ACCESS_ON, store }, body)).toStrictEqual({
      status: 404,
      body: 'Not found',
      logs: [{ event: 'request', status: 404, error: 'not-found', calls: [] }],
      ...untouched,
    });
    expect(store.snapshot()).toEqual(before);
  });
});

describe('Property 2, bugfix 3.10 a body stream that errors within the limit is answered 502 model', () => {
  it('3 chunks of 1,000 bytes and then an error get 502 with thrown RangeError, no count and no Model_Call', async () => {
    const body = countingBody(repeated(1000, 3), { errorAfter: 3 });
    const request = jsonRequest({ body: body.stream });
    expect(await observe(request, { steps: oneReply() }, body)).toStrictEqual({
      status: 502,
      body: { ok: false, error: 'model' },
      logs: [{ event: 'request', status: 502, error: 'model', calls: [], thrown: 'RangeError' }],
      takes: 0,
      modelCalls: 0,
      bodyUsed: true,
      taken: 3,
      cancels: 0,
    });
  });
});
