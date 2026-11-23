# Worker Body Limit and Model Error Log Fix Bugfix Design

## Overview

This fix covers two bugs in the Worker of the sentence compiler. Requirement numbers written as 2.1 or 3.4 refer to this spec's `bugfix.md`. SC numbers (SC 2.2, SC 11.2) refer to `.kiro/specs/sentence-compiler/requirements.md`. Section names in quotes refer to `.kiro/specs/sentence-compiler/design.md`.

**Bug 1.** `readRequest` in `worker/src/handle.ts` reads the whole body with `await request.arrayBuffer()` (line 73) and compares its length with `MAX_BODY_BYTES` afterwards (line 74). Nothing in `worker/src` looks at `Content-Length`. The fix adds two checks before and during the read:

- When the `Content-Length` value is a declared length above `MAX_BODY_BYTES`, `readRequest` returns null before it touches `request.body`.
- Otherwise it reads `request.body` through a reader, one chunk at a time, and returns null as soon as the received bytes pass `MAX_BODY_BYTES`. It then cancels the reader and takes no further chunk.

Decoding stays one strict `TextDecoder` call over the concatenated bytes, so the text, the BOM handling and every later check are as they are today.

**Bug 2.** `makeAsk` in `worker/src/ask.ts` awaits `client.beta.messages.create(...)` (line 45) with nothing around it. Its only log write is the usage entry after a success (line 46). The fix wraps only that SDK call. On a rejection, the Ask writes one failure entry through `options.log` and rethrows the same error object:

```json
{"event":"model-call-failed","status":401,"error_type":"authentication_error","error_class":"AuthenticationError"}
```

The entry holds the HTTP status and the API error type when the SDK error has them, plus the error's class name. It holds nothing else. The event name `model-call-failed` follows the existing usage entry's `model-call`.

Both bugs were observed on the unfixed code at commit `80c9e62`. The observations used `vite-node` with fake dependencies and a fake `fetch`, and made no network request (see "Examples"). The SDK facts below were checked against the installed `@anthropic-ai/sdk` 1.12.0 in `node_modules`. The existing Worker suite has 74 tests in 5 files, and all pass on the unfixed code.

Only `worker/src/handle.ts`, `worker/src/ask.ts` and `test/worker` change in code, and the final documentation task updates `.kiro/specs/sentence-compiler/design.md` to match. `src/compiler`, `src/hypertalk`, `src/ui`, `worker/src/index.ts`, `http.ts`, `access.ts`, `limits.ts` and `wrangler.toml` do not.

## Glossary

- **Bug_Condition (C)**: The union of two conditions. C1 (`isBodyBug`) covers a JSON request whose declared length is above MAX, or whose body would deliver more than MAX bytes. C2 (`isFailureBug`) covers one call of the Worker's Ask whose key check passes and whose SDK call rejects. Both are formalised below.
- **Property (P)**: For C1, the request gets 400 `bad-request` with no count and no Model_Call. No chunk is taken from the body when the declared length is above MAX. Otherwise the chunks stop at the first one that passes MAX, and the reader is cancelled. For C2, the Ask writes exactly one failure entry and rejects with the same error.
- **Preservation**: Every request outside C1 gets the same answer, count, Model_Calls and log line as before (3.1 to 3.11). Every Ask call outside C2 sends the same request, writes the same entries and returns or rejects with the same value as before (3.12, 3.13, 3.15). A call in C2 keeps everything except the new entry (3.14).
- **F / F'**: The code before and after the fix. For Bug 1 this is `handle` through `readRequest`. For Bug 2 it is the Ask that `makeAsk` returns.
- **MAX**: `MAX_BODY_BYTES` in `worker/src/handle.ts` line 18, 262,144 bytes.
- **Declared length**: As in bugfix.md. It is the value `request.headers.get('Content-Length')` returns, when that value is one or more ASCII digits and nothing else, read as a whole number. `Headers` drops surrounding spaces and joins repeated headers as `12, 12`, which was observed in Node. So `' 12 '` gives 12, and `12, 12` gives no declared length.
- **Chunk**: One value that `reader.read()` returns from `request.body`. The runtime decides chunk sizes. Node delivered a 300,000-byte string body as one chunk.
- **Taken chunks**: The number of chunks the Worker has pulled from the body stream. The tests count them with a Counting_Body.
- **Received bytes**: As in bugfix.md. It is the sum of the sizes of the taken chunks.
- **`declaredLength(value)`**: A new exported function in `handle.ts` that returns the declared length or null.
- **`readLimitedBody(body, limit)`**: A new exported function in `handle.ts`. It returns the bytes of a body stream, or null once more than `limit` bytes have arrived.
- **Usage entry**: The entry `usageEntry` builds after a successful call (`ask.ts` lines 80 to 92). Its event is `model-call`.
- **Failure entry**: The entry the Ask writes when the SDK call rejects, built by the new exported `failureEntry(error)`. Its event is `FAILURE_EVENT = 'model-call-failed'`.
- **APIError**: The SDK's base class for API, connection and timeout errors, exported from `@anthropic-ai/sdk`. A 1.12.0 `APIError` has `status`, `headers`, `requestID`, `workspaceID`, `error` (the parsed body), `apiMessage`, `type`, `errorCode` and `details` (`node_modules/@anthropic-ai/sdk/core/error.mjs` lines 16 to 31).
- **Error class name**: `error.name` for an `Error`, and `typeof error` for any other thrown value. This is the same rule `handle` uses for `thrown` (`handle.ts` line 55).
- **API error type**: `error.type` of an `APIError`, kept only when it passes the Identifier_Rule.
- **Identifier_Rule**: `/^[a-z][a-z0-9_]{0,63}$/`. Every `ErrorType` the SDK declares passes it (`authentication_error`, `rate_limit_error`, `memory_precondition_failed_error`, and so on). Free text does not.
- **Counting_Body**: A test helper stream built with `highWaterMark: 0`. It hands out one chunk per pull, counts taken chunks and cancel calls, and can error after a given number of chunks.

## Bug Details

### Bug Condition

**Bug 1** shows up when a JSON request declares more than MAX, or when more than MAX bytes arrive. `request.arrayBuffer()` reads until the stream ends, so the length check on line 74 runs only after every byte is in memory. No code reads `Content-Length`, so a request that declares 90 MB but sends a small valid body is compiled and counted.

**Bug 2** shows up whenever the SDK call rejects after the key check. The rejection leaves `makeAsk` untouched. `compile` records `{ call, result: 'failed' }` and returns `model`, so `handle` never catches it and sets no `thrown`. Nothing records the status, the type or the class.

