# Requirements Document

## Introduction

A person clicks a spot on a card and writes one sentence, in any language, for example "Clicking this goes to the kitchen and lets a bat out". This spec covers the authoring-time compiler that turns that sentence into one button, and the Cloudflare Worker that runs the compiler. The Worker sends the sentence to Claude Opus 5.5 once, when the card is written. Code then checks the reply against the HyperTalk subset and against the real names of the person's stack. The UI gets back a label, one `on mouseUp` script, the names of the new cards to add, and the parts of the sentence that could not be done. At runtime the interpreter runs the stored script and never calls the model (steering: product.md, tech.md).

The interpreter in `src/hypertalk` is finished. The compiler uses its public API (`parse`) and does not change it. The UI in `src/ui` is written separately against the contract below, so the contract's names and shapes are fixed.

Out of scope: the UI, deployment and secrets (the API key is created separately and the maintainer deploys), and changing the interpreter. Recompiling when a sentence is edited calls the same endpoint again with the button's current label, which the reply keeps (spec `recompile-keeps-label`).

## Contract with the UI (fixed)

`POST /api/compile` on the same host as the site (`stack-seance.enhydrink.com/api/compile`), JSON in and out. The UI is written against these names and shapes now. Changing any of them needs the maintainer's agreement first. The optional `label` of CompileRequest comes from spec `recompile-keeps-label`.

```ts
interface CompileRequest {
  sentence: string;                 // 1..500 characters
  stackName: string;                // the current stack
  cardNames: string[];              // every card of the current stack, in order
  cardName: string;                 // the card the button goes on
  fieldNames: string[];             // fields on that card
  buttonNames: string[];            // other buttons on that card
  stackNames: string[];             // every stack, for go to stack
  label?: string;                   // when recompiling: the button's current label, which the reply keeps
}

type CompileResponse =
  | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
  | { ok: false; error: 'nothing'; skipped: string[] }          // 422: nothing in the sentence can be done
  | { ok: false; error: 'limit'; scope: 'ip' | 'site' }         // 429: daily limit reached
  | { ok: false; error: 'bad-request' }                         // 400: the request does not match CompileRequest
  | { ok: false; error: 'unauthorized' }                        // 401: no valid Cloudflare Access token while Access is required
  | { ok: false; error: 'model' };                              // 502: the model failed or never produced a valid result
```

## Glossary

