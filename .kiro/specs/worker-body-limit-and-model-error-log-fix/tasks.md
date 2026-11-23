# Implementation Plan

## Overview

This plan fixes two bugs in the Worker. Bug 1: `readRequest` in `worker/src/handle.ts` reads the whole body before it checks the size, and never reads `Content-Length`. Bug 2: `makeAsk` in `worker/src/ask.ts` writes nothing when the SDK call rejects. Tasks 1 to 4 write the exploration and preservation tests for both bugs on the unfixed code (commit `80c9e62`). Task 5 fixes Bug 1 and task 6 fixes Bug 2. Task 7 updates the "worker/src/handle.ts" and "worker/src/ask.ts" sections of `.kiro/specs/sentence-compiler/design.md` to match the fixed code, and task 8 runs the full suite and the type check.

Requirement numbers (1.1, 3.10) refer to this spec's `bugfix.md`. Property numbers, pseudocode names and quoted section names refer to this spec's `design.md`. Code changes stay in `worker/src/handle.ts`, `worker/src/ask.ts` and `test/worker`. Outside this spec, the only other file that changes is `.kiro/specs/sentence-compiler/design.md`, in task 7.

The workspace's PreTaskExec hook (`.kiro/hooks/scripts/tests-green.sh`) blocks every task and sub-task while `vitest run` is red, and exploration tests fail on the unfixed code by design. So tasks 1 and 3 first run their tests unmarked to see and record the failures, then mark each one `it.fails`. Tasks 5.1 and 6.1 remove the markers in the same change as the fix and leave the test bodies as they are.

Every test task ends with `npm run typecheck` as well as vitest, because vitest does not type-check and `tsconfig.test.json` includes `test/worker`.

## Tasks