**Formal Specification:**
```
-- MAX = 262,144
-- jsonRequest(R): R passes the Access check and the route check, and its Content-Type
--   media type is application/json (SC 2.1)
-- declared(R): the declared length of R, or NONE
-- chunks(R): the chunks R's body stream delivers before it ends or errors; [] for no body
-- prefix(R, k): the total size of the first k chunks of chunks(R)
-- errorsAfter(R): true when the stream errors after chunks(R) instead of ending

FUNCTION isBugCondition(X)
  INPUT: X, either a request R that handle receives, or one call A of the Ask that makeAsk returns
  OUTPUT: boolean

  IF X is a request THEN RETURN isBodyBug(X)
  RETURN isFailureBug(X)
END FUNCTION

FUNCTION isBodyBug(R)
  INPUT: R of type Request
  OUTPUT: boolean

  RETURN jsonRequest(R)
         AND ( (declared(R) ≠ NONE AND declared(R) > MAX)            -- 1.1
               OR prefix(R, length(chunks(R))) > MAX )                -- 1.2: more than MAX bytes arrive,
                                                                     --   whether or not the stream errors later
END FUNCTION

FUNCTION isFailureBug(A)
  INPUT: A, one call of the Worker's Ask, with its options and its ModelInput
  OUTPUT: boolean

  RETURN A.options.apiKey is a non-empty string                      -- the key check passed (3.13 is outside C)
         AND the SDK call client.beta.messages.create(...) of A rejects with some value e
                                                                     -- API error, network error, timeout,
                                                                     -- or any other rejection (1.3, 1.4)
END FUNCTION
```

On C1, F holds every received byte before it answers, and with a large declared length and a small body it answers 200. On C2, F writes no entry. Outside C, F's behavior is correct, and F' must match it.

### Examples

The current results for Repro 1, Repro 2 and the Counting_Body cases were observed on the unfixed code at `80c9e62`. The probe ran `handle` with `REQUIRE_ACCESS: 'false'`, a limiter that counts `take` calls, a fake Ask and a fake `fetch`, and made no network request. Where an example says "follows from", the result was derived from the code and not run.

- **Repro 1, declared, small valid body (2.1)**: `Content-Length: 94371840` with a valid CompileRequest of about 150 bytes. F answers 200, calls `take` once and makes one Model_Call. Expected: 400 `bad-request`, no `take`, no Model_Call, the bad-request log line.
- **Repro 1, declared, 90 MB (2.1)**: the same header with a Counting_Body of 1,440 chunks of 65,536 bytes (94,371,840 bytes). F answers 400 after taking all 1,440 chunks. Expected: 400 with 0 chunks taken and `request.bodyUsed` false.
- **Repro 1, streamed (2.2)**: no `Content-Length`, the same Counting_Body. F takes 1,440 chunks and never cancels. Expected: 5 chunks taken and one cancel. Four chunks hold exactly 262,144 bytes, which is not above MAX, and the fifth brings the total to 327,680.
- **Not a declared length, or too small (2.2)**: `Content-Length: abc` and `Content-Length: 3` with the same Counting_Body. F takes 1,440 chunks. Expected: 5 chunks and one cancel, as in the streamed case.
- **Edge, the stream errors after passing the limit (2.2)**: a Counting_Body of 5 chunks of 65,536 bytes that then errors with `RangeError`. F's `arrayBuffer()` rejects, so F answers 502 `model` with `thrown: 'RangeError'` (follows from lines 54 to 55 and 73). Expected: 400 `bad-request`, because reading stops at the fifth chunk and never reaches the error.
- **Edge, declared above MAX on a stream that errors (2.1)**: Expected: 400. The body is never read, so the error is never seen. F gives 502 (follows from the code).
- **Edge, exactly MAX (3.2, 3.3)**: `Content-Length: 262144` with a valid body of 262,144 bytes gets 200 under both F and F'. One byte more without the header gets 400 under both (the existing 256 KiB test).
- **Edge, media type first (3.7)**: `Content-Type: text/plain` with `Content-Length: 94371840` gets 400 under both, and the body is never touched.
- **Repro 2 (2.3)**: a fake `fetch` answers 401 with `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}` and a `request-id` header. F answers 502, and its only log line is `{"event":"request","status":502,"error":"model","calls":[{"call":1,"result":"failed"}]}`. Expected: first `{"event":"model-call-failed","status":401,"error_type":"authentication_error","error_class":"AuthenticationError"}`, then the same request line.
- **502 with an HTML body (2.3)**: Expected `{ event: 'model-call-failed', status: 502, error_class: 'InternalServerError' }`. The SDK parses no JSON, so `type` is null (observed with the SDK probe).
- **Spend limit (2.3, 2.5)**: a 429 with `error.type: 'rate_limit_error'` and `error.details.error_code: 'enforced_spend_limit_reached'`. The SDK picks `EnforcedSpendLimitReachedError` from its error-code table (`client.mjs` lines 471 to 478, `core/error-classes.mjs`). Expected: `{ event, status: 429, error_type: 'rate_limit_error', error_class: 'EnforcedSpendLimitReachedError' }`, with no `errorCode` and no `enforced_spend_limit_reached` text.
- **Network error (2.4)**: the fake `fetch` rejects with `TypeError('fetch failed')`. Expected: `{ event, error_class: 'APIConnectionError' }`, and the rejection's `cause` is that TypeError.
- **Timeout (2.4)**: with `timeoutMs: 20`, the fake `fetch` waits for `init.signal` to abort and rejects with `signal.reason`. Expected: `{ event, error_class: 'APIConnectionTimeoutError' }`.
- **Edge, an unknown status with a free-text type (2.5)**: a 418 whose body has `error.type: 'weird type with spaces'`. The SDK keeps that type as it is (observed). Expected: `{ event, status: 418, error_class: 'APIError' }`. The Identifier_Rule drops the type.
- **Edge, a rejection that is not an APIError (2.5)**: a 200 whose body is not JSON makes the SDK reject with the runtime's `SyntaxError` (observed). Expected: `{ event, error_class: 'SyntaxError' }`.
- **Edge, missing key (3.13)**: Unchanged. The Ask rejects with `Error('ANTHROPIC_API_KEY is not set')`, calls no `fetch` and writes no entry.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A JSON request whose declared length is not above MAX and whose body is at most MAX decodes, parses and checks exactly as today. It gets 200, 422 or 502 for a CompileRequest that passes SC 2.2 to 2.6, and 400 otherwise, with the same count and log line (3.1).
- A declared length of exactly MAX is read and judged by its received bytes (3.2). Without `Content-Length`, exactly MAX is accepted and one byte more is not (3.3).
- A `Content-Length` that declares at most MAX but differs from the body, or that is not a declared length (`abc`, `-1`, `1e3`, `12.5`, empty, `12, 12`), is ignored, and the received bytes decide (3.4, 3.5).
- An empty body (no body, zero bytes, `Content-Length: 0`) gets 400, because `''` is not JSON (3.6). `readLimitedBody(null, …)` returns zero bytes, as `arrayBuffer()` does today.
- A media type other than `application/json`, or no `Content-Type`, gets 400 before `Content-Length` or the body is looked at (3.7).
- Invalid UTF-8, text that is not JSON, and JSON that is not a CompileRequest get 400. Decoding stays `new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })`, which drops one leading BOM (3.8).
- A body of at most MAX in any number of chunks, including a multi-byte character split across two chunks, decodes to the same text as the same bytes in one chunk (3.9). The decoder sees only the concatenated bytes.
- A body stream that errors while the received bytes are at most MAX still makes `handle` answer 502 `model`, with no Model_Call, no count, and `thrown` set to the error's name (3.10). `reader.read()` rejects with the stream's own error object.
- Access and route checks still answer 401 or 404 first, without touching the body or `Content-Length` (3.11).
- A resolved SDK call, including one with a `refusal` stop reason, writes exactly today's usage entry, writes no failure entry, and returns the same Model_Reply (3.12).
- A missing or empty `ANTHROPIC_API_KEY` still rejects with `Error('ANTHROPIC_API_KEY is not set')` before any client exists, with no `fetch` and no entry (3.13).
- A rejected SDK call still makes exactly one HTTP request. The Compiler still records `{ call, result: 'failed' }` and makes no further call, and the Worker answers 502 `model`, counts once and logs the same request line (3.14).
- The request the Ask sends keeps the same base URL, key, headers, body, timeout and `maxRetries: 0` (3.15). `requestBody(input)` is only moved to the line before the SDK call.
- `vitest --run` makes no network request, and every existing test passes (3.16). The one permitted edit is in "Fix Implementation".

