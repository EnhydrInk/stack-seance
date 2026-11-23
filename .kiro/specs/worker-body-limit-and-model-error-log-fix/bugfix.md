# Bugfix Requirements Document

## Introduction

This spec fixes two bugs in the Cloudflare Worker of the sentence compiler (spec `sentence-compiler`). Requirement numbers written as SC 2.2 and so on refer to `.kiro/specs/sentence-compiler/requirements.md`.

**Bug 1: the body is read in full before its size is checked.** SC 2.2 turns away a body over 256 KiB, and SC 2.7 says a bad request costs nothing. Today the Worker reads the whole body into memory first and compares its length with the limit afterwards. It never looks at the `Content-Length` header. One large request can push the isolate past its memory limit and fail the other compiles running in it. While Cloudflare Access is on, only a signed-in user can send such a request. On submission day Access comes off (SC 9.4) and anyone can.

**Bug 2: a failed model call leaves nothing to debug with.** When the API call of a Model_Call fails, the Ask rejects (SC 7.10) and the Compiler records only `{ call, result: 'failed' }`. Nothing records why. With a wrong key, a model the workspace cannot use, or a workspace that has hit its spend limit, every compile answers 502 `model` and is counted, and the logs give no reason. The fix logs the HTTP status, the API error type and the error's class name. It logs no error message text, because the SDK puts the raw response body in `message` (for a 401 it is `401 {"type":"error","error":{"type":"authentication_error","message":"…"}}`), and SC 11.2 keeps personal data and secrets out of logs.

Terms used below:

- **Compile_Route**, **Model_Call**, **Ask**, **Sentence**, **Request_Names**, **Client_Key** and **Access_Token** are used as in the sentence-compiler glossary.
- **MAX_BODY_BYTES** is 262,144 bytes (256 KiB), the body limit of SC 2.2.
- The **declared length** of a request is the value of its `Content-Length` header when that value is one or more ASCII digits and nothing else, read as a whole number. A missing header, an empty value, or any other value (for example `abc`, `-1`, `1e3`, `12.5` or `12, 12`) gives no declared length.
- The **received bytes** are the bytes the Worker has taken from the request's body stream so far. A request with no body has zero received bytes.
- A **JSON request** is a request on the Compile_Route that has passed the Access check and whose `Content-Type` media type is `application/json` (SC 2.1).
- The **SDK call** is the call to the Anthropic SDK that the Worker's Ask makes for one Model_Call, after its key check has passed.
- A **failure entry** is the log entry the Worker's Ask writes when the SDK call rejects.

Repro 1: send `POST /api/compile` with `Content-Type: application/json`, `Content-Length: 94371840` and a 90 MB body. Today the Worker holds all 90 MB in memory before it answers 400 `bad-request`. The same happens when the 90 MB arrive as a stream without `Content-Length`.

Repro 2: deploy with `ANTHROPIC_API_KEY` set to a revoked key, so the API answers 401 `authentication_error`. Every compile answers 502 `model` and is counted. The only log line is `{"event":"request","status":502,"error":"model","calls":[{"call":1,"result":"failed"}]}`. After the fix, the same compile also logs the status 401, the type `authentication_error` and the class name `AuthenticationError`.

The fix changes code only in `worker/src` and `test/worker`, and its final documentation task updates `.kiro/specs/sentence-compiler/design.md` to match. It does not change `src/compiler`, `src/hypertalk` or `src/ui`. Tests stay free of network requests (SC 14.10), and every existing test stays green. Existing tests are not edited, with one permitted exception tied to 3.10: the test "answers 502 model when reading the body fails" (`test/worker/handle.test.ts`, describe `Requirement 1.5`) may change only how it fakes the failure. Its Proxy makes `body` a ReadableStream that errors with `RangeError('stream broke')`, instead of making `arrayBuffer()` reject. Its assertions stay exactly as they are: the 502 `{ ok: false, error: 'model' }` response and the log line `{ event: 'request', status: 502, error: 'model', calls: [], thrown: 'RangeError' }`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a JSON request has a declared length above MAX_BODY_BYTES (Repro 1) THEN the system reads the whole body into memory before it compares the length with MAX_BODY_BYTES, and decides by the received bytes alone. A 90 MB body is held in full before the 400 `bad-request`, and a request that declares more than MAX_BODY_BYTES but sends a small valid body is compiled and counted