- [x] 1. Write bug condition exploration tests for Bug 1 (body limit)
  - **Property 1: Bug Condition** - Over-limit bodies are turned away without being held
  - **CRITICAL**: These tests MUST FAIL on unfixed code. The failures confirm the bug exists
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior. They will validate the fix when they pass after task 5.1
  - **GOAL**: Surface counterexamples where the Worker holds an over-limit body, or compiles a request that declares more than MAX
  - **Scoped PBT Approach**: The bug is deterministic. Pin Repro 1 and its edges as unit tests, and scope the properties to generated requests that satisfy the bug condition by construction
  - Bug condition from design (`isBodyBug(R)`): `jsonRequest(R) AND ((declared(R) ≠ NONE AND declared(R) > MAX) OR prefix(R, length(chunks(R))) > MAX)`, with MAX = 262,144 and the declared length as bugfix.md defines it (one or more ASCII digits and nothing else)
  - Expected behavior from design (`expectedBehavior`, request branch):
    - 400 `{ ok: false, error: 'bad-request' }`, `logs` exactly `[{ event: 'request', status: 400, error: 'bad-request', calls: [] }]`, no `take` call and no Model_Call
    - With a declared length above MAX: `taken() === 0` and `request.bodyUsed === false`
    - Otherwise: `taken()` equals the least k with `prefix(R, k) > MAX`, and `cancels() === 1`
  - Create `test/worker/helpers/bodies.ts` with `countingBody`, `repeated`, `cut`, `compileBody` and `jsonRequest`, as design "Test helpers" describes them
    - Add a deps builder shaped like `setup()` in `test/worker/handle.test.ts` (lines 40 to 52) that also counts `take` calls and Model_Calls. It uses `REQUIRE_ACCESS: 'false'` unless a test asks for Access
    - Build the Counting_Body with `highWaterMark: 0`. With the default of 1, the stream pulls once before anyone reads, and the test counts a chunk the Worker never took
  - Unit tests in a new `test/worker/bodyLimit.test.ts`, whose first import is `../compiler/helpers/noNetwork` (Exploration cases 1 to 5 in design):
    - Repro 1, declared, small body: `Content-Length: 94371840` with `compileBody(150)` and one reply step
    - Repro 1, declared, 90 MB: the same header with `countingBody(repeated(65536, 1440))`
    - Repro 1, streamed: no `Content-Length` and the same body. Expect 5 chunks taken and 1 cancel
    - The header values `abc`, `-1`, `1e3`, `12.5`, `''`, `12, 12` and `3` with the same body. Expect 5 and 1
    - `countingBody(repeated(65536, 5), { errorAfter: 5 })` with no header. Expect 400 with `calls: []` and no `thrown`
    - With Access on (`REQUIRE_ACCESS: 'true'` and a token from `test/worker/helpers/accessKeys.ts`), the right path and no `Content-Length`: 400 with 5 taken, 1 cancel and the store unchanged (design "Integration Tests")
  - Property tests in a new `test/worker/bodyLimit.property.test.ts`, each with the comment `Feature: worker-body-limit-and-model-error-log-fix, Property 1: Over-limit bodies are turned away without being held`:
    - At MAX through `handle` (50 runs): totals from MAX + 1 to MAX + 200,000, random cuts, a `Content-Length` that is missing, not a declared length, or at most MAX, and an optional error after the last chunk
    - Declared above MAX (100 runs): digit strings above MAX with optional leading zeros, up to 30 digits, with no body, an empty body, a valid `compileBody`, a Counting_Body of up to 1,440 chunks, or one that errors at once
  - Import only what exists on the unfixed code (`handle`, `MAX_BODY_BYTES`, `Deps`). `declaredLength` and `readLimitedBody` do not exist yet. Their direct tests come in task 5.2
  - Run on UNFIXED code, without markers: `npx vitest --run test/worker/bodyLimit.test.ts test/worker/bodyLimit.property.test.ts`
  - **EXPECTED OUTCOME**: Every new test FAILS (this is correct, it proves the bug exists). The counterexamples the design observed at `80c9e62`:
    - The declared small body gets 200, with one `take` and one Model_Call
    - The declared and the streamed 90 MB bodies have all 1,440 chunks taken and no cancel, for every header value
    - The stream that errors after passing MAX gets 502 with `thrown: 'RangeError'`
  - Check that each test fails on the assertion the design predicts, not on a helper error. Document the counterexamples, and whether they match root causes 1 to 3 in design (a full read before the check, `Content-Length` never read, no capped read in the Fetch API)
  - Then mark each new test `it.fails` with the comment `// fails until task 5.1 fixes bug 1`, so the PreTaskExec gate lets task 2 start
  - Run `npx vitest --run` and `npm run typecheck`. Both pass, and the suite still finishes well inside the gate's 180-second timeout, since these tests now run on the unfixed code before every task
  - Mark the task complete when the tests are written and run, the failures are documented, and the suite is green with the markers
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests for Bug 1 (BEFORE implementing the fix)
  - **Property 2: Preservation** - Requests within the limit are read, decoded and answered as before
  - **IMPORTANT**: Follow observation-first methodology. Run the unfixed `handle` on requests where `isBodyBug` is false, record what it returns, and assert that
  - Non-bug condition: `NOT isBodyBug(R)`. Either the request fails the Access or route check, or its media type is not `application/json`, or its declared length is missing, not a declared length, or at most MAX and its body delivers at most MAX bytes, whether that body is valid, broken or erroring
  - Add `referenceAnswer(bytes)` to `test/worker/helpers/bodies.ts`. It restates the original check in the test: more than MAX bytes, a failed strict decode, a failed `JSON.parse`, or a null from `readCompileRequest` gives 400; otherwise the request passes
  - Observe on UNFIXED code, then pin as unit tests in `test/worker/bodyLimit.test.ts` (Preservation cases 2 to 6 in design). Each asserts the exact response, the exact log line, the `take` calls, the Model_Calls and, where a Counting_Body is used, `taken()`, `cancels()` and `bodyUsed`:
    - `Content-Length: 262144` with a valid body of exactly 262,144 bytes gets 200, in one chunk and in four chunks of 65,536 bytes (3.2). The existing 256 KiB test in `handle.test.ts` stays as it is (3.3)
    - `Content-Length: 3` with a valid body of a few hundred bytes gets 200 (3.4)
    - `abc`, `-1`, `1e3`, `12.5`, `''`, `12, 12` and `+5`, each with a valid small body, get 200 (3.5)
    - No body, `''`, an empty Counting_Body and `Content-Length: 0` get 400 (3.6)
    - `text/plain` and no `Content-Type`, each with `Content-Length: 94371840` and a Counting_Body, get 400 with `taken() === 0` and `bodyUsed` false (3.7)
    - With Access on, `Content-Length: 94371840` and a Counting_Body: no token gets 401 and path `/api/other` gets 404, each with `taken() === 0` and the store unchanged (3.11)
    - `countingBody(repeated(1000, 3), { errorAfter: 3 })` gets 502 `model` with `thrown: 'RangeError'`, `calls: []`, no `take` and no Model_Call (3.10)
  - Property test in `test/worker/bodyLimit.property.test.ts`, Property 2 chunking through `handle` (100 runs), with the comment `Feature: worker-body-limit-and-model-error-log-fix, Property 2: Requests within the limit are read, decoded and answered as before`:
    - n from 1 to MAX, with cases near MAX weighted up; `compileBody(n, { multiByte: true })` or random bytes of length n; random cuts; a `Content-Length` that is not a declared length or is at most MAX
    - The answer, the log line and the `take` count equal both `referenceAnswer(bytes)` and the answer for the same bytes in one chunk. A body that passes gets 200 from one reply step (3.1, 3.8, 3.9)
  - If the unfixed `handle` disagrees with `referenceAnswer` or a pinned expectation, correct the test, not the code. The unfixed behavior is the baseline
  - Run on UNFIXED code: `npx vitest --run test/worker` and `npm run typecheck`
  - **EXPECTED OUTCOME**: The new tests PASS (this confirms the baseline behavior to preserve), the 74 existing Worker tests pass, and task 1's tests still fail inside their `it.fails` markers
  - Mark the task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.16_