**Scope:**
All inputs outside C should be completely unaffected by this fix. This includes:
- Requests that fail the Access check or the route check, and requests on the Compile_Route whose media type is not `application/json`.
- JSON requests whose declared length is missing, not a declared length, or at most MAX, and whose body delivers at most MAX bytes, whether the body is valid, broken or erroring.
- Ask calls without a key, and Ask calls whose SDK call resolves.
- Everything outside `readRequest` and the Ask: the limiter, `clientKey`, `compile`, `http.ts`, `access.ts` and `index.ts`.

## Hypothesized Root Cause

The bugfix analysis already found the causes. The code and the observations at `80c9e62` confirm them:

1. **The size check runs after a full read**: `const bytes = await request.arrayBuffer()` (line 73) resolves only when the stream ends. The check `bytes.byteLength > MAX_BODY_BYTES` (line 74) can turn the request away, but it cannot stop the read. The probe saw all 1,440 chunks taken in every header case.

2. **`Content-Length` is never read**: No file in `worker/src` names the header. So a declared 90 MB with a small valid body passes, which the probe saw as 200 with one `take`.

3. **The Fetch API has no capped read**: `arrayBuffer()`, `text()` and `json()` all read to the end. A cap needs a reader loop that counts bytes and stops. The loop is also where 2.2's "take no further chunk" can be enforced.

4. **The SDK rejection passes through `makeAsk` unseen**: `makeAsk` writes to `options.log` only after `create` resolves (line 46). The rejection goes to `compile`, whose `CallEvent` has no error field, which is deliberate under SC 11.2. `compile` returns `model` instead of throwing, so `handle`'s `catch` never runs and `thrown` stays unset. The Ask is the only place that holds the SDK error, and it drops it.

5. **Ruled out**: SDK retries hiding the error. `maxRetries: 0` holds, and the probe saw exactly one `fetch` for 401, 403, 429, 500, 529, network errors and timeouts. Also ruled out: the SDK not exposing the fields. In 1.12.0:
   - `name` is set in `AnthropicError`'s constructor with `Object.defineProperty(this, 'name', { value: new.target._errorName })` (`core/error.mjs` line 7). Every class has its own `_errorName`.
   - `status` is assigned at line 18.
   - `type` is `type ?? body.error?.type ?? null` at line 25, so no lookup in `error.error.type` is needed.
   - `requestID` (line 20) and `errorCode` (line 27) exist too, and the fix leaves them out on purpose.
   - Connection failures become `APIConnectionTimeoutError` (`client.mjs` line 693) or `APIConnectionError` with the fetch error as `cause` (line 700). Both have no `status` and a null `type`.

## Correctness Properties

Property 1: Bug Condition - Over-limit bodies are turned away without being held

_For any_ request where the bug condition holds (isBodyBug returns true), the fixed `handle` SHALL answer 400 `{ ok: false, error: 'bad-request' }`. It SHALL log exactly `{ event: 'request', status: 400, error: 'bad-request', calls: [] }`, and SHALL call neither `deps.limiter.take` nor the Ask. When the declared length is above MAX, it SHALL take no chunk from the body stream and leave it undisturbed (`request.bodyUsed` stays false). Otherwise it SHALL take exactly the chunks up to and including the first one that brings the received bytes above MAX, take no further chunk, and cancel the reader once, whatever the stream would deliver or throw after that chunk.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Requests within the limit are read, decoded and answered as before

_For any_ request where the bug condition does NOT hold (isBodyBug returns false), the fixed `handle` SHALL produce the same result as the original: the same status, response body, count, Model_Calls and log line. This covers:
- bodies of at most MAX in any chunking, including multi-byte characters split across chunks;
- a declared length of exactly MAX;
- a `Content-Length` that is not a declared length, or that is smaller than the body;
- empty bodies, invalid UTF-8, non-JSON text and invalid CompileRequests;
- other media types, answered before `Content-Length` is read;
- 401 and 404 before the body;
- a body stream that errors within the limit, answered 502 `model` with `thrown` set to the error's name.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

Property 3: Bug Condition - A failed SDK call writes one failure entry and rejects with the same error

_For any_ Ask call where the bug condition holds (isFailureBug returns true, with rejection value `e`), the fixed Ask SHALL write exactly one entry through `options.log`, equal to `failureEntry(e)`:
- `event: 'model-call-failed'`;
- `status` exactly when `e` is an APIError with a numeric status;
- `error_type` exactly when `e` is an APIError whose `type` passes the Identifier_Rule;
- `error_class`, which is `e.name` for an Error and `typeof e` otherwise;
- no other field.

