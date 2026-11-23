// The order of checks and the HTTP answers (Requirement 8.3; design.md, "worker/src/handle.ts"):
// the Access check, the route, the request, the daily limits, then the compiler.
import { compile, readCompileRequest, type Ask, type CallEvent, type CompileRequest, type CompileResponse } from '../../src/compiler/index';
import { accessRequired } from './access';
import { json, notFound } from './http';
import { clientKey, type TakeResult } from './limits';

export interface WorkerVars { REQUIRE_ACCESS?: string; ACCESS_AUD?: string; LIMIT_PER_IP?: string; LIMIT_PER_SITE?: string }

export interface Deps {
  vars: WorkerVars;
  verifyAccess(request: Request): Promise<boolean>;
  limiter: { take(clientKey: string): Promise<TakeResult> };
  ask: Ask;
  log(entry: Record<string, unknown>): void;
}

export const MAX_BODY_BYTES = 256 * 1024;

export const COMPILE_PATH = '/api/compile';

/**
 * Answers one request. Every answer on the Compile_Route is a CompileResponse (1.5), and one log
 * line per request holds the status, the error code and the CallEvents: never the sentence, the
 * names, the Client_Key or the token (11.2).
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  const calls: CallEvent[] = [];
  const finish = (response: Response, error: string | null, extra: Record<string, unknown> = {}): Response => {
    deps.log({ event: 'request', status: response.status, error, calls, ...extra });
    return response;
  };
  const answer = (body: CompileResponse, extra?: Record<string, unknown>): Response =>
    finish(json(body), body.ok ? null : body.error, extra);

  // 1. Access, before the route, so a visitor who is not signed in learns nothing about paths.
  if (accessRequired(deps.vars) && !(await accessGranted(request, deps))) return answer({ ok: false, error: 'unauthorized' });

  // 2. The route: POST /api/compile, with any query string ignored (8.1, 8.2).
  if (request.method !== 'POST' || new URL(request.url).pathname !== COMPILE_PATH) return finish(notFound(), 'not-found');

  // 3. From here on, anything thrown is 502 model, and the log gets the error's name only.
  try {
    // 4. The request (Requirement 2).
    const compileRequest = await readRequest(request);
    if (!compileRequest) return answer({ ok: false, error: 'bad-request' });

    // 5. The daily limits. This is the only place a request is counted, once (10.1).
    const taken = await deps.limiter.take(clientKey(request.headers.get('CF-Connecting-IP')));
    if (!taken.ok) return answer({ ok: false, error: 'limit', scope: taken.scope });

    // 6. The compiler.
    return answer(await compile(compileRequest, deps.ask, (event) => calls.push(event)));
  } catch (error) {
    return answer({ ok: false, error: 'model' }, { thrown: error instanceof Error ? error.name : typeof error });
  }
}

/** A check that throws counts as a token that cannot be verified (9.2). */
async function accessGranted(request: Request, deps: Deps): Promise<boolean> {
  try {
    return await deps.verifyAccess(request);
  } catch {
    return false;
  }
}

/** The CompileRequest of the body, or null for a bad request (Requirement 2.1 to 2.6). */
async function readRequest(request: Request): Promise<CompileRequest | null> {
  const mediaType = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (mediaType !== 'application/json') return null;

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    // Invalid UTF-8 or text that is not JSON.
    return null;
  }
  return readCompileRequest(value);
}