- [x] 3. Write bug condition exploration tests for Bug 2 (model error log)
  - **Property 3: Bug Condition** - A failed SDK call writes one failure entry and rejects with the same error
  - **CRITICAL**: These tests MUST FAIL on unfixed code. The failures confirm the bug exists
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior. They will validate the fix when they pass after task 6.1
  - **GOAL**: Surface counterexamples where the SDK call rejects and the Ask leaves no record of the status, the type or the class
  - **Scoped PBT Approach**: The bug is deterministic. Pin Repro 2 and each row of the fake-response table as unit tests, and scope the property to generated SDK failures
  - Bug condition from design (`isFailureBug(A)`): `A.options.apiKey` is a non-empty string AND `client.beta.messages.create(...)` rejects with some value `e` (an API error, a network error, a timeout, or any other rejection)
  - Expected behavior from design (`expectedBehavior`, Ask branch):
    - `logs` equals exactly `[entry]`. The entry is `{ event: 'model-call-failed' }`, plus `status` when `e` is an `APIError` with a numeric status, plus `error_type` when `e` is an `APIError` whose `type` matches `/^[a-z][a-z0-9_]{0,63}$/`, plus `error_class`, which is `e.name` for an Error and `typeof e` otherwise
    - The Ask rejects with `e` itself, and `fetch` was called once
    - The serialized logs hold no message text, response body, `requestID`, `errorCode`, Sentence, Request_Name, Client_Key, API key or Access_Token
  - Create `test/worker/helpers/fakeApi.ts` with `apiFetch`, `errorBody`, `textBody`, `never`, `KEY` and `MARK`, as design "Test helpers" describes them. The network-error fake's message must not match the SDK's `/timed? ?out/i` test, or the SDK reports a timeout
  - Unit tests in a new `test/worker/askFailure.test.ts`, whose first import is `../compiler/helpers/noNetwork`:
    - One test per row of the fake-response table in design, from the 401 `authentication_error` row to the `never()` row. Each asserts with `toStrictEqual` that `logs` is exactly the expected entry
    - Each also asserts that the rejection is an instance of the SDK class imported from `@anthropic-ai/sdk`, with the expected `status` and its `requestID` still on it, and that `fetch` was called once
    - Each also asserts that `JSON.stringify(logs)` holds none of the message text, `req_LEAKCHECK`, `enforced_spend_limit_reached`, `KEY`, `MARK` or `Compile this request`
    - The timeout row uses `timeoutMs: 20` and real timers
    - Repro 2 end to end: `handle` with `makeAsk({ apiKey: KEY, fetch: <the 401 fake>, log })` and the same `log` for `handle`, as `worker/src/index.ts` wires it. Expect the 502 `{ ok: false, error: 'model' }` response and `logs` equal to exactly the failure entry followed by the request line, as design "Integration Tests" lists them. The store counted once, `fetch` was called once, and no log or response holds KEY, the Sentence, a Request_Name, the IP, the Access_Token, the request id or the API message
    - Network error and timeout end to end: the same wiring with the network fake and the timeout fake, with the same 502 and request line, preceded by `{ event: 'model-call-failed', error_class: 'APIConnectionError' }` or `{ event: 'model-call-failed', error_class: 'APIConnectionTimeoutError' }`
  - Property test in a new `test/worker/askFailure.property.test.ts`, Property 3 through the real SDK (200 runs), with the comment `Feature: worker-body-limit-and-model-error-log-fix, Property 3: A failed SDK call writes one failure entry and rejects with the same error`:
    - Any status from 400 to 599, any body as design describes (JSON with an arbitrary `type`, a marked message and optional `details.error_code`, or non-JSON marked text), and any `request-id`
    - The Ask rejects with an `APIError` whose `status` is the generated one, and `fetch` was called once
    - The expected entry is built from the generated status and type, with `error_class` set to the rejection's `name`
    - The serialized logs hold no marker, request id, error code or key
  - Use the literal `'model-call-failed'` and build every expected entry in the test. `failureEntry` and `FAILURE_EVENT` do not exist on the unfixed code. Their direct tests come in task 6.2
  - Run on UNFIXED code, without markers: `npx vitest --run test/worker/askFailure.test.ts test/worker/askFailure.property.test.ts`
  - **EXPECTED OUTCOME**: Every new test FAILS (this is correct, it proves the bug exists). The counterexamples the design observed at `80c9e62`:
    - `logs` stays `[]` for every rejection kind, while the rejection itself carries `status`, `type` and `name`
    - Through `handle`, the only log line is `{"event":"request","status":502,"error":"model","calls":[{"call":1,"result":"failed"}]}`
  - Check that each test fails on its `logs` assertion, not on a helper error or the rejection class. Document the counterexamples, and whether they match root cause 4 in design (the rejection passes through `makeAsk` unseen) and the facts ruled out in root cause 5 (one `fetch` per call, and the rejection has `status`, `type` and `name`)
  - Then mark each new test `it.fails` with the comment `// fails until task 6.1 fixes bug 2`, so the PreTaskExec gate lets task 4 start
  - Run `npx vitest --run` and `npm run typecheck`. Both pass
  - Mark the task complete when the tests are written and run, the failures are documented, and the suite is green with the markers
  - _Requirements: 1.3, 1.4, 2.3, 2.4, 2.5, 3.14_