1.2 WHEN a JSON request has no declared length above MAX_BODY_BYTES (no `Content-Length`, a value that is not a declared length, or a declared length of at most MAX_BODY_BYTES that is smaller than the real body) and more than MAX_BODY_BYTES arrive THEN the system keeps reading until the body ends and holds every byte before it answers 400 `bad-request`

1.3 WHEN the SDK call rejects with an API error, such as the 401 `authentication_error` of Repro 2 THEN the system writes no log entry for the failure. The request log line holds only `{ call, result: 'failed' }`, with no HTTP status, no API error type and no error class

1.4 WHEN the SDK call rejects with a network error (`APIConnectionError`) or a timeout (`APIConnectionTimeoutError`) THEN the system writes no log entry that names the kind of failure

### Expected Behavior (Correct)

2.1 WHEN a JSON request has a declared length above MAX_BODY_BYTES THEN the system SHALL answer 400 `{ ok: false, error: 'bad-request' }` without reading any of the body, whatever body follows, including an empty or a valid one. It SHALL not count the request, SHALL make no Model_Call, and SHALL log the same request line as for any other bad request: `{ event: 'request', status: 400, error: 'bad-request', calls: [] }`

2.2 WHEN a JSON request has no declared length above MAX_BODY_BYTES and the received bytes pass MAX_BODY_BYTES THEN the system SHALL read the body chunk by chunk, take no further chunk from the body stream once the received bytes are more than MAX_BODY_BYTES, and answer 400 `{ ok: false, error: 'bad-request' }`. It SHALL not count the request, SHALL make no Model_Call, and SHALL log the same request line as in 2.1. This holds when `Content-Length` is missing, when it is not a declared length, and when it declares at most MAX_BODY_BYTES but the body is longer

2.3 WHEN the SDK call rejects with an error that has an HTTP status THEN the Worker's Ask SHALL write exactly one failure entry through `options.log` and then reject with the same error object. The failure entry SHALL hold an event name that tells it apart from the usage entry of a successful call, the HTTP status, the API error type when the response body gave one, and the error's class name. For Repro 2 these are 401, `authentication_error` and `AuthenticationError`. For a 502 with a body that is not JSON they are 502, no type, and `InternalServerError`

2.4 WHEN the SDK call rejects with a network error or a timeout THEN the Worker's Ask SHALL write exactly one failure entry that holds the event name of 2.3 and the error's class name (`APIConnectionError` or `APIConnectionTimeoutError`), with no HTTP status and no API error type, and then reject with the same error object

2.5 WHEN the Worker's Ask writes a failure entry THEN the system SHALL put only these fields in it: the event name, the HTTP status when the error has one, the API error type when the error has one, and the error's class name. It SHALL hold no `requestID`, no `errorCode`, no error message text, no response body, no Sentence, no Request_Names, no Client_Key, no API key and no Access_Token (SC 11.2)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a JSON request has no declared length above MAX_BODY_BYTES and its body is at most MAX_BODY_BYTES THEN the system SHALL CONTINUE TO decode, parse and check the body exactly as today and give the same answer, the same count and the same log line: 200, 422 or 502 for a CompileRequest that passes SC 2.2 to 2.6, and 400 `bad-request` for one that does not

3.2 WHEN a JSON request has a declared length of exactly MAX_BODY_BYTES THEN the system SHALL CONTINUE TO read the body and judge it by its received bytes. A valid body of exactly MAX_BODY_BYTES gets 200

