// HTTP answers of the Worker (Requirement 1.3, 1.4, 8.2; design.md, "worker/src/http.ts").
// No response sets CORS headers: the UI is on the same host, and a cross-site page cannot send
// Content-Type: application/json without a preflight, which gets a 401 or a 404.
import type { CompileResponse } from '../../src/compiler/index';

/** The status of each answer, by its `error` code, or 200 for `ok: true`. */
export function statusOf(body: CompileResponse): number {
  if (body.ok) return 200;
  switch (body.error) {
    case 'nothing': return 422;
    case 'limit': return 429;
    case 'bad-request': return 400;
    case 'unauthorized': return 401;
    case 'model': return 502;
  }
}

/** A CompileResponse as JSON, with its status and the two headers every answer carries. */
export function json(body: CompileResponse): Response {
  return new Response(JSON.stringify(body), {
    status: statusOf(body),
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Any other method or path: plain text, not a CompileResponse. */
export function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}