- [~] 4. Write preservation property tests for Bug 2 (BEFORE implementing the fix)
  - **Property 4: Preservation** - Ask calls that do not fail send, log and return as before
  - **IMPORTANT**: Follow observation-first methodology. Run the unfixed Ask on calls where `isFailureBug` is false, record what it does, and assert that
  - Non-bug condition: `NOT isFailureBug(A)`. Either the key is missing or empty, or the SDK call resolves, with any stop reason including `refusal`. For a call in the bug condition, everything except the new failure entry is preserved (3.14)
  - Observe on UNFIXED code that the existing `test/worker/ask.test.ts` passes, including the refusal case and the missing-key case with `logs` empty. Leave that file unchanged
  - Unit tests in `test/worker/askFailure.test.ts`:
    - A successful call writes exactly the usage entry and nothing else (3.12)
    - After a failed call, the same Ask's next successful call writes exactly its usage entry. Compare only the entries written during the second call, so the test holds before and after the fix
    - A missing or empty key rejects with `Error('ANTHROPIC_API_KEY is not set')`, with no `fetch` call and no entry (3.13)
    - Through `handle` with the real Ask and the 401 fake: the 502 `{ ok: false, error: 'model' }` response, the store counted once, `fetch` called once, and the log entries other than those with event `model-call-failed` equal exactly `[{ event: 'request', status: 502, error: 'model', calls: [{ call: 1, result: 'failed' }] }]` (3.14)
  - Property test in `test/worker/askFailure.property.test.ts`, Property 4 mixed sequences (100 runs), with the comment `Feature: worker-body-limit-and-model-error-log-fix, Property 4: Ask calls that do not fail send, log and return as before`:
    - 1 to 6 outcomes on one Ask. Each is a success (random token counts, a stop reason among `end_turn`, `max_tokens` and `refusal`, with or without a `fallback_message` iteration) or a failure (a random row of the fake-response table)
    - For each success, the entries written during that call are exactly the usage entry the test builds from the generated response, and the call returns the Model_Reply that `toModelReply` gives
    - For each failure, the call rejects with the row's SDK class and writes no entry other than ones whose event is `model-call-failed`
    - `fetch` is called once per call, and the recorded request bodies equal `requestBody(input)` (3.15)
    - The failure entries themselves belong to Property 3. Task 6.2 adds the check that each failure writes exactly `[failureEntry(rejection)]`
  - Run on UNFIXED code: `npx vitest --run test/worker` and `npm run typecheck`
  - **EXPECTED OUTCOME**: The new tests PASS (this confirms the baseline behavior to preserve), the existing Worker tests pass, and the tests of tasks 1 and 3 still fail inside their `it.fails` markers
  - Mark the task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.12, 3.13, 3.14, 3.15, 3.16_

