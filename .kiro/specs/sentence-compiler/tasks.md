# Implementation Plan: sentence compiler

## Overview

The work goes from the inside out. First the packages and type-check setup. Then the pure compiler in `src/compiler`: contract, names, schema, the reference walk, the rule checker, the prompt and the retry loop, each with its example tests. Then the three properties. Last the Worker in `worker/`: limits, Access, the real ask, the request handler, and the entry point with `wrangler.toml`. Nothing changes in `src/hypertalk`, `test/hypertalk` or `src/ui` (Requirement 12.5). Deployment is not a task.

Each top-level task ends with `npx vitest --run` and `npm run typecheck` passing. Requirement numbers (4.8, 10.7) refer to this spec's requirements.md. Section names in quotes ("rules.ts") refer to its design.md.

## Tasks

- [x] 1. Packages, type check and the no-network helper
  - `package.json`: add `@anthropic-ai/sdk` (^1.12.0) and `jose` (^6.2.0) to `dependencies` and `@cloudflare/workers-types` to `devDependencies`. Run `npm install` so `package-lock.json` follows.
  - `tsconfig.json`: add `src/compiler/**/*.ts` to `include`, keeping `lib: ["ES2022"]` and `types: []`.
  - `tsconfig.test.json`: add `src/compiler/**/*.ts`, `test/compiler/**/*.ts` and `test/worker/**/*.ts` to `include`.
  - New `tsconfig.worker.json`: extends `tsconfig.json`, sets `types: ["@cloudflare/workers-types"]`, and includes `worker/src/**/*.ts`, `src/compiler/**/*.ts` and `src/hypertalk/**/*.ts`. The `typecheck` script gains `&& tsc -p tsconfig.worker.json --noEmit`.
  - New `test/compiler/helpers/noNetwork.ts`: on import, stubs `fetch`, `XMLHttpRequest` and `WebSocket` with `vi.stubGlobal`, using functions that throw an error naming the global. Every later compiler and Worker test file imports it first.
  - Done when the suite and the type check pass. The Worker config already checks `src/hypertalk` under the Workers types. If those types clash with anything there, stop and report.
  - _Requirements: 12.1, 12.6, 14.10_

- [x] 2. Contract, names and the reply schema
  - [x] 2.1 Write `src/compiler/contract.ts` and `src/compiler/model.ts`
    - `CompileRequest` and `CompileResponse` copied exactly from requirements.md. `CompileOutcome`, `REQUEST_LIMITS` and `readCompileRequest`, as "contract.ts" describes: a non-array object, field types, sentence 1 to 500 code units with a `/\S/` character, at most 100 names per list, at most 100 code units per name, empty strings allowed, new arrays, unknown fields dropped.
    - `Message`, `ModelInput`, `ModelReply`, `Ask` and `CallEvent`, as "model.ts" describes. `CallEvent` uses the `RuleNumber` type, which can live here, or in `rules.ts` with a type-only import.
    - _Requirements: 1.2, 2.2, 2.3, 2.4, 2.5, 2.6, 12.3_
  - [x] 2.2 Write `src/compiler/names.ts`
    - `sameName`, `findSameName` (an empty entry never matches), `looksNumeric` (the R11.4 pattern), `isAsciiText`, `englishNameProblems` with the exact wording and order of "names.ts", and `quote` (`JSON.stringify` after cutting to 80 code units plus `…`).
    - _Requirements: 4.4, 4.7, 4.9, 4.12_
  - [x] 2.3 Write `src/compiler/schema.ts`
    - `REPLY_SCHEMA` exactly as "schema.ts" gives it: five required properties in that order, `additionalProperties: false`, no length, pattern or union keywords, and no reasoning field.
    - `ReplyObject` and `readReplyObject(text)`: `null` unless `JSON.parse` succeeds and gives a non-array object whose keys are exactly the five fields, each of its type.
    - _Requirements: 4.10, 6.7, 7.2_
  - [x] 2.4 Write `test/compiler/contract.test.ts` and `test/compiler/names.test.ts`
    - Contract: `expectTypeOf` pins `CompileRequest`, `CompileResponse` and `CompileOutcome` to the contract. `readCompileRequest` cases: each wrong type and missing field, an array body, sentences of 0, 1, 500 and 501 code units, a sentence of spaces, one of tabs and newlines, and one of U+3000, lists of 100 and 101 names, names of 100 and 101 code units, empty strings accepted, and an unknown field dropped from the result.
    - Names: each part of `englishNameProblems`, alone and combined; `sameName` and `findSameName` with case and empty entries; `quote` at 80 and 81 code units. `looksNumeric` agrees with `looksNumeric` from `src/hypertalk/values.ts` on a fixed list (`"3"`, `" 007 "`, `"-5"`, `"2.5"`, `"- 5"`, `"+1"`, `".5"`, `"3."`, `"1e3"`, `""`) and on 1,000 strings from a fixed-seed fast-check sample.
    - `readReplyObject`: valid objects of both kinds; `null` for text that is not JSON, an array, a missing field, an extra field and a wrong type.
    - _Requirements: 1.2, 2.2, 2.3, 2.4, 2.5, 2.6, 4.10, 14.6_