The entry SHALL hold no message text, response body, `requestID`, `errorCode`, Sentence, Request_Names, Client_Key, API key or Access_Token. The Ask SHALL then reject with `e` itself. The call SHALL still make one HTTP request. Through `handle`, the Compiler SHALL still record `{ call, result: 'failed' }`, and the Worker SHALL still answer 502 `model`, count once and log the same request line after the failure entry.

**Validates: Requirements 2.3, 2.4, 2.5, 3.14**

Property 4: Preservation - Ask calls that do not fail send, log and return as before

_For any_ Ask call where the bug condition does NOT hold (isFailureBug returns false), the fixed Ask SHALL produce the same result as the original. A call whose SDK call resolves, with any stop reason including `refusal`, sends the same request, writes exactly the same usage entry and no failure entry, and returns the same Model_Reply. A call without a key rejects with the same error, calls no `fetch` and writes no entry. The test suite makes no network request.

**Validates: Requirements 3.12, 3.13, 3.15, 3.16**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `worker/src/handle.ts`

**Function**: `readRequest` (lines 68 to 85), new `declaredLength`, new `readLimitedBody`

**Specific Changes**:
1. **Turn away a declared length above MAX before reading**: After the media type check, which stays first (3.7), `readRequest` reads the header and returns null without touching `request.body`:
   ```ts
   // A body that declares more than the limit is turned away before any of it is read (bugfix 2.1).
   const declared = declaredLength(request.headers.get('Content-Length'));
   if (declared !== null && declared > MAX_BODY_BYTES) return null;
   ```
   ```ts
   /** Content-Length as a whole number when it is one or more ASCII digits and nothing else; otherwise null. */
   export function declaredLength(value: string | null): number | null {
     return value !== null && /^[0-9]+$/.test(value) ? Number(value) : null;
   }
   ```
   `[0-9]` keeps out full-width digits, signs, `.`, `e`, commas and spaces. Leading zeros are fine. A digit string too long for a safe integer becomes a large number or `Infinity`, and both are above MAX. This check only saves a read. It was not verified whether Cloudflare passes every client's `Content-Length` through to the Worker, for example for chunked uploads. Where the header is missing, the capped read of change 2 still holds the limit.

   **The unread body is left alone, not cancelled.** No reader is taken and nothing is pulled, so no byte of the body enters the isolate. `handle` returns the 400 at once. The runtime owns the body stream and drops it, and the rest of the upload, when the request ends. Calling `request.body?.cancel()` would only do the same thing earlier, and it would add a promise to handle. Leaving it alone also gives the tests a plain check: `request.bodyUsed` stays false. The streaming path (change 2) does cancel, because there the Worker holds a reader lock on a stream it has started to pull, and cancelling drops anything the stream has queued right away.

2. **Read chunk by chunk and stop past the limit**: `arrayBuffer()` is replaced by:
   ```ts
   // Otherwise the received bytes decide, and reading stops as soon as they pass the limit (bugfix 2.2).
   const bytes = await readLimitedBody(request.body, MAX_BODY_BYTES);
   if (!bytes) return null;
   ```
   ```ts
   /**
    * The bytes of `body`, or null once more than `limit` bytes have arrived. Chunks are taken one
    * at a time. The chunk that passes the limit is the last one taken, and the reader is then
    * cancelled. No body gives zero bytes. A stream that errors makes this reject with its error.
    */
   export async function readLimitedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
     if (body === null) return new Uint8Array(0);
     const reader = body.getReader();
     const chunks: Uint8Array[] = [];
     let received = 0;
     for (;;) {
       const { done, value } = await reader.read();
       if (done) break;
       received += value.byteLength;
       if (received > limit) {
         // The answer is 400 whatever cancel does, so it is not awaited and a failure is dropped.
         reader.cancel().catch(() => {});
         return null;
       }
       chunks.push(value);
     }
     const bytes = new Uint8Array(received);
     let offset = 0;
     for (const chunk of chunks) {
       bytes.set(chunk, offset);
       offset += chunk.byteLength;
     }
     return bytes;
   }
   ```
   - `reader.cancel()` calls the source's cancel synchronously and empties the stream's queue. Node showed no pull after it. The promise is not awaited, so a source whose cancel is slow or fails cannot delay or change the 400. The `.catch` keeps a failed cancel from becoming an unhandled rejection.
   - The Worker holds at most MAX bytes of accepted chunks plus the one chunk that passed the limit. The runtime picks that chunk's size. An accepted body is copied once into one array, as `arrayBuffer()` effectively does today. The CPU cost is one loop iteration per chunk and one copy of at most 256 KiB.
   - A stream that errors makes `reader.read()` reject with the stream's own error. That error leaves `readRequest` and reaches `handle`'s `catch`, which answers 502 `model` with `thrown: error.name` (3.10). No `try` is added here.
   - `request.body` is `ReadableStream | null` under both `@cloudflare/workers-types` and `@types/node`, so the parameter type checks under `tsconfig.worker.json` and `tsconfig.test.json`.

3. **Keep the decode as it is**: `JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))` stays, now over a `Uint8Array` of exactly the received bytes instead of an `ArrayBuffer`. A character split across chunks is whole again after the concatenation, so 3.8 and 3.9 hold by construction. `TextDecoderStream` would decode chunk by chunk, but it would change where an invalid byte is noticed, and gain nothing at 256 KiB.

4. **Order of checks**: Access, route, media type, declared length, capped read, decode, `readCompileRequest`, then `deps.limiter.take`. Every new early return is a `null` from `readRequest`, which `handle` turns into 400 before `take` runs (line 46). So no rejected request is counted.

5. **Comments**: The doc comment of `readRequest` gains "A declared length above MAX_BODY_BYTES is turned away unread; otherwise reading stops once more than MAX_BODY_BYTES arrive."

**File**: `worker/src/ask.ts`

**Function**: `makeAsk` (lines 34 to 49), new `failureEntry`, new `FAILURE_EVENT`, import line 3

**Specific Changes**:
1. **Import the SDK's base error class**: line 3 becomes `import Anthropic, { APIError, type ClientOptions } from '@anthropic-ai/sdk';`. `APIError` is a value export of the package's index in 1.12.0. There is one copy of the SDK in `node_modules`, so `instanceof` is reliable.