3.3 WHEN a JSON request without `Content-Length` has a body of exactly MAX_BODY_BYTES THEN the system SHALL CONTINUE TO accept it, and SHALL CONTINUE TO answer 400 `bad-request` for one byte more (the existing 256 KiB test)

3.4 WHEN a JSON request's `Content-Length` differs from its real body, but declares at most MAX_BODY_BYTES, and the real body is at most MAX_BODY_BYTES THEN the system SHALL CONTINUE TO judge the request by its received bytes, as today. For example, `Content-Length: 3` with a valid body of a few hundred bytes gets 200. This behavior is decided, not assumed

3.5 WHEN a JSON request has a `Content-Length` that is not a declared length (for example `abc`, `-1`, `1e3`, `12.5` or an empty value) THEN the system SHALL CONTINUE TO ignore the header and judge the request by its received bytes, as today, with the limit of 2.2 still in force. This behavior is decided, not assumed

3.6 WHEN a JSON request has an empty body (no body, zero bytes, or `Content-Length: 0`) THEN the system SHALL CONTINUE TO answer 400 `bad-request`, because empty text is not JSON

3.7 WHEN a request on the Compile_Route has a media type other than `application/json`, including no `Content-Type` at all THEN the system SHALL CONTINUE TO answer 400 `bad-request` before it reads any of the body or looks at `Content-Length`. A declared length above MAX_BODY_BYTES does not change that answer

3.8 WHEN a body of at most MAX_BODY_BYTES is invalid UTF-8, is text that is not JSON, or is JSON that is not a valid CompileRequest THEN the system SHALL CONTINUE TO answer 400 `bad-request`. Decoding SHALL CONTINUE TO be strict UTF-8 with a leading byte order mark dropped, as today

3.9 WHEN a body of at most MAX_BODY_BYTES arrives in many chunks, including a multi-byte UTF-8 character split across two chunks THEN the system SHALL CONTINUE TO decode it to the same text and give the same answer as for the same bytes in one chunk

3.10 WHEN reading the body fails because the body stream errors THEN the system SHALL CONTINUE TO answer 502 `{ ok: false, error: 'model' }`, make no Model_Call, not count the request, and log the request line with `thrown` set to the error's name only (SC 1.5). The existing test "answers 502 model when reading the body fails" covers this, with its failure faked by an erroring body stream as the Introduction permits

3.11 WHEN a request fails the Access check or the route check THEN the system SHALL CONTINUE TO answer 401 or 404 first, without reading the body or looking at `Content-Length` (SC 8.3)

3.12 WHEN the SDK call resolves, including with a `refusal` stop reason THEN the Worker's Ask SHALL CONTINUE TO write exactly the usage entry it writes today (numbers and ids only), write no failure entry, and return the same Model_Reply

3.13 WHEN `ANTHROPIC_API_KEY` is missing or empty THEN the Worker's Ask SHALL CONTINUE TO reject with `Error('ANTHROPIC_API_KEY is not set')` before any SDK client exists, without calling `fetch` and without writing any log entry

3.14 WHEN the SDK call rejects THEN the system SHALL CONTINUE TO make exactly one HTTP request for that Model_Call (no SDK retries), and the Compiler SHALL CONTINUE TO record `{ call, result: 'failed' }`, make no further Model_Call and return error `model`. The Worker SHALL CONTINUE TO answer 502 `{ ok: false, error: 'model' }`, count the request once (SC 10.1), and log the same request line as today

3.15 WHEN the Worker's Ask makes a Model_Call THEN the system SHALL CONTINUE TO send the same request as today, with the same base URL, key, headers, body, timeout and `maxRetries: 0` (SC 7.1 to 7.9)

3.16 WHEN the Test_Suite runs with `vitest --run` THEN the system SHALL CONTINUE TO make no network request (SC 14.10), and every existing test SHALL CONTINUE TO pass