- [ ] 5. Fix Bug 1: cap the body read in `worker/src/handle.ts`

  - [~] 5.1 Implement the capped read, and switch the one permitted test fake in the same change
    - In `readRequest`, keep the media type check first (3.7). After it, read `declaredLength(request.headers.get('Content-Length'))` and return null when it is above `MAX_BODY_BYTES`, with the comment from design. Take no reader and do not cancel the unread body
    - Add the exported `declaredLength(value: string | null): number | null`: `Number(value)` when `value` matches `/^[0-9]+$/`, otherwise null
    - Replace `await request.arrayBuffer()` and its length check (lines 73 and 74) with `const bytes = await readLimitedBody(request.body, MAX_BODY_BYTES); if (!bytes) return null;`
    - Add the exported `readLimitedBody(body, limit)` as in design "Fix Implementation", change 2:
      - A null body gives zero bytes
      - Chunks are read one at a time. When the received bytes pass the limit, call `reader.cancel().catch(() => {})` without awaiting it and return null
      - Otherwise concatenate the chunks into one `Uint8Array`
      - No `try`: a stream that errors makes `reader.read()` reject with its own error, which reaches `handle`'s `catch` (3.10)
    - Keep the decode as it is: one strict `new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })` call over the concatenated bytes (3.8, 3.9)
    - Add the sentence from design to the doc comment of `readRequest`
    - In the same change, edit the test "answers 502 model when reading the body fails" in `test/worker/handle.test.ts`. Replace the Proxy's `arrayBuffer` fake (lines 310 to 316) with the erroring `body` stream from design "Fix Implementation". Lines 317 and 318, the 502 response and the log line with `thrown: 'RangeError'`, stay exactly as they are
    - This is the only edit to an existing test, and it must land with the `readRequest` change. On the unfixed code the edited test fails, and on the fixed code the old fake fakes nothing
    - Remove the `it.fails` markers and their comments from task 1's tests, and change nothing else in them. Leave task 3's markers in place
    - Do not change `worker/src/index.ts`, `http.ts`, `access.ts`, `limits.ts`, `wrangler.toml`, `src/compiler`, `src/hypertalk` or `src/ui`
    - Done when `npx vitest --run` and `npm run typecheck` pass
    - _Bug_Condition: isBodyBug(R) from design: a JSON request whose declared length is above MAX, or whose body delivers more than MAX bytes_
    - _Expected_Behavior: expectedBehavior(R, result) from design, request branch: 400 bad-request with no take and no Model_Call; 0 chunks taken and bodyUsed false for a declared length above MAX; otherwise the chunk that passes MAX is the last one taken, and the reader is cancelled once_
    - _Preservation: Preservation Requirements from design (3.1 to 3.11): the order of checks, the strict decode, empty bodies, odd Content-Length values, bodies at exactly MAX, streams that error within the limit, and 401 or 404 before the body_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [~] 5.2 Write the direct tests of `declaredLength` and `readLimitedBody`
    - These tests call the new exports, so they could not be written before 5.1
    - `test/worker/bodyLimit.test.ts`, `declaredLength`: `'0'`, `'262144'` and `'000262145'` give numbers, and `'9'.repeat(400)` gives a number above MAX. `null`, `''`, `'abc'`, `'-1'`, `'+5'`, `'1e3'`, `'12.5'`, `'12, 12'`, `'0x10'` and `'１２'` (full-width) give null
    - `test/worker/bodyLimit.test.ts`, `readLimitedBody`, the cases in design "Unit Tests":
      - `null` gives zero bytes, and an empty stream gives zero bytes
      - Chunks totalling exactly the limit give their concatenation, with every chunk taken and no cancel
      - One byte more gives null, with the crossing chunk the last one taken and one cancel
      - A single chunk larger than the limit gives null after one chunk
      - An erroring stream rejects with the same RangeError object
      - A source whose `cancel` throws still gives null and leaves no unhandled rejection
    - `test/worker/bodyLimit.property.test.ts`, each with its property comment:
      - Property 1, small limits (500 runs): any limit from 0 to 64 and 0 to 12 chunks of 0 to 20 bytes whose total is above the limit. Null, `taken()` equal to the least k whose prefix passes the limit, `cancels()` equal to 1, and `taken()` unchanged after a microtask flush
      - Property 2, small limits (500 runs): chunks whose total is at most the limit give exactly their concatenation, with every chunk taken and no cancel
      - Property 2, `declaredLength` (1,000 runs): for strings mixing digit strings, printable ASCII and full-width digits, the result equals `/^[0-9]+$/.test(s) ? Number(s) : null`
    - Run `npx vitest --run test/worker` and `npm run typecheck`
    - _Requirements: 2.1, 2.2, 3.4, 3.5, 3.6, 3.9_

  - [~] 5.3 Verify the Bug 1 exploration tests now pass
    - **Property 1: Expected Behavior** - Over-limit bodies are turned away without being held
    - **IMPORTANT**: Re-run the SAME tests from task 1. Do NOT write new tests
    - The tests from task 1 encode the expected behavior. When they pass, the expected behavior is satisfied
    - Run `npx vitest --run test/worker/bodyLimit.test.ts test/worker/bodyLimit.property.test.ts`
    - Check against task 1's commit that the bodies of task 1's tests are unchanged apart from the removed markers
    - **EXPECTED OUTCOME**: The task 1 tests PASS (confirms Bug 1 is fixed)
    - _Requirements: 2.1, 2.2_

  - [~] 5.4 Verify the Bug 1 preservation tests still pass
    - **Property 2: Preservation** - Requests within the limit are read, decoded and answered as before
    - **IMPORTANT**: Re-run the SAME tests from task 2. Do NOT write new tests
    - Run `npx vitest --run test/worker`. This covers task 2's tests and the existing `handle.test.ts`, including the 256 KiB test (3.3) and the edited body-failure test (3.10)
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions). Task 3's tests still fail inside their `it.fails` markers, which shows the Bug 1 fix left the Ask alone
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

