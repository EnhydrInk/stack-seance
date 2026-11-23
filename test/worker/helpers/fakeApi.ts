// Fake Anthropic API answers for the model-error-log tests
// (worker-body-limit-and-model-error-log-fix, design.md "Test helpers"). Every fake reaches the
// SDK through AskOptions.fetch, so no test touches the network (SC 14.10).
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OverloadedError,
  PaymentRequiredError,
  PermissionDeniedError,
} from '@anthropic-ai/sdk';
import { EnforcedSpendLimitReachedError } from '@anthropic-ai/sdk/resources/shared';
import { REPLY_SCHEMA, SYSTEM_PROMPT, userMessage, type CompileRequest, type ModelInput } from '../../../src/compiler/index';
import type { AskOptions } from '../../../worker/src/ask';

export type FakeFetch = NonNullable<AskOptions['fetch']>;

/** An API key that no log line or response may hold. */
export const KEY = 'sk-ant-api03-LEAKCHECK-key-0123456789';
/** A word only the Sentence holds, so a leak of the request shows up in a plain substring search. */
export const MARK = 'NARWHAL-MARKER';
/** The request id of every fake answer, unless a test gives its own. */
export const REQUEST_ID = 'req_LEAKCHECK';

/** A CompileRequest whose Sentence and Request_Names no other part of a request, reply or log holds. */
export const REQUEST: CompileRequest = {
  sentence: `Clicking this wakes the ${MARK} and opens the Axolotl vault`,
  stackName: 'Capybara Lodge',
  cardNames: ['Axolotl Door', 'Axolotl Vault', 'Axolotl Loft'],
  cardName: 'Axolotl Door',
  fieldNames: ['axolotlfield'],
  buttonNames: ['Axolotl button'],
  stackNames: ['Capybara Lodge', 'Pangolin Help'],
};

/** The Sentence and every Request_Name of REQUEST, for leak checks. */
export const REQUEST_TEXTS = [REQUEST.sentence, MARK, 'Capybara', 'Axolotl', 'axolotlfield', 'Pangolin'];

/** The input of one Model_Call for REQUEST, with the User_Message the Compiler builds. */
export const INPUT: ModelInput = {
  system: SYSTEM_PROMPT,
  schema: REPLY_SCHEMA,
  messages: [{ role: 'user', text: userMessage(REQUEST) }],
};

export interface RecordedCall {
  url: string;
  /** The request body, parsed when it is a JSON string. */
  body: unknown;
}

/** A fake fetch that records each call and answers with `make(init)`, so a fake can read `init.signal`. */
export function apiFetch(make: (init: RequestInit | undefined) => Response | Promise<Response>): { fetch: FakeFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FakeFetch = async (url, init) => {
    calls.push({ url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    return make(init);
  };
  return { fetch, calls };
}

/**
 * An API error answer: `{"type":"error","error":{type, message, ...extra}}` as JSON, with a
 * `request-id` header. A `type` of undefined leaves the field out.
 */
export function errorBody(status: number, type: unknown, message: string, extra: Record<string, unknown> = {}, requestId: string = REQUEST_ID): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message, ...extra } }), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': requestId },
  });
}

/** An answer whose body is `text`, which is not JSON, with a `request-id` header. */
export function textBody(
  status: number,
  text: string,
  { contentType = 'text/html; charset=utf-8', requestId = REQUEST_ID }: { contentType?: string; requestId?: string } = {},
): Response {
  return new Response(text, { status, headers: { 'content-type': contentType, 'request-id': requestId } });
}

/**
 * An answer that never comes. It rejects with the signal's reason once the SDK aborts the call
 * for its timeout. Without a signal it never settles, and the test fails at vitest's timeout.
 */