- [-] 3. The rule checker
  - [x] 3.1 Write `src/compiler/references.ts`
    - `collectReferences(script)` as "references.ts" describes. It visits every handler with a fresh state (first `go` line, first `go to stack` line). An `if` visits its condition with the incoming state, walks both branches from that state, and merges by taking the smaller line that is set. A `go` visits its target before the move. Field and button references come from `put … field`, `show`, `hide` and every `field` expression node.
    - Literal_Targets with `paren` removed: `str`, `num`, `bool`. Card targets become `cardNumber` (`num`, or `str` with `looksNumeric`, value `Number(value)`) or `cardName`. Stack text: the string, `String(n)`, or `true`/`false`.
    - Uses only the AST types and positions from the Public_API.
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.8_
  - [ ] 3.2 Write `src/compiler/rules.ts`
    - `RuleNumber`, `RULES` with the ten sentences of the design's table, word for word, plus `RuleReport`, `Accepted`, `CheckResult` and `checkReply(request, text)`.
    - The five stages of "rules.ts". Stage 1: `null` from `readReplyObject` gives the one Rule 10 shape report. Stage 2: the Nothing_Reply checks give Rule 10 reports and stop, and otherwise Rule 9 runs. Stage 3: Rules 7 and 9, and the parts of Rule 4 that need no parse. Stage 4: `parse`, where a failure gives the Rule 1 report and stops. Stage 5: Rule 2, then Rules 3, 4 (used), 5, 6 and 8 over every handler.
    - Report details exactly as the design's table gives them. Rule 1: `Line <l>, column <c>: <message>. The line is <quote(line text)>.`, with line `l` of the script read with `\r\n` as `\n`. Rule 3's maximum is `cardNames.length + newCards.length`. Rule 8 names the line of the first `go` (or `go to stack`) on some path before the reference.
    - Reports sorted by rule number, keeping their order within a rule. An accepted reply returns the reply's own values, unchanged.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 3.7_
  - [ ] 3.3 Write `test/compiler/helpers/fixtures.ts` and `test/compiler/rules.test.ts`
    - Fixtures: `hallRequest` as "Helpers" lists it, and `gateRequest` and `atticRequest` for the prompt examples, each with its names written out as literals. The file does not read `src/ui/stacks.json`. It also holds `replyText(fields)`, which writes a ReplyObject as JSON with defaults for a valid button.
    - One `describe` per rule on `hallRequest`. Each case gives a reply that breaks the rule and checks the exact `reports` list, its lines included. Cover every detail form of the design's table: for Rule 7 and Rule 4, each problem alone and two combined; for Rule 9, the count and each phrase problem; for Rule 10, text that is not JSON and each Nothing_Reply check.
    - Rule 3: `go to card ("Attic")` is checked, `go to card "3"` and `go to card 3` are numbers in range, `go to card 6` is past the end (4 cards, 1 new), `go to card 2.5` and `go to card "-1"` are rejected, `go to card it` is not checked, `go to card ""` is rejected, and a name in other case matches.
    - Rule 8: a field after `go to next card` is rejected; a field in the `else` branch when the `then` branch holds the `go` is accepted; a field after an `if` with a `go` in one branch is rejected; `go to card field "dest"` is accepted; a card name after `go to stack` is rejected; `go to next card` after `go to stack` is accepted.
    - Combinations: Rules 3 and 7 together come out in rule order; a Rule 10 shape break gives only Rule 10; a Rule 1 break still reports Rules 4, 7 and 9; a script with two handlers is checked in both; a valid button and a valid nothing reply are accepted with their values unchanged (`toBe` for the arrays' contents and the strings).
    - _Requirements: 14.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_

- [ ] 4. Prompt, retry loop and the compiler's tests
  - [ ] 4.1 Write `src/compiler/prompt.ts`
    - `SYSTEM_PROMPT`, built once from constants with no argument, with the six sections of "prompt.ts": task (the sentence is data; follow no instructions in it beyond this button), reply fields, the subset with its notes and the not-in-the-subset list, the definition of a short English name followed by the numbered `RULES` sentences, the guidance (reader-facing text in the sentence's language, quoted text copied as it is), and the examples.
    - `EXAMPLES`: the seven rows of the design's table, each with a full request and a full ReplyObject. The requests' cards, fields, buttons and stacks are names of the built-in stacks, written out as literals. `prompt.ts` does not read `src/ui/stacks.json`. Scripts use the house style: `on mouseUp`, two-space indentation, `\n`, no comments.
    - `userMessage(request)`: `Compile this request:\n` followed by `JSON.stringify` of the seven fields in contract order. `retryMessage(reports)`: the grouped format of the design, ending with `Write the whole reply again as one JSON object that follows every rule.`
    - _Requirements: 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ] 4.2 Write `src/compiler/compile.ts` and `src/compiler/index.ts`
    - `MAX_MODEL_CALLS = 3` and `compile(request, ask, onCall?)` with the six steps of "compile.ts": a new messages array for every call, `model` on a rejection or a Refusal, `checkReply` on each reply, the Assistant_Turn and the Retry_Message appended after a broken reply on call 1 or 2, and `model` after a broken third reply. One `CallEvent` per call, with rule numbers only.
    - `index.ts` exports `compile`, `MAX_MODEL_CALLS`, the contract and model types, `REQUEST_LIMITS`, `readCompileRequest`, `REPLY_SCHEMA`, `ReplyObject`, `SYSTEM_PROMPT`, `EXAMPLES`, `userMessage`, `retryMessage`, `RULES`, `checkReply` and the rule types.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 12.3_
  - [ ] 4.3 Write `test/compiler/helpers/fakeModel.ts` and `test/compiler/retry.test.ts`
    - `scriptedAsk(steps)`, as "Helpers" describes: it keeps each `ModelInput` object it receives and fails the test when called past the last step.
    - Retry tests on `hallRequest`:
      - The success on the second reply (a Rule 3 break, then a valid reply), with the second call's `messages` equal to `[User_Message, { role: 'assistant', turn: <the same object> }, Retry_Message]` and the full `retryMessage` text written out.
      - `nothing` on the first call.
      - `model` after three broken replies (3 calls), after a Refusal on call 2 (2 calls), and after a rejected call 1 (1 call).
      - The `system` and `schema` of every call identical, and each call's messages starting with the previous call's.
      - The `CallEvent`s of each case.
    - _Requirements: 14.2, 14.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
  - [ ] 4.4 Write `test/compiler/prompt.test.ts`
    - `SYSTEM_PROMPT` is the same string after `userMessage` runs for two different requests, and contains neither request's sentence. It contains every `RULES` sentence and the words of every `HAUNTS` entry (imported from `src/hypertalk/tokens.ts`).
    - Every `EXAMPLES` reply passes `checkReply` against its own request, and every example script parses. The examples include CJK characters in a sentence, a non-empty skipped list, a non-empty newCards list, and a Nothing_Reply.
    - `userMessage` holds every field of a request, in contract order. `REPLY_SCHEMA` uses only `type`, `properties`, `items`, `required`, `additionalProperties` and `description`.
    - _Requirements: 14.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
  - [ ] 4.5 Write `test/compiler/scan.test.ts`
    - Every `.ts` file under `src/compiler`, read with the TypeScript parser, has no `bannedUses` (from `test/hypertalk/helpers/sourceScan.ts`, used as it is, not edited). Every one of its `moduleSpecifiers` is relative and stays inside `src/compiler`, or resolves to `src/hypertalk/index.ts`.
    - Every `*.test.ts` under `test/compiler` and `test/worker` (a missing folder counts as empty) imports the `noNetwork` helper.
    - _Requirements: 12.1, 12.2, 14.10_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Correctness properties
  - [ ] 6.1 Write `test/compiler/helpers/arbitraries.ts` and the generator cross-checks
    - `requestArb`, `validReplyArb(request)`, `brokenReplyArb(request)` with its rule tag, and `stepsArb(request)`, as "Helpers" describes. Valid scripts are trees without positions written with `print` from the Public_API: an optional part naming fields and buttons, then gos, then statements that name nothing, with at most one `go to stack` at the end of the go part. Fresh names are filtered to differ, ignoring case, from every name in the request and the reply.
    - Rule 10 breakers are only text that is not JSON, a JSON array, and a Nothing_Reply with a script or with no skipped phrase.
    - `newCardCandidateArb(cardNames)` for P3: a Button_Reply whose newCards draws from names in the list in other case, repeats in other case, `"3"`, and fresh names, each used by a `go to card` in its script.
    - Cross-checks, two example tests over a fixed seed with 1,000 samples each and no coverage thresholds: every `validReplyArb` reply passes `checkReply`, and every `brokenReplyArb` reply fails it with a report for its tagged rule.
    - _Requirements: 13.1, 13.2, 13.4_
  - [ ] 6.2 Write the P1 property in `test/compiler/safety.property.test.ts`
    - **Property 1: Safety (P1 safety)**
    - Test name starts with "P1 safety", with the comment `Feature: sentence-compiler, Property 1: Safety`. 300 runs.
    - The expected outcome comes from the step tags as the design's Property 1 describes, never from `checkReply`. Also check the number of calls, that later steps are never played, the same `system` and `schema` on every call, the messages growing only by the same `turn` object plus a message holding `Rule <n>:` for the tagged rule.
    - **Validates: Requirements 4.1 to 4.11, 5.1 to 5.8, 13.1, 13.2, 13.5**
  - [ ] 6.3 Write the P2 property in `test/compiler/faithful.property.test.ts`
    - **Property 2: Faithful (P2 faithful)**
    - Test name starts with "P2 faithful", with the comment `Feature: sentence-compiler, Property 2: Faithful`. 200 runs.
    - The valid reply sits at call 1, 2 or 3 after broken replies. The result's four values are `toStrictEqual` to the fields of `JSON.parse(reply.text)`; for a Nothing_Reply, `skipped` is.
    - **Validates: Requirements 3.1, 3.6, 3.7, 5.2, 13.3, 13.5**
  - [ ] 6.4 Write the P3 property in `test/compiler/uniquecards.property.test.ts`
    - **Property 3: Unique card names (P3 unique card names)**
    - Test name starts with "P3 unique card names", with the comment `Feature: sentence-compiler, Property 3: Unique card names`. 300 runs.
    - Card name lists unique ignoring case, with one empty name sometimes. `newCardCandidateArb`, then `compile` with a fake `ask` that plays the candidate and then refuses. When the result is `ok: true`, the existing names followed by `result.newCards` are unique, checked with the test's own `toLowerCase` set.
    - **Validates: Requirements 3.4, 4.4, 13.4, 13.5**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 8. The Worker
  - [ ] 8.1 Write `worker/src/http.ts` and `worker/src/limits.ts`, with `test/worker/limits.test.ts`
    - `http.ts`: `json(body)` with the status table and the two headers, and `notFound()` with `Not found` as `text/plain`. No CORS headers.
    - `limits.ts`: `Limits`, `TakeResult`, `CountStore`, `readLimits` (`/^\d+$/`, else 20 and 200), `clientKey` (missing header gives `unknown`; IPv4 as written; IPv6 expanded, first four groups lowercase without leading zeros, then `::/64`), and `take` with the four steps of "worker/src/limits.ts". On a new day it collects the old keys with `Array.from(store.list({ prefix: 'ip:' }), ([key]) => key)` before deleting any.
    - `test/worker/helpers/memoryStore.ts`: a `Map`-backed `CountStore` whose `list` returns sorted entries for a prefix.
    - Tests:
      - `take`: 20 passes and the 21st gets `ip`; a second IP passes until the site count is 200, then gets `site`; both reached gives `ip`; a limit of 0 rejects at once.
      - The day change: at 23:59:59.999 and at 00:00:00.000 UTC, with the old `ip:` keys gone and `day` updated.
      - `readLimits`: `"0"` and `"35"`, and the defaults for missing, `""`, `"abc"`, `"-1"`, `"2.5"`, `" 20"` and `"1e3"`.
      - `clientKey`: IPv4, full and compressed IPv6, two addresses in one /64, two /64s, and a missing header.
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.9, 14.4, 1.3, 1.4_
  - [ ] 8.2 Write `worker/src/access.ts` and `test/worker/access.test.ts`
    - `TEAM_DOMAIN`, `CERTS_URL`, `accessRequired(vars)` (`REQUIRE_ACCESS !== 'false'`), and `verifyAccess(request, aud, keys)` with `jwtVerify(token, keys, { issuer: TEAM_DOMAIN, audience: aud, algorithms: ['RS256'], requiredClaims: ['exp'] })`. It returns false for an empty `aud`, a missing header, or any thrown error.
    - `test/worker/helpers/accessKeys.ts`: an RSA key pair from `jose`'s `generateKeyPair('RS256')`, a `kid`, `createLocalJWKSet`, and `signToken(claims, options)` for tests. No `createRemoteJWKSet` in tests.
    - Tests: a valid token is accepted. Rejected: a missing header, another key's signature, a wrong `aud`, a wrong `iss`, an expired token, `nbf` in the future, no `exp`, an `alg: none` token, an empty `aud`, and a key set that throws. `accessRequired` is false only for `"false"`, and true for missing, `"true"`, `"False"` and `""`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 14.5_
  - [ ] 8.3 Write `worker/src/ask.ts` and `test/worker/ask.test.ts`
    - `MODEL`, `MAX_TOKENS = 8000`, `AskOptions` and `makeAsk(options)`, as "worker/src/ask.ts" describes.
      - A missing or empty `apiKey` makes every call reject with `Error('ANTHROPIC_API_KEY is not set')` before any SDK client exists.
      - Otherwise the client is made on the first call with `maxRetries: 0` and the timeout, and with `fetch` when given.
      - Each call sends the request body of the design: model, `max_tokens`, `thinking: { type: 'adaptive' }`, `output_config` with `effort: 'medium'` and the schema, `betas`, `fallbacks: 'default'`, the cached system block, and the messages with each Assistant_Turn unchanged.
      - The response maps to a Refusal for `stop_reason: 'refusal'`, and otherwise to a reply with the joined text and `turn: response.content`.
      - The usage log holds the model, `stop_reason`, token counts and whether a fallback ran.
    - Tests with a fake `fetch` passed in options, which records the request and returns a canned response:
      - The URL, `x-api-key`, `anthropic-beta` containing `server-side-fallback-2026-07-01`, and every body field above, including an echoed Assistant_Turn.
      - The mappings for `end_turn`, `refusal` and `max_tokens`, and for a fallback-served response whose `turn` keeps the `fallback` block.
      - A 400 and a 500 each reject after exactly one `fetch` call.
      - A missing and an empty key reject with the message and never call `fetch`.
      - The usage log holds no message text.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 14.8_
  - [ ] 8.4 Write `worker/src/handle.ts` and `test/worker/handle.test.ts`
    - `WorkerVars`, `Deps`, `MAX_BODY_BYTES` and `handle(request, deps)` with the six steps of "worker/src/handle.ts".
      - Access, then the route, then everything else inside one `try`. A throw gives 502 `model`, and the log gets the error name only.
      - The Content-Type media type check, then `await request.arrayBuffer()` with a `byteLength` check, then fatal UTF-8 decoding, `JSON.parse` and `readCompileRequest`.
      - Then `limiter.take(clientKey(...))`, where a throw gives 502 `model`.
      - Then `compile` with `onCall`, and one log line per request holding the status, the error code and the `CallEvent`s.
    - Tests, using the real `verifyAccess` with the local keys, a memory-store limiter with a fixed clock, and `scriptedAsk`:
      - 200, 422 and 502, with exact bodies and headers.
      - Every bad request of the design's list, with one body-size test over 256 KiB.
      - The 404 routes, including a query string that is ignored.
      - 401 before 404 with Access on.
      - Not counted: 400, 401, 404 and 429 leave the store unchanged. Counted once: a request whose ask fails, and a 3-call request.
      - A limiter that throws gives 502 `model`.
      - No log line and no response body contains the sentence, a card name, the IP or the token.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.7, 3.1, 3.6, 8.1, 8.2, 8.3, 9.2, 10.1, 10.10, 11.1, 11.2, 14.4, 14.6, 14.7_
  - [ ] 8.5 Write `worker/src/index.ts`, `worker/wrangler.toml` and `test/worker/config.test.ts`
    - `index.ts` as "worker/src/index.ts and wrangler.toml" gives it:
      - the `Env` interface, with the four vars, `ANTHROPIC_API_KEY` and `LIMITS: DurableObjectNamespace<DailyLimits>`;
      - `createRemoteJWKSet(new URL(CERTS_URL))` at module scope;
      - `DailyLimits extends DurableObject<Env>`, whose `take(key, limits)` calls `take(this.ctx.storage.kv, key, Date.now(), limits)`;
      - the default export with `fetch` wiring `handle`, which `satisfies ExportedHandler<Env>`.
    - It is checked by `tsc -p tsconfig.worker.json` only, since it imports `cloudflare:workers`.
    - `wrangler.toml` exactly as the design gives it, including `workers_dev = false`, `preview_urls = false`, the `/api/*` route, `nodejs_compat`, the `DailyLimits` binding with `new_sqlite_classes`, `[observability] enabled = true` and `[observability.logs] invocation_logs = false`. No secret value in the file.
    - `config.test.ts` reads `worker/wrangler.toml` as text and checks:
      - the route pattern;
      - `workers_dev = false`, `preview_urls = false` and `invocation_logs = false`;
      - `new_sqlite_classes = ["DailyLimits"]`;
      - that the four vars `REQUIRE_ACCESS`, `ACCESS_AUD`, `LIMIT_PER_IP` and `LIMIT_PER_SITE` exist, without pinning their values, because `REQUIRE_ACCESS` flips to `"false"` on submission day;
      - that `ANTHROPIC_API_KEY` does not appear as a key.
    - _Requirements: 7.9, 8.4, 10.8, 11.2, 12.4_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.
  - The post-task hook commits after every task. Check with `git diff --name-only <commit before task 1>..HEAD` plus `git status` that nothing under `src/hypertalk`, `test/hypertalk` or `src/ui` changed. The expected changes are code in `src/compiler`, `worker`, `test/compiler` and `test/worker`, the root `package.json`, `package-lock.json` and tsconfig files, the spec folder, and the hook's entries in `docs/kiro-log.md`.
  - _Requirements: 12.5, 12.6_

## Notes

- No sub-task is optional. Requirements 13 and 14 make the properties and the example tests part of the feature.
- `npm install` in task 1 is the only step that uses the network. No test does (Requirement 14.10). The Wrangler dry run is not a task: 克先生 runs it when deploying.
- The pre-task hook blocks every task while `vitest` is red, so each task leaves the suite green. Vitest does not type-check. Run `npm run typecheck` before finishing each sub-task too, not only at the checkpoints.
- The Worker modules that tests import are type-checked twice: under `@types/node` through the tests (`tsconfig.test.json`), and under the Workers types (`tsconfig.worker.json`). They may use only Web APIs that both have. `worker/src/index.ts` is checked by `tsconfig.worker.json` alone.
- `test/compiler/helpers/arbitraries.ts` is written in 6.1 only, so 6.2 to 6.4 can run side by side. `test/compiler/helpers/fixtures.ts` is written in 3.3.
- Nothing in `src/compiler` or `test/` reads `src/ui/stacks.json`. `EXAMPLES` and the fixtures copy the names they need as literals. The UI regenerates that file, and the Pages deploy runs the whole suite, so a content change there must not turn the compiler's tests red.
- Files under `test/hypertalk/helpers` and `src/hypertalk` are imported by tests (`sourceScan.ts`, `values.ts`, `tokens.ts`) and never edited.
- The UI needs no change. It already renames a button to the new label after a recompile, and it already caps sentences at 500 characters.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 9, "tasks": ["5"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 12, "tasks": ["7"] },
    { "id": 13, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 14, "tasks": ["8.4"] },
    { "id": 15, "tasks": ["8.5"] },
    { "id": 16, "tasks": ["9"] }
  ]
}
```