- [ ] 6. Fix Bug 2: log a failed SDK call in `worker/src/ask.ts`

  - [~] 6.1 Implement the failure entry
    - Line 3 becomes `import Anthropic, { APIError, type ClientOptions } from '@anthropic-ai/sdk';`
    - Add the exported `FAILURE_EVENT = 'model-call-failed'` with its doc comment from design
    - In `makeAsk`, keep the key check and the client construction outside any `try` (3.13). Compute `const body = requestBody(input);` on the line before the SDK call, and wrap only `client.beta.messages.create(body)`. On a rejection, call `options.log(failureEntry(error))`, then `throw error`, the same object (3.14). `usageEntry` and `toModelReply` stay after the `try` (3.12)
    - Add `API_ERROR_TYPE = /^[a-z][a-z0-9_]{0,63}$/` and the exported `failureEntry(error: unknown)` as in design "Fix Implementation", change 3:
      - `status` only for an `APIError` with a numeric `status`
      - `error_type` only for an `APIError` whose `type` is a string that passes `API_ERROR_TYPE`
      - `error_class` from `error.name` for an Error, and `typeof error` otherwise
      - A missing field is left out, not set to `undefined`
      - Never read `message`, `apiMessage`, `error`, `details`, `headers`, `requestID`, `workspaceID`, `errorCode` or `cause`
    - Add the sentence from design to the doc comment of `makeAsk`
    - Remove the `it.fails` markers and their comments from task 3's tests, and change nothing else in them
    - Done when `npx vitest --run` and `npm run typecheck` pass
    - _Bug_Condition: isFailureBug(A) from design: the key check passed and the SDK call rejects with some value e_
    - _Expected_Behavior: expectedBehavior(A, result) from design, Ask branch: logs equal exactly [failure entry built from e], the Ask rejects with e itself, one fetch call, and no message, body, requestID, errorCode, Sentence, name, Client_Key, API key or Access_Token in the logs_
    - _Preservation: Preservation Requirements from design (3.12 to 3.15): the same request, the same usage entry on success, the missing-key rejection before any client with no entry, the same rejection object, and one fetch per call_
    - _Requirements: 2.3, 2.4, 2.5, 3.12, 3.13, 3.14, 3.15_

  - [~] 6.2 Write the direct tests of `failureEntry` and the full mixed sequence
    - These tests call the new export, so they could not be written before 6.1
    - `test/worker/askFailure.test.ts`, `failureEntry`, the cases in design "Unit Tests":
      - `'boom'` gives `{ event, error_class: 'string' }`
      - `undefined` gives `'undefined'`, and `null` gives `'object'`
      - `{ status: 401, type: 'authentication_error', message: MARK }` gives `{ event, error_class: 'object' }`, because only an APIError's fields are read
      - `new Error(MARK)` gives `{ event, error_class: 'Error' }`
    - `test/worker/askFailure.property.test.ts`, Property 3, any rejection value (1,000 runs), with its property comment:
      - Values from `fc.anything()`, Errors with arbitrary messages, and SDK errors built directly as design describes (`APIError`, `AuthenticationError`, `APIConnectionError`, `APIConnectionTimeoutError` with arbitrary status, `type`, message, details and headers)
      - `failureEntry` never throws, and its keys are a subset of `event`, `status`, `error_type` and `error_class`
      - `status` is present exactly for a numeric APIError status. `error_type` is present exactly when the type passes the Identifier_Rule. `error_class` is the name or `typeof`
      - `JSON.stringify(entry)` never contains the generated message, which carries a `Leak-Marker-` prefix
    - `test/worker/askFailure.property.test.ts`, Property 4, mixed sequences with failure entries (100 runs): a new test on the same generator as task 4's. The whole `logs` holds one entry per call, the usage entry for a success and `failureEntry(rejection)` for a failure, which covers the client being reused after a failure. Leave task 4's test as it is
    - Run `npx vitest --run test/worker` and `npm run typecheck`
    - _Requirements: 2.3, 2.4, 2.5, 3.12, 3.14, 3.15_

  - [~] 6.3 Verify the Bug 2 exploration tests now pass
    - **Property 3: Expected Behavior** - A failed SDK call writes one failure entry and rejects with the same error
    - **IMPORTANT**: Re-run the SAME tests from task 3. Do NOT write new tests
    - The tests from task 3 encode the expected behavior. When they pass, the expected behavior is satisfied
    - Run `npx vitest --run test/worker/askFailure.test.ts test/worker/askFailure.property.test.ts`
    - Check against task 3's commit that the bodies of task 3's tests are unchanged apart from the removed markers
    - **EXPECTED OUTCOME**: The task 3 tests PASS (confirms Bug 2 is fixed)
    - _Requirements: 2.3, 2.4, 2.5_

  - [~] 6.4 Verify the Bug 2 preservation tests still pass
    - **Property 4: Preservation** - Ask calls that do not fail send, log and return as before
    - **IMPORTANT**: Re-run the SAME tests from task 4. Do NOT write new tests
    - Run `npx vitest --run test/worker`. This covers task 4's tests, the unchanged `test/worker/ask.test.ts` (3.12, 3.13, 3.15), and the Bug 1 tests of tasks 1, 2 and 5.2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.12, 3.13, 3.14, 3.15, 3.16_