2. **Wrap only the SDK call**:
   ```ts
   /** The event of the entry a failed SDK call writes. A call that succeeds writes 'model-call'. */
   export const FAILURE_EVENT = 'model-call-failed';

   export function makeAsk(options: AskOptions): Ask {
     let client: Anthropic | undefined;
     return async (input) => {
       if (!options.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
       client ??= new Anthropic({ /* unchanged */ });
       const body = requestBody(input);
       let response: BetaMessage;
       try {
         response = await client.beta.messages.create(body);
       } catch (error) {
         options.log(failureEntry(error));
         throw error;
       }
       options.log(usageEntry(response));
       return toModelReply(response);
     };
   }
   ```
   - The key check stays before the client and outside the `try`, so 3.13 is unchanged: no client, no `fetch`, no entry.
   - Client construction and `requestBody` also stay outside, so the `try` covers exactly the SDK call. Moving `requestBody(input)` up one line does not change the request (3.15).
   - `usageEntry` and `toModelReply` stay outside, so a successful call writes only the usage entry (3.12).
   - `throw error` rethrows the same object, so `compile` and `handle` see what they see today (3.14).

3. **Build the failure entry from allowed fields only**:
   ```ts
   /** What an API error type looks like (authentication_error). Anything else stays out of the log. */
   const API_ERROR_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

   /**
    * The log entry of a failed SDK call: the HTTP status and the API error type when the SDK error
    * has them, and the error's class name. Never the message, which holds the response body, and
    * never the request id, the error code or anything from the request (11.2).
    */
   export function failureEntry(error: unknown): Record<string, unknown> {
     const entry: Record<string, unknown> = { event: FAILURE_EVENT };
     if (error instanceof APIError) {
       if (typeof error.status === 'number') entry.status = error.status;
       if (typeof error.type === 'string' && API_ERROR_TYPE.test(error.type)) entry.error_type = error.type;
     }
     // The SDK sets name to each class's own name, which survives a bundler renaming classes.
     entry.error_class = error instanceof Error ? error.name : typeof error;
     return entry;
   }
   ```
   - **Event name**: `model-call-failed`, so the usage entry and the failure entry share the `model-call` stem, and a log query can tell them apart. The field names use snake_case like the usage entry's `stop_reason` and `input_tokens`. `status` is the API's HTTP status. The `event` field separates it from the request line's `status`, which is the Worker's own.
   - **Status**: `error.status`, a number on every API error and undefined on `APIConnectionError` and `APIConnectionTimeoutError`. When it is missing, the key is left out, not set to `undefined`, so `toStrictEqual` and `JSON.stringify` agree (2.4).
   - **API error type**: `error.type` (line 25 of `core/error.mjs`). The SDK takes it from the parsed body and does not check it at runtime. The probe kept `'weird type with spaces'` as it was. The Identifier_Rule therefore keeps free text and non-strings out of the log while letting every declared `ErrorType` through (2.5).
   - **Class name**: `error.name`, not `error.constructor.name`. Both gave the same names in the probe (`AuthenticationError`, `APIConnectionTimeoutError`, `EnforcedSpendLimitReachedError`). But the SDK sets `name` from a string constant (`_errorName`) precisely so that it survives minification. `constructor.name` depends on the bundler keeping class names, which `wrangler deploy --minify` does not promise. For a value that is not an Error, `typeof error` gives `string`, `object` or `undefined` and never shows the value. That is the rule `handle` uses for `thrown`.
   - **Left out on purpose**: `message` and `apiMessage` (the SDK puts the raw body in `message`, 2.5), `error` and `details` (the body), `headers`, `requestID`, `workspaceID`, `errorCode`, `cause` (a connection error's cause can carry a URL), and anything from `input`.

4. **Comments**: The doc comment of `makeAsk` gains "A rejected SDK call first writes one failure entry, then rejects with the same error." The section "worker/src/ask.ts" in the sentence-compiler design.md says the Ask logs only after each response. That text becomes stale, so the final documentation task updates it.

**File**: `test/worker/handle.test.ts`

**Test**: "answers 502 model when reading the body fails" (describe `Requirement 1.5`, lines 307 to 319)

**Specific Changes**:
1. **Fake an erroring body stream instead of a rejecting `arrayBuffer`**: This is the one permitted edit. Lines 310 to 316 become:
   ```ts
   const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new RangeError('stream broke')); } });
   const failing = new Proxy(req, {
     get(target, prop) {
       if (prop === 'body') return broken;
       const value = Reflect.get(target, prop, target);
       return typeof value === 'function' ? value.bind(target) : value;
     },
   });
   ```
   Lines 317 and 318, the 502 response and the exact log line with `thrown: 'RangeError'`, stay as they are. The edit lands in the same change as `readRequest`. On the unfixed code, the edited Proxy would pass `arrayBuffer` through to the real valid body, the compile would run past `setup()`'s empty step list, and the test would fail. On the fixed code, the old Proxy would no longer fake anything.

**Files not changed**: `worker/src/index.ts` already passes the same `log` to `makeAsk` and `handle`, so the failure entry reaches `console.log` as its own line before the request line. `http.ts`, `access.ts`, `limits.ts`, `wrangler.toml`, `src/compiler`, `src/hypertalk` and `src/ui` stay as they are. The response contract keeps 400 `bad-request` for an oversized body (SC 2.2), so no 413 is introduced.

**Alternatives considered**:
- Check `Content-Length` and keep `arrayBuffer()`. This fixes 1.1 but not 1.2: a chunked upload or a wrong header still makes the Worker hold everything.
- Pipe the body through a counting `TransformStream` into `new Response(stream).arrayBuffer()`. This adds a second queue that keeps filling after the limit unless it is torn down too, for the same result as the reader loop.
- Cancel `request.body` on the declared-length path. Decided against in change 1 of `handle.ts`.
- Log the failure in `handle` or `compile`. `compile` is out of scope, and its `CallEvent` holds no error by design. `handle` never sees the error, because `compile` returns `model`. The Ask is the only place that holds it, and it already has `options.log`.
- Read the type from `error.error?.error?.type`. In 1.12.0, `error.type` is that same value, already extracted.
- Log `requestID` or `errorCode` to help support requests. bugfix.md 2.5 excludes both, and the class name already tells the error-code subclasses apart.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. The exploration tests and the preservation tests are written and run on the unfixed code first. The exploration tests must fail there, in the ways listed below. The preservation tests must pass there. Then the fix and the one test edit land together, and `npx vitest --run`, `npm test` and `npm run typecheck` must all pass.

Every new test file in `test/worker` imports `../compiler/helpers/noNetwork` as its first import. `test/compiler/scan.test.ts` enforces this for every `*.test.ts` under `test/worker` (SC 14.10, 3.16). The Ask gets its `fetch` only through `AskOptions.fetch`.

**Test helpers** (new, test-only):

- `test/worker/helpers/bodies.ts`:
  - `countingBody(chunks, { errorAfter? })` returns `{ stream, taken(), cancels() }`. The stream is `new ReadableStream({ pull, cancel }, { highWaterMark: 0 })`. Each pull enqueues the next chunk, or closes when none is left, or calls `controller.error(new RangeError('stream broke'))` once `errorAfter` chunks have gone out. `highWaterMark: 0` is required. With the default of 1, a stream pulls once when it is built, before anyone reads (observed in Node), and a test would count a chunk the Worker never took. With 0, one read is one pull (observed: three reads, three pulls, and none after `cancel`).
  - `repeated(size, count)` returns `count` views of one shared buffer, so the 90 MB Repro costs 64 KiB of test memory.
  - `cut(bytes, offsets)` splits bytes at the given offsets.
  - `compileBody(size, { multiByte? })` returns the UTF-8 bytes of a valid CompileRequest padded to exactly `size` bytes through an extra `pad` field, which `readCompileRequest` drops. With `multiByte`, the pad is mostly `é`, `€` and `🦦` (2, 3 and 4 bytes), so random cuts often fall inside a character.
  - `jsonRequest({ body, contentLength?, contentType?, token?, path? })` builds the `Request`. It sets `Content-Length` with `headers.set` only when asked, because Node's `Request` adds none of its own. Node keeps a test-set `Content-Length` (undici applies no forbidden-header list), trims surrounding spaces, and joins two headers as `12, 12`, all observed. A stream body is passed with `duplex: 'half'`, and `request.body` is then the same stream object (observed), so `taken()` and `request.bodyUsed` describe what the Worker did.
  - `referenceAnswer(bytes)` is the original F's request check, written out in the test: more than MAX bytes, or strict decoding fails, or `JSON.parse` fails, or `readCompileRequest` returns null, gives 400. Otherwise the request passes.
- `test/worker/helpers/fakeApi.ts`:
  - `apiFetch(make)` is a fake `fetch` that records each call and answers with `make(init)`, so a fake can read `init.signal`.
  - `errorBody(status, type, message, extra?)` builds a `Response` with `{"type":"error","error":{…}}`, `content-type: application/json` and a `request-id: req_LEAKCHECK` header.
  - `textBody(status, text)` builds a non-JSON body.
  - `never()` waits for `init.signal` to abort and rejects with `init.signal.reason`.
  - `KEY` and `MARK` are distinctive strings to search the logs for.

**Faking SDK failures with the existing `fetch` option**. The expected classes were observed against the installed 1.12.0:

| Fake response | Rejection (`error.name`) | Expected failure entry |
|---|---|---|
| 401 `authentication_error` | `AuthenticationError` | `status: 401, error_type: 'authentication_error'` |
| 403 `permission_error` | `PermissionDeniedError` | `status: 403, error_type: 'permission_error'` |
| 404 `not_found_error` (a model the workspace cannot use) | `NotFoundError` | `status: 404, error_type: 'not_found_error'` |
| 400 `invalid_request_error` with a credit-balance message | `BadRequestError` | `status: 400, error_type: 'invalid_request_error'` |
| 402 `billing_error` | `PaymentRequiredError` | `status: 402, error_type: 'billing_error'` |
| 429 `rate_limit_error` with `details.error_code: 'enforced_spend_limit_reached'` | `EnforcedSpendLimitReachedError` | `status: 429, error_type: 'rate_limit_error'` |
| 500 `api_error` | `InternalServerError` | `status: 500, error_type: 'api_error'` |
| 529 `overloaded_error` | `OverloadedError` | `status: 529, error_type: 'overloaded_error'` |
| 502 `text/html` body | `InternalServerError` | `status: 502` |
| 418 with type `'weird type with spaces'` | `APIError` | `status: 418` |
| 200 whose body is not JSON | `SyntaxError` | none besides the class |
| `fetch` rejects with `TypeError('fetch failed')` | `APIConnectionError` (its `cause` is the TypeError) | none besides the class |
| `never()` with `timeoutMs: 20` | `APIConnectionTimeoutError` | none besides the class |

Every entry also holds `event: 'model-call-failed'` and `error_class` equal to the rejection's name. Each case asserts:
- `logs` equals exactly `[entry]` (`toStrictEqual`);
- the rejection is an instance of the SDK class, imported from `@anthropic-ai/sdk`, with the expected `status`, and its `requestID` is still on it, which shows it was not wrapped;
- the fake `fetch` was called once;
- `JSON.stringify(logs)` contains none of the message text, `req_LEAKCHECK`, `enforced_spend_limit_reached`, `KEY`, `MARK` or `Compile this request`.

The network-error fake's message must not match the SDK's `/timed? ?out/i` test (`client.mjs` line 657), or the SDK reports a timeout. The timeout case uses real timers. A fake that is never aborted fails at vitest's default 5-second timeout instead of hanging.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write `handle` tests with Counting_Bodies and declared lengths, and Ask tests with the fake responses above, all asserting Properties 1 and 3. Run them on the UNFIXED code to observe failures and understand the root cause. Tests that call `readLimitedBody`, `declaredLength` or `failureEntry` directly cannot be imported before the fix, so the exploration runs only through `handle` and `makeAsk`.

**Test Cases**:
1. **Repro 1, declared, small body**: `Content-Length: 94371840` with `compileBody(150)` and one reply step. Expect 400, no `take`, no Model_Call, the bad-request log line (will fail on unfixed code: 200, one `take`, one Model_Call, observed).
2. **Repro 1, declared, 90 MB**: the same header with `countingBody(repeated(65536, 1440))`. Expect `taken() === 0` and `request.bodyUsed === false` (will fail on unfixed code: 1,440 taken, observed).
3. **Repro 1, streamed**: no `Content-Length`, the same body. Expect 400, `taken() === 5`, `cancels() === 1` (will fail on unfixed code: 1,440 and 0, observed).
4. **Header that is not a declared length, or too small**: `abc`, `-1`, `1e3`, `12.5`, `''`, `12, 12` and `3` with the same body. Expect 5 and 1 (will fail on unfixed code: 1,440 and 0, observed for `abc` and `3`).
5. **Error after the limit**: `countingBody(repeated(65536, 5), { errorAfter: 5 })` with no header. Expect 400 with `calls: []` and no `thrown` (will fail on unfixed code: 502 with `thrown: 'RangeError'`).
6. **Repro 2 at the Ask**: the 401 fake. Expect `logs` to equal the one failure entry (will fail on unfixed code: `[]`, observed through `handle`).
7. **Network and timeout at the Ask**: expect one entry each (will fail on unfixed code: `[]`).
8. **Repro 2 through `handle` with the real Ask**: expect two lines, the failure entry and then the request line (will fail on unfixed code: only the request line, observed).

**Expected Counterexamples**:
- Bug 1: chunks taken equal the whole body (1,440). No cancel ever happens. A declared 90 MB with a small valid body is compiled. A stream that errors after the limit becomes 502.
- Bug 2: `logs` stays empty for every rejection kind, while the rejection itself carries `status`, `type` and `name`.
- Possible causes, as hypothesised: the full read before the check, `Content-Length` never read, and the Ask writing to its log only on success.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FUNCTION expectedBehavior(X, result)
  INPUT: X where isBugCondition(X); result, what the fixed code did with X
  OUTPUT: boolean

  IF X is a request R THEN
    ok := result.response = 400 { ok: false, error: 'bad-request' }
          AND result.logs = [{ event: 'request', status: 400, error: 'bad-request', calls: [] }]
          AND result.takeCalls = 0 AND result.askCalls = 0
    IF declared(R) ≠ NONE AND declared(R) > MAX THEN
      RETURN ok AND result.chunksTaken = 0 AND R.bodyUsed = false            -- 2.1
    k := the least k with prefix(R, k) > MAX
    RETURN ok AND result.chunksTaken = k AND result.cancels = 1              -- 2.2
  ELSE                                                                        -- X is an Ask call A, rejected with e
    entry := { event: 'model-call-failed' }
    IF e instanceof APIError AND typeof e.status = 'number' THEN entry.status := e.status
    IF e instanceof APIError AND e.type matches /^[a-z][a-z0-9_]{0,63}$/ THEN entry.error_type := e.type
    entry.error_class := (e instanceof Error) ? e.name : typeof e
    RETURN result.logs = [entry]                                              -- 2.3, 2.4, 2.5
           AND result.rejection IS e
           AND result.fetchCalls = 1                                          -- 3.14
           AND serialized(result.logs) holds no message, body, requestID, errorCode,
               sentence, name, Client_Key, API key or Access_Token            -- 2.5
END FUNCTION

FOR ALL X WHERE isBugCondition(X) DO
  result := fixed(X)
  ASSERT expectedBehavior(X, result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL R WHERE R is a request AND NOT isBodyBug(R) DO
  ASSERT handle_original(R) = handle_fixed(R)     -- status, body, log lines, count, Model_Calls
END FOR

FOR ALL A WHERE A is an Ask call AND NOT isFailureBug(A) DO
  ASSERT ask_original(A) = ask_fixed(A)           -- reply or rejection, log entries, fetch requests
END FOR
```

The committed tests keep no frozen copy of the old code. For bodies, `referenceAnswer(bytes)` restates F's check, and the single-chunk answers it predicts are already pinned by the existing `handle.test.ts` (200, the 256 KiB test, the bad-request cases). For the Ask, the existing `ask.test.ts` pins the request, the mapping and the usage entry, and it stays unchanged.

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for bodies within the limit in many chunkings, the boundary at MAX, odd `Content-Length` values, empty and broken bodies, other media types, 401 and 404, erroring streams, and resolved or keyless Ask calls. Then write property-based tests capturing that behavior.

**Test Cases**:
1. **Chunking within the limit (3.1, 3.8, 3.9)**: Observe on unfixed code that `compileBody(n, { multiByte: true })` in random cuts, and random bytes in random cuts, answer as `referenceAnswer` says. Then write a test to verify this continues after the fix.
2. **The boundary (3.2, 3.3)**: Observe that `Content-Length: 262144` with a valid body of exactly 262,144 bytes gets 200, in one chunk and in four chunks of 65,536, and that the existing 256 KiB test passes. Then write a test to verify this continues after the fix.
3. **Odd `Content-Length` values (3.4, 3.5)**: Observe that `3` with a valid body of a few hundred bytes gets 200, and that `abc`, `-1`, `1e3`, `12.5`, `''`, `12, 12` and `+5` with a valid small body get 200. Then write a test to verify this continues after the fix.
4. **Empty bodies (3.6)**: Observe 400 for no body, `''`, an empty Counting_Body and `Content-Length: 0`. Then write a test to verify this continues after the fix.
5. **Media type and order (3.7, 3.11)**: Observe 400 for `text/plain` and for no `Content-Type` with `Content-Length: 94371840`, 401 without a token, and 404 on `/api/other`, each with `taken() === 0` and `bodyUsed` false. Then write a test to verify this continues after the fix.
6. **Erroring stream within the limit (3.10)**: Observe that `countingBody(repeated(1000, 3), { errorAfter: 3 })` gives 502 with `thrown: 'RangeError'`, `calls: []` and no `take`. Then write a test to verify this continues after the fix. The existing Proxy test is switched to a body stream in the fix change.
7. **Ask success and missing key (3.12, 3.13, 3.15)**: Observe that the existing `ask.test.ts` passes, including the refusal case and the missing-key case with `logs` empty. Then keep it passing unchanged. Add a test that after a failed call, the same Ask's next successful call writes only its usage entry.

### Unit Tests

- `test/worker/bodyLimit.test.ts`, `declaredLength`: `'0'`, `'262144'` and `'000262145'` give numbers. `'9'.repeat(400)` gives a number above MAX. `null`, `''`, `'abc'`, `'-1'`, `'+5'`, `'1e3'`, `'12.5'`, `'12, 12'`, `'0x10'` and `'１２'` (full-width) give null.
- `test/worker/bodyLimit.test.ts`, `readLimitedBody`:
  - `null` gives zero bytes.
  - An empty stream gives zero bytes.
  - Chunks totalling exactly the limit give their concatenation, with every chunk taken and no cancel.
  - One byte more gives null, with the crossing chunk the last one taken and one cancel.
  - A single chunk larger than the limit gives null after one chunk.
  - An erroring stream rejects with the same RangeError object.
  - A source whose `cancel` throws still gives null and leaves no unhandled rejection.
- `test/worker/bodyLimit.test.ts`, through `handle`: Exploration cases 1 to 5 and Preservation cases 2 to 6, each asserting the exact response, the exact log line, `take` calls, Model_Calls, `taken()`, `cancels()` and `bodyUsed`.
- `test/worker/askFailure.test.ts`: one test per row of the fake-response table, each asserting the exact entry, the rejection class and status, one `fetch` call, and no leaked text.
- `test/worker/askFailure.test.ts`, `failureEntry`:
  - `'boom'` gives `{ event, error_class: 'string' }`.
  - `undefined` gives `'undefined'`, and `null` gives `'object'`.
  - `{ status: 401, type: 'authentication_error', message: MARK }` gives `{ event, error_class: 'object' }`, because only an APIError's fields are read.
  - `new Error(MARK)` gives `{ event, error_class: 'Error' }`.
- `test/worker/askFailure.test.ts`, preservation: a successful call writes only `model-call`. A failed call followed by a successful one on the same Ask writes `[failure entry, usage entry]` with two `fetch` calls. The missing key behaves as in 3.13.

### Property-Based Tests

Each property test uses fast-check and carries the comment `Feature: worker-body-limit-and-model-error-log-fix, Property <n>: <title>`.

- **`test/worker/bodyLimit.property.test.ts`, Property 1, small limits**: For any limit from 0 to 64 and any list of 0 to 12 chunks of 0 to 20 bytes whose total is above the limit, `readLimitedBody` returns null. `taken()` equals the least k whose prefix total passes the limit, `cancels()` is 1, and `taken()` stays the same after a microtask flush. 500 runs. Small limits exercise many chunkings cheaply.
- **Property 1, at MAX through `handle`**: For any total from MAX + 1 to MAX + 200,000, any cuts, any `Content-Length` that is missing, not a declared length (from a printable alphabet of digits, signs, `.`, `e`, `,` and letters) or at most MAX, and an optional error after the last chunk: `handle` answers 400 with the bad-request log line, no `take` and no Model_Call. `taken()` is the crossing index and `cancels()` is 1. 50 runs.
- **Property 1, declared above MAX**: For any declared length string above MAX (digits with optional leading zeros, up to 30 digits) and any body (none, empty, a valid `compileBody`, a Counting_Body of up to 1,440 chunks, or one that errors at once): 400, `taken() === 0`, `bodyUsed` false, no `take`, no Model_Call. 100 runs.
- **`bodyLimit.property.test.ts`, Property 2, small limits**: For any limit from 0 to 64 and any chunks whose total is at most the limit, `readLimitedBody` returns exactly the concatenated bytes, takes every chunk and never cancels. 500 runs.
- **Property 2, chunking through `handle`**: For any n from 1 to MAX, with the cases near MAX weighted up (`fc.oneof` with `fc.integer({ min: MAX - 64, max: MAX })`), take `compileBody(n, { multiByte: true })` or random bytes of length n. For any cuts and any `Content-Length` that is not a declared length or is at most MAX, the answer, the log line and the `take` count equal both `referenceAnswer(bytes)` and the answer for the same bytes sent as one chunk. A body that passes gets 200 from one reply step. 100 runs. This test runs green on the unfixed code too.
- **Property 2, `declaredLength`**: For any string from a mix of digit strings, printable ASCII and full-width digits, `declaredLength(s)` equals `/^[0-9]+$/.test(s) ? Number(s) : null`. 1,000 runs.
- **`test/worker/askFailure.property.test.ts`, Property 3, any rejection value**: For any value from `fc.anything()`, Errors with arbitrary messages, and SDK errors built directly with arbitrary fields, `failureEntry` never throws, and its keys are a subset of `event`, `status`, `error_type` and `error_class`. The SDK errors come from `new APIError(status, body, undefined, headers)`, `new AuthenticationError(…)`, `new APIConnectionError({ cause })` and `new APIConnectionTimeoutError()`, with arbitrary status, `type` (an identifier, free text, a number, an object or missing), message, details and headers. `status` is present exactly for a numeric APIError status. `error_type` is present exactly when the type passes the Identifier_Rule. `error_class` is the name or `typeof`. `JSON.stringify(entry)` never contains the generated message. Every message carries a `Leak-Marker-` prefix, whose hyphen and capitals cannot occur in an identifier or an SDK class name, so a hit can only be a leak. 1,000 runs.
- **Property 3, through the real SDK**: For any status from 400 to 599, any body (JSON with arbitrary `type`, a marked message, optional `details.error_code` drawn partly from the SDK's known codes, or non-JSON marked text) and any `request-id`, the Ask rejects with an `APIError` whose `status` is the generated one. `logs` equals `[failureEntry(rejection)]`, with `error_class` equal to the rejection's `name`. The fake `fetch` was called once, and the serialized logs contain no marker, request id, error code or key. 200 runs.
- **`askFailure.property.test.ts`, Property 4, mixed sequences**: For any sequence of 1 to 6 outcomes on one Ask, where each is a success (random token counts, a stop reason among `end_turn`, `max_tokens` and `refusal`, with or without a `fallback_message` iteration) or a failure (a random row of the fake-response table), the results match the outcomes in order:
  - `logs` holds one entry per call: exactly the usage entry for a success, exactly the failure entry for a failure.
  - Successes return the Model_Reply that `toModelReply` gives.
  - Failures reject.
  - `fetch` is called once per call, and the recorded request bodies equal `requestBody(input)` (3.15).

  This covers the client being reused after a failure. 100 runs.

### Integration Tests

- **Repro 2 end to end** (`askFailure.test.ts`): `handle` with `makeAsk({ apiKey: KEY, fetch: 401 fake, log })` and the same `log` for `handle`, as `index.ts` wires it. The response is 502 `{ ok: false, error: 'model' }`. `logs` equals `[{ event: 'model-call-failed', status: 401, error_type: 'authentication_error', error_class: 'AuthenticationError' }, { event: 'request', status: 502, error: 'model', calls: [{ call: 1, result: 'failed' }] }]`. The MemoryStore counted once, `fetch` was called once, and no log or response holds KEY, the Sentence, any Request_Name, the IP, the Access_Token, the request id or the API message (2.3, 2.5, 3.14).
- **Network error and timeout end to end**: The same wiring with the network fake and the timeout fake gives the same 502 and request line, preceded by `{ event, error_class: 'APIConnectionError' }` or `{ event, error_class: 'APIConnectionTimeoutError' }` (2.4, 3.14).
- **Body limit with Access on** (`bodyLimit.test.ts`): With `REQUIRE_ACCESS: 'true'` and the local key set:
  - A request without a token, with `Content-Length: 94371840` and a Counting_Body, gets 401 with `taken() === 0`.
  - With a token but path `/api/other`, it gets 404 with `taken() === 0`.
  - With a token, the right path and no `Content-Length`, it gets 400 with 5 taken and 1 cancel.

  The store is unchanged in all three (3.11, 2.2).
- **Erroring body end to end**: The edited existing test, plus a Counting_Body that errors after 3 small chunks, gives 502 with `thrown: 'RangeError'`. A Counting_Body that errors after passing the limit gives 400. Neither is counted (3.10, 2.2).
- **Whole suite**: `npx vitest --run` passes with the existing 74 Worker tests unchanged, apart from the Proxy edit. `test/compiler/scan.test.ts` finds the new files and their `noNetwork` first import. `npm run typecheck` passes under `tsconfig.worker.json` (workers types) and `tsconfig.test.json` (Node types) (3.16).