- **Compiler**: the code in `src/compiler/`. It builds the Model_Input, checks each Model_Reply against the Result_Rules, and runs the Retry_Loop through Ask.
- **Worker**: the Cloudflare Worker in `worker/`: its entry point, the Access check, the daily limits, the Limit_Store and the real Ask.
- **UI**: the web app in `src/ui/`, written separately. It calls the Worker and adds the button and the new cards.
- **Interpreter**: the HyperTalk parser and runtime in `src/hypertalk/`. Its **Public_API** is the exports of `src/hypertalk/index.ts`.
- **Subset**: the HyperTalk subset defined in `.kiro/specs/hypertalk-interpreter/requirements.md` and `.kiro/specs/go-to-stack-command/requirements.md`. R-numbers such as R2.3 and R11.4 refer to the first of the two.
- **Sentence**: the `sentence` of a CompileRequest.
- **Request_Names**: the `stackName`, `cardNames`, `cardName`, `fieldNames`, `buttonNames` and `stackNames` of a CompileRequest, and the Request_Label, when the request has one (spec `recompile-keeps-label`).
- **Request_Label**: the `label` of a CompileRequest that has one, the current label of a button being recompiled (spec `recompile-keeps-label`).
- **Model**: Claude Opus 5.5, model id `claude-opus-5-5`. A reply that the server-side fallback serves from another model is handled like any other Model_Reply.
- **Ask**: the function the Compiler is given. It takes one Model_Input and returns a promise of one Model_Reply. In the Worker it calls the Model; in tests it is a fake.
- **Model_Call**: one call of Ask.
- **Model_Input**: what one Model_Call sends: the System_Prompt, the Reply_Schema and the messages.
- **Model_Reply**: what one Model_Call returns: a Refusal, or a finished reply that holds the text the Model wrote and its Assistant_Turn.
- **Refusal**: a Model_Reply whose final `stop_reason`, after the server-side fallback, is `refusal`.
- **Assistant_Turn**: the `content` of the Model's response as the API returned it. The Compiler sends it back unchanged on the next Model_Call.
- **Reply_Schema**: the JSON schema of the Reply_Object, sent as the structured output format. design.md gives it.
- **Reply_Object**: the JSON object the Model writes as its reply text. It is either a Button_Reply, which holds a label, a script, newCards and skipped, or a Nothing_Reply, which says that nothing in the Sentence can be done and holds skipped.
- **Result_Rules**: Rules 1 to 10 of Requirement 4. A reply **follows the rules** when it follows every rule that applies to it.
- **Rule_Checker**: the function in the Compiler that checks one Model_Reply against the Result_Rules for one CompileRequest.
- **System_Prompt**: the fixed instructions of every Model_Call (Requirement 6).
- **User_Message**: the first user message of a Model_Call: the Sentence and the Request_Names.
- **Retry_Message**: the user message that sends the broken rules of a reply back to the Model.
- **Retry_Loop**: the Model_Calls for one CompileRequest, at most three (Requirement 5).
- **Same_Name**: two names are the Same_Name when they are equal after `toLowerCase()`, as the Interpreter compares names (R1.8).
- **Literal_Target**: the target expression of a `go to card` or `go to stack` statement when, with any parentheses around it removed, it is a string literal, a number literal, `true` or `false`. Its **Literal_Text** is its value as a string: the string itself, `String(n)` for a number (R11.8), or `true` or `false`.
- **Looks_Numeric**: the rule of R11.4: optional spaces, an optional minus sign, digits, an optional dot followed by digits, optional spaces.
- **Card_Number_Literal**: a Literal_Target of a `go to card` that is a number literal, or a string literal that is Looks_Numeric. The runtime takes it as a card number (R2.3).
- **Card_Name_Literal**: any other Literal_Target of a `go to card`. The runtime takes its Literal_Text as a card name (R2.3).
- **Reachable after**: a point of a handler is reachable after a statement when some path through the handler runs that statement and then reaches the point. A path runs the statements in order and takes either branch of each `if`. The condition of an `if` comes before its branches, and the target of a `go` comes before that `go` moves.
- **ASCII_Text**: text whose characters are all printable ASCII, from U+0020 (space) to U+007E (`~`).
- **English_Name**: ASCII_Text of 1 to 24 characters that holds at least one letter (A to Z or a to z), holds no double quote, and does not start or end with a space. A HyperTalk string cannot hold a double quote (R11.7), so no script could name a button or card that has one.
- **Compile_Route**: the method `POST` with the path `/api/compile`.
- **Access_Token**: the JWT in the request header `Cf-Access-Jwt-Assertion`.
- **Access_Required**: the state in which the Worker checks the Access_Token: on unless the env var `REQUIRE_ACCESS` is exactly `"false"` (Requirement 9).
- **Team_Domain**: `https://flat-dust-370d.cloudflareaccess.com`. **Certs_URL**: `https://flat-dust-370d.cloudflareaccess.com/cdn-cgi/access/certs`.
- **UTC_Day**: a calendar date in UTC. A new one starts at 00:00 UTC.
- **Client_Key**: the key a client is counted under (Requirement 10.7).
- **Limit_Store**: the storage that holds the daily counts (Requirement 10.8).
- **Test_Suite**: the vitest tests for the Compiler and the Worker, run with `vitest --run`.
- **Change_Set**: every file this spec adds or modifies.

## Requirements

### Requirement 1: The fixed contract

**User Story:** As the developer of the UI, I want the request, the response and the error codes fixed now, so that I can write the UI against them before the compiler exists.

#### Acceptance Criteria