- [~] 7. Update the sentence-compiler design to match the fixed Worker
  - Edit only `.kiro/specs/sentence-compiler/design.md`, and in it only the parts listed below. Do not change that spec's `requirements.md` or `tasks.md`, any code or any test. Do not rewrite other sections
  - In this task, quoted section names refer to the sentence-compiler design.md, not to this spec's design
  - Read the fixed `worker/src/handle.ts` and `worker/src/ask.ts` first, and describe what they do. Where the code and this spec's design differ, follow the code
  - Keep that design's style and terms: short plain sentences, the Worker's own names (Compile_Route, Model_Call, Client_Key, "the sentence, the names, the Client_Key or the token"), and references written as `Requirement 2.2` to its own requirements.md (SC 2.2 here). Cite no numbers from this bugfix spec
  - Leave the code blocks of both sections as they are. They list only the main interface and already leave out exports such as `COMPILE_PATH` and `requestBody`. The prose names `declaredLength`, `readLimitedBody` and `failureEntry` where it describes them, as it names `readCompileRequest`
  - "worker/src/handle.ts", step 4 (**Request.**): rewrite it so it gives the checks of `readRequest` in this order:
    - The media type of `Content-Type`, worded as today and still first
    - The declared length: when `Content-Length` is one or more ASCII digits and nothing else, and its value is above `MAX_BODY_BYTES`, the request is a bad request. The body is neither read nor cancelled. Any other `Content-Length`, or none, is ignored
    - Otherwise the body is read chunk by chunk. Once more than `MAX_BODY_BYTES` have arrived, the reader is cancelled, no further chunk is taken, and the request is a bad request. No body counts as zero bytes
    - The joined bytes are decoded as strict UTF-8, so invalid UTF-8 is a bad request too. Then `JSON.parse` runs (a failure is a bad request), and then `readCompileRequest`, as today
    - A body stream that errors makes the read throw, and step 3 turns that into 502 `model` with the error's name only (Requirement 1.5)
  - "worker/src/handle.ts": add one sentence to step 4 saying that every bad request returns before `limiter.take` in step 5, so it is not counted and makes no Model_Call (Requirement 2.7). Steps 1 to 3, 5 and 6 and the closing log paragraph stay as they are
  - "worker/src/ask.ts", last paragraph: keep "Any API error, network error or timeout rejects the promise (Requirement 7.10)" and the sentence on the usage log. Add:
    - Only the SDK call is wrapped. The key check, the client and the request body stay outside it, so a missing key still rejects before any client exists and writes no entry
    - When the SDK call rejects, the ask logs one entry `{ event: 'model-call-failed', status?, error_type?, error_class }` through `failureEntry`, then rejects with the same error
    - `status` is there only for an API error with an HTTP status. `error_type` is there only when the API error type is a lowercase identifier (`/^[a-z][a-z0-9_]{0,63}$/`). `error_class` is the error's `name`, or `typeof` for a value that is not an Error
    - The entry holds no message text, no sentence, no names, no IP, no API key, no token, no `requestID` and no `errorCode` (Requirement 11.2). The SDK puts the raw response body in `message`, which is why it stays out
  - Elsewhere in that design, change only the "Error Handling" row "Wrong Content-Type, body over 256 KiB, …", so it also names a declared `Content-Length` over 256 KiB. A request that declares more and sends a small body is now a bad request
  - These other passages on the body read or the model-call logs still match the fixed code and stay as they are: the size-check sentence of "contract.ts", the closing log paragraph of "worker/src/handle.ts", the `console.log` paragraph of "worker/src/index.ts and wrangler.toml", the per-call token log in "Cost and limits of the platform", the log bullets in "Decisions", and the `handle.test.ts` and `ask.test.ts` entries in "Example tests". The new test files belong to this bugfix spec and are not added to that list
  - Check the result:
    - `grep -n "arrayBuffer\|byteLength" .kiro/specs/sentence-compiler/design.md` finds nothing
    - Each sentence of the edited step 4 and the edited paragraph matches the fixed code
    - `git diff -- .kiro/specs/sentence-compiler/` shows changes only in `design.md`, and only in step 4 of "worker/src/handle.ts", the last paragraph of "worker/src/ask.ts" and the one "Error Handling" row
  - Run the format check (`validate_spec_format`) on `.kiro/specs/sentence-compiler/design.md` when the tool is available. Before this task it reports one warning, at line 513, for a property in "Correctness Properties" without a Validates line. That section is not touched, though the line number may shift. The edit adds no error and no new warning
  - This task changes no code and no test. `npx vitest --run` and `npm run typecheck` still pass
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.7, 3.10, 3.13_