export function never(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * The network error the fake fetch rejects with. Its text must not match the SDK's
 * `/timed? ?out/i` test, or the SDK reports a timeout instead of a connection error.
 */
export const FETCH_FAILED = new TypeError('fetch failed');

/** One row of the fake-response table in design.md, "Faking SDK failures with the existing fetch option". */
export interface FailureRow {
  name: string;
  /** The fake's answer to the one call. */
  respond(init: RequestInit | undefined): Response | Promise<Response>;
  /** Only the timeout row sets one. */
  timeoutMs?: number;
  /** The class the Ask rejects with, and the rejection's `name`, `status`, `requestID` and `cause`. */
  rejects: abstract new (...args: never[]) => Error;
  className: string;
  status: number | undefined;
  requestID: string | undefined;
  cause: unknown;
  /** The failure entry the fixed Ask writes (bugfix 2.3 to 2.5), built here by hand. */
  entry: Record<string, unknown>;
  /** Texts of the answer that must stay out of every log line. */
  leaks: string[];
}

const FAILED = 'model-call-failed';

const AUTH_MESSAGE = 'invalid x-api-key';

/** Repro 2: a revoked key. */
export const AUTHENTICATION: FailureRow = {
  name: '401 authentication_error (Repro 2)',
  respond: () => errorBody(401, 'authentication_error', AUTH_MESSAGE),
  rejects: AuthenticationError,
  className: 'AuthenticationError',
  status: 401,
  requestID: REQUEST_ID,
  cause: undefined,
  entry: { event: FAILED, status: 401, error_type: 'authentication_error', error_class: 'AuthenticationError' },
  leaks: [AUTH_MESSAGE],
};

/** `fetch` rejects with a network error. */
export const CONNECTION: FailureRow = {
  name: 'fetch rejects with TypeError fetch failed',
  respond: () => Promise.reject(FETCH_FAILED),
  rejects: APIConnectionError,
  className: 'APIConnectionError',
  status: undefined,
  requestID: undefined,
  cause: FETCH_FAILED,
  entry: { event: FAILED, error_class: 'APIConnectionError' },
  leaks: [FETCH_FAILED.message],
};

/** The answer never comes, and the SDK's 20 ms timeout aborts the call. */
export const TIMEOUT: FailureRow = {
  name: 'no answer within timeoutMs 20',
  respond: never,
  timeoutMs: 20,
  rejects: APIConnectionTimeoutError,
  className: 'APIConnectionTimeoutError',
  status: undefined,
  requestID: undefined,
  cause: undefined,
  entry: { event: FAILED, error_class: 'APIConnectionTimeoutError' },
  leaks: [],
};

/** An API error row: the SDK class, the status and the type, and an entry with all three. */
function apiRow(
  name: string,
  status: number,
  type: string,
  message: string,
  rejects: FailureRow['rejects'],
  className: string,
  extra: Record<string, unknown> = {},
): FailureRow {
  return {
    name,
    respond: () => errorBody(status, type, message, extra),
    rejects,
    className,
    status,
    requestID: REQUEST_ID,
    cause: undefined,
    entry: { event: FAILED, status, error_type: type, error_class: className },
    leaks: [message],
  };
}

const HTML = '<html><head><title>502 Bad Gateway</title></head><body><center>cloudflare</center></body></html>';
const TEAPOT = "I'm a teapot, and this text must stay out of the logs";
const NOT_JSON = 'upstream proxy page, not JSON at all';

/** Every row of the fake-response table, from the 401 row to the never() row. */
export const FAILURE_ROWS: readonly FailureRow[] = [
  AUTHENTICATION,
  apiRow('403 permission_error', 403, 'permission_error', 'Your API key does not have permission to use the specified resource.', PermissionDeniedError, 'PermissionDeniedError'),
  apiRow('404 not_found_error (a model the workspace cannot use)', 404, 'not_found_error', 'model: claude-opus-5-5', NotFoundError, 'NotFoundError'),
  apiRow(
    '400 invalid_request_error with a credit-balance message',
    400,
    'invalid_request_error',
    'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    BadRequestError,
    'BadRequestError',
  ),
  apiRow('402 billing_error', 402, 'billing_error', 'This organization has a billing problem. See Plans & Billing.', PaymentRequiredError, 'PaymentRequiredError'),
  apiRow(
    '429 rate_limit_error with error_code enforced_spend_limit_reached',
    429,
    'rate_limit_error',
    'You have reached your specified workspace API usage limits.',
    EnforcedSpendLimitReachedError,
    'EnforcedSpendLimitReachedError',
    { details: { error_code: 'enforced_spend_limit_reached' } },
  ),
  apiRow('500 api_error', 500, 'api_error', 'Internal server error', InternalServerError, 'InternalServerError'),
  apiRow('529 overloaded_error', 529, 'overloaded_error', 'The API is temporarily overloaded.', OverloadedError, 'OverloadedError'),
  {
    name: '502 with a text/html body',
    respond: () => textBody(502, HTML),
    rejects: InternalServerError,
    className: 'InternalServerError',
    status: 502,
    requestID: REQUEST_ID,
    cause: undefined,
    entry: { event: FAILED, status: 502, error_class: 'InternalServerError' },
    leaks: [HTML, 'Bad Gateway', 'cloudflare'],
  },
  {
    name: "418 with the free-text type 'weird type with spaces'",
    respond: () => errorBody(418, 'weird type with spaces', TEAPOT),
    rejects: APIError,
    className: 'APIError',
    status: 418,
    requestID: REQUEST_ID,
    cause: undefined,
    entry: { event: FAILED, status: 418, error_class: 'APIError' },
    leaks: [TEAPOT, 'weird type with spaces'],
  },
  {
    name: '200 whose JSON body is not JSON',
    respond: () => textBody(200, NOT_JSON, { contentType: 'application/json' }),
    rejects: SyntaxError,
    className: 'SyntaxError',
    status: undefined,
    requestID: undefined,
    cause: undefined,
    entry: { event: FAILED, error_class: 'SyntaxError' },
    leaks: [NOT_JSON],
  },
  CONNECTION,
  TIMEOUT,
];