1. THE Worker SHALL serve the Compile_Route at `stack-seance.enhydrink.com/api/compile`, on the same host as the site, taking a CompileRequest as a JSON body and answering with a CompileResponse as a JSON body.
2. THE Compiler SHALL export the types `CompileRequest` and `CompileResponse` with exactly the field names, field types, error codes and `scope` values of the Contract section.
3. THE Worker SHALL answer `ok: true` with status 200, error `nothing` with 422, `limit` with 429, `bad-request` with 400, `unauthorized` with 401 and `model` with 502.
4. THE Worker SHALL send every CompileResponse with the headers `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.
5. IF something unexpected fails while the Worker handles a request on the Compile_Route, such as a bug or a missing secret, THEN THE Worker SHALL answer 502 `{ ok: false, error: 'model' }`, so that every answer on the Compile_Route is a CompileResponse.

### Requirement 2: Check the request

**User Story:** As the operator, I want a request that does not match CompileRequest turned away before it is counted or reaches the Model, so that a broken or oversized request costs nothing.

#### Acceptance Criteria

1. THE Worker SHALL treat a request as a bad request unless its `Content-Type` header is `application/json`, with or without parameters such as `charset`.
2. THE Worker SHALL treat a request as a bad request unless its body is at most 256 KiB and parses as a JSON object that holds `sentence`, `stackName` and `cardName` as strings and `cardNames`, `fieldNames`, `buttonNames` and `stackNames` as arrays of strings.
3. THE Worker SHALL treat a request as a bad request unless the Sentence is 1 to 500 characters long, counted in UTF-16 code units (the JavaScript `length`), and holds at least one character that is not whitespace.
4. THE Worker SHALL treat a request as a bad request when any of the four name lists holds more than 100 names, or when `stackName`, `cardName` or any name in a list is longer than 100 characters.
5. THE Worker SHALL accept the empty string as `stackName`, as `cardName` and in every name list, because a card can have no name.
6. THE Worker SHALL ignore fields of the body that CompileRequest does not define.
7. IF a request is a bad request, THEN THE Worker SHALL answer 400 `{ ok: false, error: 'bad-request' }` without counting it (Requirement 10) and without a Model_Call.
8. THE Worker SHALL treat a request that has a `label` as a bad request unless the label is a string of 1 to 24 characters, counted as in 2.3, that holds a character that is not whitespace and is not the Same_Name as any name in `buttonNames`. The label is not checked for being English. A request without a `label` is checked as the criteria above say (spec `recompile-keeps-label`).

### Requirement 3: What a sentence becomes

**User Story:** As a card author, I want to write one sentence in any language and get one button back, so that the card grows what I described, plus the cards it leads to.

#### Acceptance Criteria

1. WHEN the Compiler accepts a Button_Reply, THE Worker SHALL answer 200 `{ ok: true, label, script, newCards, skipped }` with the four values of that reply.
2. THE Compiler SHALL return a label that is a short English button label of at most 24 characters (Rule 7) in whatever language the Sentence is written, because the interface is English and the pixel font has no Chinese or Japanese glyphs. WHEN the request has a Request_Label, THE Compiler SHALL return that label, unchanged, whatever its language (Rule 7; spec `recompile-keeps-label`).
3. THE Compiler SHALL return a script that is exactly one `on mouseUp … end mouseUp` handler in the Subset (Rules 1 and 2). A button script never holds an `openCard` handler.
4. THE Compiler SHALL return as newCards the names of the cards that the script goes to by name and that do not exist yet in the current stack (Rule 4). The UI adds a blank card for each name, in this order, at the end of the current stack.
5. THE Compiler SHALL return as skipped one short English phrase, for example "play a song", for each part of the Sentence that the Subset cannot do (Rule 9), and an empty list when nothing was skipped. The Compiler does what the Subset can and lists the rest.
6. WHEN the Compiler accepts a Nothing_Reply, THE Worker SHALL answer 422 `{ ok: false, error: 'nothing', skipped }` with the skipped phrases of that reply, and no button is made.
7. THE Compiler SHALL return the label, script, newCards and skipped of the accepted reply unchanged: not trimmed, reformatted, translated or reordered.

### Requirement 4: Result rules

**User Story:** As a card author, I want every button the compiler gives me to fit my stack, so that it never names a card, field, button or stack that is not there and never leaves the subset.

The Rule_Checker checks these rules in code after every Model_Reply. Names are compared as Same_Name, and an empty name in a request list never matches. Rules 1 to 8 apply to a Button_Reply; Rules 9 and 10 apply to every reply. Rules 1 to 7 come from the original request for this spec. The parts marked "also", and Rules 8 to 10, were added while writing it.

#### Acceptance Criteria

1. Rule 1: THE Rule_Checker SHALL accept a Button_Reply only when `parse(script)` from the Public_API succeeds.
2. Rule 2: THE Rule_Checker SHALL accept a Button_Reply only when the script has exactly one handler and that handler is `mouseUp`; also, its body holds at least one statement.
3. Rule 3: THE Rule_Checker SHALL accept a Button_Reply only when the Literal_Text of every Card_Name_Literal is the Same_Name as a name in `cardNames` or in `newCards`; also, every Card_Number_Literal is a whole number from 1 to the number of names in `cardNames` plus the number of names in `newCards`.
4. Rule 4: THE Rule_Checker SHALL accept a Button_Reply only when every name in `newCards` is the Same_Name as the Literal_Text of a Card_Name_Literal of the script, is not the Same_Name as any name in `cardNames`, and is not the Same_Name as any other name in `newCards`; also, it is an English_Name and is not Looks_Numeric.
5. Rule 5: THE Rule_Checker SHALL accept a Button_Reply only when the Literal_Text of every Literal_Target of a `go to stack` is the Same_Name as a name in `stackNames`.
6. Rule 6: THE Rule_Checker SHALL accept a Button_Reply only when every field that the script names as `field "<name>"`, in `put`, `show`, `hide` or an expression, is the Same_Name as a name in `fieldNames`, and every button that it names as `button "<name>"` is the Same_Name as a name in `buttonNames` or as the label.
7. Rule 7: WHEN the request has no Request_Label, THE Rule_Checker SHALL accept a Button_Reply only when the label is 1 to 24 characters long and is not the Same_Name as any name in `buttonNames`; also, the label is an English_Name, which is how the code checks "English". WHEN the request has a Request_Label, THE Rule_Checker SHALL accept a Button_Reply only when the label is exactly the Request_Label, with the same characters in the same case (spec `recompile-keeps-label`).
8. Rule 8: THE Rule_Checker SHALL accept a Button_Reply only when no `field "<name>"` or `button "<name>"` of the script is reachable after a `go`, and no Literal_Target of a `go to card` is reachable after a `go to stack`. After a `go`, names resolve on the new current card and stack (R2.6), and the request lists only this card's fields and buttons and this stack's cards.
9. Rule 9: THE Rule_Checker SHALL accept a reply only when `skipped` holds at most 10 phrases and each phrase is ASCII_Text of 1 to 60 characters that does not start or end with a space.
10. Rule 10: THE Rule_Checker SHALL accept a reply only when the reply text is one JSON object that matches the Reply_Schema, and, for a Nothing_Reply, `skipped` holds at least one phrase and the reply holds no label, no script and no new card.
11. THE Rule_Checker SHALL report every broken rule it finds in a reply. WHEN Rule 10 is broken, THE Rule_Checker SHALL report Rule 10 alone. WHEN Rule 1 is broken, THE Rule_Checker SHALL still check Rule 7, Rule 9, and the parts of Rule 4 that do not need a parsed script.
12. THE Rule_Checker SHALL give each report the rule number, the rule in one sentence, and the part of the reply that breaks it, quoted. For a part of the script, the report SHALL also name its script line, from 1 to the script's line count (tech.md).

### Requirement 5: Two more chances, then give up

**User Story:** As a card author, I want the compiler to give the model two more chances when it breaks a rule, and then to say plainly that it did not work this time, so that I never get a broken button.

#### Acceptance Criteria

1. THE Compiler SHALL make the first Model_Call with the System_Prompt, the Reply_Schema and one message, the User_Message.
2. WHEN a Model_Reply follows the rules, THE Compiler SHALL make no further Model_Call and SHALL return a Button_Reply as the `ok: true` result and a Nothing_Reply as error `nothing`.
3. WHEN a Model_Reply breaks a rule and fewer than three Model_Calls have been made, THE Compiler SHALL make the next Model_Call with the messages of the previous call, followed by that reply's Assistant_Turn exactly as Ask returned it, followed by a Retry_Message that lists every broken rule (Requirement 4.11 and 4.12).
4. IF the third Model_Reply breaks a rule, THEN THE Compiler SHALL return error `model`.
5. IF a Model_Reply is a Refusal, THEN THE Compiler SHALL return error `model` without a further Model_Call.
6. IF Ask fails, THEN THE Compiler SHALL return error `model` without a further Model_Call.
7. THE Compiler SHALL make at most three Model_Calls for one CompileRequest.
8. THE Compiler SHALL give every Model_Call of one CompileRequest the same System_Prompt and Reply_Schema, and SHALL only add messages after those of the previous call, never change or drop one, so that the prompt cache and the Model's earlier thinking stay valid.
9. THE Compiler SHALL write the Retry_Message in English and end it by asking for the whole reply again.

### Requirement 6: The system prompt and the user message

**User Story:** As the developer, I want one fixed system prompt that teaches the subset with examples, so that it is cached and every sentence is compiled under the same rules.

#### Acceptance Criteria

1. THE System_Prompt SHALL describe every statement and expression of the Subset that a `mouseUp` handler can use, including `go to stack` and the four haunts, and SHALL state Rules 1 to 10.
2. THE System_Prompt SHALL hold a handful of examples, each an example request and the reply for it, including at least a Sentence in Chinese or Japanese, a Sentence with a skipped part, a Sentence that makes a new card, and a Sentence where nothing can be done.
3. THE System_Prompt SHALL hold only example replies that follow the rules for their example requests and whose scripts parse with `parse`.
4. THE System_Prompt SHALL be the same text for every CompileRequest and SHALL hold no Sentence and no Request_Names of the request being compiled.
5. THE User_Message SHALL hold the Sentence and every one of the Request_Names. It SHALL hold the Request_Label only when the request has one, after the other fields (spec `recompile-keeps-label`).
6. THE System_Prompt SHALL tell the Model to write the label, the new card names and the skipped phrases in English, to keep text that the card shows to the reader (in `answer`, `ask` and `put`) in the language of the Sentence, to do what the Subset can and list the rest in skipped, and to give a Nothing_Reply when nothing can be done.
7. THE System_Prompt and the Reply_Schema SHALL NOT ask the Model to write out its reasoning in the reply, because the Model can refuse such a request (`reasoning_extraction`).
8. THE System_Prompt SHALL hold a static paragraph saying that when the request has a label, the button is being recompiled and keeps that label, so the reply's label is exactly that label and the script names the button by it (spec `recompile-keeps-label`).

### Requirement 7: The model call

**User Story:** As the operator, I want the model call set up as decided, so that cost, refusals and caching behave as planned.

#### Acceptance Criteria

1. THE Worker SHALL make each Model_Call to the Model `claude-opus-5-5` through the official `@anthropic-ai/sdk`.
2. THE Worker SHALL send the Reply_Schema as a structured output in `output_config.format`, with `type: "json_schema"`.
3. THE Worker SHALL set `output_config.effort` to `"medium"` explicitly.
4. THE Worker SHALL leave adaptive thinking on and SHALL NOT send `thinking: { type: "disabled" }`, which this Model rejects.
5. THE Worker SHALL turn on the server-side refusal fallback with `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`.
6. WHEN the final `stop_reason` of a response is `refusal`, THE Worker's Ask SHALL return a Refusal.
7. WHEN a response ends with any other `stop_reason`, THE Worker's Ask SHALL return the text of its text blocks as the reply text and its `content` unchanged as the Assistant_Turn.
8. THE Worker SHALL send the System_Prompt as one system text block marked with `cache_control`, and the Request_Names only in the User_Message.
9. THE Worker SHALL read the API key only from the Worker secret `ANTHROPIC_API_KEY`.
10. IF the API call fails, through an API error, a network error or a timeout, THEN THE Worker's Ask SHALL fail, so that the Compiler returns error `model` (Requirement 5.6).

### Requirement 8: Routes and the order of checks

**User Story:** As the operator, I want the Worker to answer only the compile route and to check every request in a fixed order, so that nothing else is exposed and every answer is predictable.

#### Acceptance Criteria

1. THE Worker SHALL handle only the Compile_Route: the method `POST` and the path exactly `/api/compile`, with any query string ignored.
2. WHEN a request has any other method or path, THE Worker SHALL answer 404 with a plain-text body, which is not a CompileResponse.
3. THE Worker SHALL check every request in this order and answer with the first check that fails: the Access check (Requirement 9), the route (8.1), the request (Requirement 2), the daily limits (Requirement 10). A request that passes all four reaches the Model.
4. THE Worker SHALL have its own `worker/wrangler.toml` that routes it to `stack-seance.enhydrink.com/api/*` and turns off the `workers.dev` route and preview URLs.

### Requirement 9: The Cloudflare Access check

**User Story:** As the operator, I want the Worker to serve only people signed in through Cloudflare Access until submission day, and to drop that check with one switch on the day, so that the model budget is safe while the site is private.

#### Acceptance Criteria

1. WHILE Access_Required, THE Worker SHALL accept a request only when its Access_Token is a JWT signed with RS256 by a key published at Certs_URL, whose `iss` is the Team_Domain, whose `aud` holds the value of the env var `ACCESS_AUD`, whose `exp` is in the future, and whose `nbf`, when present, is not in the future.
2. IF Access_Required and the Access_Token is missing or cannot be verified for any reason, including keys that fail to load, THEN THE Worker SHALL answer 401 `{ ok: false, error: 'unauthorized' }` without counting the request and without a Model_Call.
3. IF Access_Required and `ACCESS_AUD` is missing or empty, THEN THE Worker SHALL answer 401 to every request.
4. WHEN `REQUIRE_ACCESS` is exactly `"false"`, THE Worker SHALL skip the Access check.
5. THE Worker SHALL treat a missing `REQUIRE_ACCESS`, and any value other than `"false"`, as Access_Required.
6. THE Worker SHALL load the signing keys from Certs_URL at run time and pick the key by the token's `kid`, so that Access key rotation needs no change to the Worker.

### Requirement 10: Daily limits

**User Story:** As the operator, I want each client limited to 20 compiles a day and the whole site to 200, so that Opus calls of a few cents each add up to a few dollars a day at most.

#### Acceptance Criteria

1. THE Worker SHALL count a request when it reaches the Model: after it passes the Access check, the route and the request checks and the limit check lets it through, and before the first Model_Call. THE Worker SHALL count it once, however many Model_Calls it makes and whatever it returns.
2. IF the count of the Client_Key for the current UTC_Day has reached the per-IP limit, THEN THE Worker SHALL answer 429 `{ ok: false, error: 'limit', scope: 'ip' }` without counting the request and without a Model_Call.
3. IF the per-IP limit is not reached and the count of the whole site for the current UTC_Day has reached the per-site limit, THEN THE Worker SHALL answer 429 `{ ok: false, error: 'limit', scope: 'site' }` without counting the request and without a Model_Call.
4. THE Worker SHALL check both limits and count the request in one atomic step of the Limit_Store, so that requests that arrive together cannot go past a limit.
5. THE Worker SHALL keep the counts per UTC_Day, so that at 00:00 UTC every count starts again from 0.
6. THE Worker SHALL take the per-IP limit from the env var `LIMIT_PER_IP` and the per-site limit from `LIMIT_PER_SITE` when the value is a whole number of 0 or more, and SHALL use 20 and 200 when the variable is missing or holds anything else.
7. THE Worker SHALL take the Client_Key from the `CF-Connecting-IP` header: an IPv4 address as written, an IPv6 address by its first 64 bits, and the key `unknown` when the header is missing.
8. THE Limit_Store SHALL be storage that the Workers Free plan allows, a SQLite-backed Durable Object or KV, and design.md SHALL say which one and why.
9. THE Worker SHALL drop the counts of earlier UTC_Days, with their Client_Keys, at the first limit check of a new UTC_Day.
10. IF the Limit_Store fails, THEN THE Worker SHALL answer 502 `{ ok: false, error: 'model' }` without a Model_Call.

### Requirement 11: Secrets and personal data

**User Story:** As the operator, I want the API key and the visitors' data kept out of responses and logs, so that nothing leaks through the Worker.

#### Acceptance Criteria

1. THE Worker SHALL NOT put the API key, the Access_Token or the Client_Key in any response, so that the API key never reaches the browser.
2. THE Worker SHALL NOT write the API key, the Access_Token, the Client_Key, the Sentence or the Request_Names to its logs.

### Requirement 12: Code layout

**User Story:** As a developer, I want the pure compiler apart from the Worker, so that the compiler can be tested with a fake model and the interpreter stays untouched.

#### Acceptance Criteria

1. THE Compiler SHALL be pure TypeScript that makes no network request: it SHALL NOT use `fetch`, `XMLHttpRequest`, `WebSocket`, the DOM, timers or `@anthropic-ai/sdk`, and SHALL reach the Model only through the Ask it is given.
2. THE Compiler SHALL import from the Interpreter only through the Public_API.
3. THE Compiler SHALL export a function `compile(request, ask)` that runs the Retry_Loop and returns the `ok: true` result, error `nothing` or error `model`, together with the types, the System_Prompt, the Reply_Schema and the Rule_Checker that the Worker and the tests use.
4. THE Worker SHALL keep its entry point, the Access check, the daily limits, the Limit_Store and the real Ask in `worker/`.
5. THE Change_Set SHALL NOT modify `src/hypertalk`, `test/hypertalk` or `src/ui`.
6. WHEN `npm run typecheck` and `npm test` run, THE Change_Set SHALL make them cover the Compiler, the Worker and their tests, and both SHALL pass.

### Requirement 13: Correctness properties

**User Story:** As a developer, I want fast-check properties for the compiler, so that no sequence of model replies can get a broken button past the rules.

#### Acceptance Criteria

1. THE Test_Suite SHALL include property P1, tagged "P1 safety": for any CompileRequest and any sequence of fake Model_Replies (replies that follow the rules, replies that break them, unparsable replies, Refusals and failing calls), `compile` either returns an `ok: true` result that follows the rules for that request or returns an error, never a result that breaks a rule, and it makes at most three Model_Calls.
2. THE P1 test SHALL decide whether a result follows the rules from how its generator built each fake reply, built to follow the rules or built to break a named rule, and not from the Compiler's Rule_Checker.
3. THE Test_Suite SHALL include property P2, tagged "P2 faithful": when a fake reply follows the rules, the result has the same script, label, newCards and skipped as that reply.
4. THE Test_Suite SHALL include property P3, tagged "P3 unique card names": for any set of existing card names that are unique ignoring case, and any newCards in an accepted result, the existing names followed by the new ones are still unique ignoring case.
5. THE Test_Suite SHALL run each property at least 200 times.

### Requirement 14: Example tests

**User Story:** As a developer, I want an example test for each rule and each path through the Worker, so that a regression names the rule it breaks.

#### Acceptance Criteria

1. THE Test_Suite SHALL include, for each of Rules 1 to 10, at least one reply that breaks the rule, checked for its rejection and for the exact text of its report in the Retry_Message.
2. THE Test_Suite SHALL include a retry that succeeds on the second reply, checked for the messages of the second Model_Call: the User_Message, the first reply's Assistant_Turn unchanged, and the Retry_Message.
3. THE Test_Suite SHALL include error `nothing` from a Nothing_Reply, and error `model` after three broken replies, after a Refusal and after a failing Ask, each checked for its number of Model_Calls.
4. THE Test_Suite SHALL include limit tests for the per-IP limit, the per-site limit, a new UTC_Day, the scope when both limits are reached, two IPv6 addresses in one /64, the defaults and bad values of `LIMIT_PER_IP` and `LIMIT_PER_SITE`, and that 400, 401, 404 and 429 answers are not counted.
5. THE Test_Suite SHALL include Access tests with the check on, for a valid token, a missing token, a token signed by another key, a wrong `aud`, a wrong `iss`, an expired token and an empty `ACCESS_AUD`, and with the check off through `REQUIRE_ACCESS` `"false"`.
6. THE Test_Suite SHALL include a bad-request test for each check of Requirement 2.
7. THE Test_Suite SHALL include a path that is not `/api/compile` and a method other than `POST` on `/api/compile`.
8. THE Test_Suite SHALL include tests of the Worker's real Ask with a fake SDK client, which check the model id, the effort, the structured output schema, the betas, the fallbacks, the cached system block, the key from `ANTHROPIC_API_KEY`, and how a `refusal` and other stop reasons become Model_Replies.
9. THE Test_Suite SHALL include System_Prompt tests: the same text for two different requests, every example reply following the rules for its example request, and every haunt of the Interpreter named in it.
10. THE Test_Suite SHALL NOT make a network request or call the real Model: the Compiler and Worker tests SHALL run with `fetch` replaced by a function that fails the test, the Access keys SHALL come from a local key set, and a scan of `src/compiler` SHALL find no `fetch`, `XMLHttpRequest`, `WebSocket` or SDK import.