- [~] 8. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. The `typecheck` script in `package.json` runs `tsc --noEmit` for `tsconfig.json`, `tsconfig.test.json`, `tsconfig.ui.json` and `tsconfig.worker.json`. Both commands must pass
  - The 74 existing Worker tests pass, and `test/compiler/scan.test.ts` sees every new `*.test.ts` under `test/worker` import `../compiler/helpers/noNetwork` first (3.16)
  - No `it.fails` marker is left under `test/worker`
  - The PostTaskExec hook commits after every task, so `git status` alone shows little. Check with `git diff --name-only 80c9e62..HEAD` plus `git status`:
    - Code changes are only `worker/src/handle.ts`, `worker/src/ask.ts` and files under `test/worker`
    - Other changes are only `.kiro/specs/sentence-compiler/design.md` (task 7), files under `.kiro/specs/worker-body-limit-and-model-error-log-fix/`, and the hook's entries in `docs/kiro-log.md`
    - Nothing under `src/compiler`, `src/hypertalk` or `src/ui` changed, and `.kiro/specs/sentence-compiler/requirements.md` and `.kiro/specs/sentence-compiler/tasks.md` are unchanged
  - `git diff 80c9e62 --` on the existing files under `test/worker` (`access.test.ts`, `ask.test.ts`, `config.test.ts`, `handle.test.ts`, `limits.test.ts`, `helpers/accessKeys.ts`, `helpers/memoryStore.ts`) shows only the Proxy change in "answers 502 model when reading the body fails"
  - Ensure all tests pass, ask the user if questions arise

## Notes

- No sub-task is optional. The design lists the direct tests of the new functions as part of the fix, so 5.2 and 6.2 are required.
- Properties 1 and 3 are the bug conditions of Bug 1 and Bug 2, and Properties 2 and 4 are their preservation properties, numbered as in design.md. Each bug has its own exploration task, preservation task and fix task, so each can be verified on its own.
- All four test tasks run before either fix, so every exploration and preservation test is observed on the unfixed code at `80c9e62`.
- The `it.fails` markers keep the suite green for the PreTaskExec gate while the exploration tests still fail. A marked test that starts to pass turns the suite red, which flags a fix that landed too early. The markers come off only in 5.1 and 6.1, together with the code change that makes the tests pass.
- Direct tests of `declaredLength`, `readLimitedBody` and `failureEntry` cannot be written before the fix, because the exports do not exist yet and `tsconfig.test.json` type-checks `test/worker`. So tasks 1 to 4 go through `handle` and `makeAsk` only, and use the literal `'model-call-failed'`.
- Design's Property 4 mixed-sequence test asserts the failure entries, which do not exist on the unfixed code. Task 4 writes the part that holds before and after the fix, and task 6.2 adds the check of the failure entries.
- The edit to "answers 502 model when reading the body fails" lands in 5.1 with the `readRequest` change, because the edited test fails on the unfixed code and the old fake fakes nothing on the fixed code.
- The sentence-compiler design's "worker/src/handle.ts" and "worker/src/ask.ts" sections describe the unfixed code. Task 7 updates them after both fixes have landed, so it describes the code as it is. That design is the only file outside `worker/src`, `test/worker` and this spec that changes.
