# Implementation Plan: go to stack

## Overview

The work follows the pipeline from the outside in: tokens, AST, parser and printer first, then the Host interface with the `StackRef` export and the fake host that implements it, then the runtime's stack branch, then example tests, then the properties, then the new text of the `go` fallback message, and last the amendment of the hypertalk-interpreter spec. Code changes stay in `src/hypertalk` and `test/hypertalk`. There is no UI work.

Each top-level task ends with `npx vitest --run` and `npm run typecheck` passing. Two places need care to keep that true:

- Adding the `stack` variant to `GoTarget` (1.1) makes `targetCard` in `runtime.ts` non-exhaustive, so 1.1 narrows it to `CardTarget` and puts a one-line placeholder for stack targets in `go()`. Task 3 replaces the placeholder.
- The parser's new fallback message (Requirement 1.7) would break the three existing tests that spell out the old text. So the parser change and the three test strings move together in task 8, and task 1 leaves the message as it is.

Requirement numbers (1.1, 9.10) refer to this spec's requirements.md. R-numbers and P1 to P6 refer to `.kiro/specs/hypertalk-interpreter/`.

## Tasks

- [x] 1. Parse and print `go to stack`
  - [x] 1.1 Add the `stack` keyword and the `stack` go target
    - `src/hypertalk/tokens.ts`: add `'stack'` to the `go` line of `KEYWORDS`, so `RESERVED` and `isReserved` include it with no other change.
    - `src/hypertalk/ast.ts`: `GoTarget` gains `{ k: 'stack'; expr: Expr }`, with the doc comment from the design (a stack name, never a number).
    - `src/hypertalk/runtime.ts`: add `type CardTarget = Exclude<GoTarget, { k: 'stack' }>` and narrow the parameter of `targetCard` to it, keeping its body. In `go()`, fail a stack target with a runtime error on the `go` line before `targetCard` is called. This is a placeholder so the type check passes; task 3 replaces it.
    - Done when the full suite and the type check pass with no test edits.
    - _Requirements: 1.1, 1.9, 1.10_

  - [x] 1.2 Parse `go [to] stack <primary>` in `src/hypertalk/parser.ts`
    - Add `PAREN_HINTS` with the card hint as it is today and the stack hint `put a calculated stack name in parentheses, for example go to stack ("Haunted" && "House")`.
    - In `go()`, handle `card` and `stack` in one branch: advance, read `primary()`, fail at a following calculation operator with `PAREN_HINTS[word]`, and return `{ t: 'go', target: { k: word, expr }, pos }`.
    - Do not change the fallback message yet (task 8 changes it).
    - The missing target, a token after the target, and `go to card 1 of stack "A"` come out of `primary()` and `expectLineEnd` with no special case.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

  - [x] 1.3 Print the stack target in `src/hypertalk/printer.ts`
    - `card` and `stack` share one case: `go to ${k} ${printExpr(expr, PRIMARY)}`, so a non-primary target is printed in parentheses.
    - _Requirements: 2.1, 2.2_

- [x] 2. Host interface for stacks, and the fake host that implements it
  - [x] 2.1 Add `StackRef`, `findStackByName` and `goToStack` to `src/hypertalk/host.ts`, and export `StackRef` from `src/hypertalk/index.ts`
    - `StackRef { id: string; name: string }`, documented as "A stack as the host reports it."
    - `findStackByName(name: string): StackRef | undefined` and `goToStack(stack: StackRef, effect?: Effect): CardRef`, with the doc strings of Requirement 6.2 and 6.3.
    - Document `CardRef.index` as the 1-based position in the current stack and `CardRef.id` as unique across all stacks. Add the paragraph saying that `cardCount`, `currentCard`, `findCardByName`, `cardAt`, `goToCard` and `getCardScript` refer to the current stack. Leave every other method unchanged.
    - `index.ts` exports `StackRef` as a type, so `Object.keys(api)` is unchanged.
    - The test project's type check reports `FakeHost` missing the two methods until 2.3. `npx vitest --run` stays green.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 2.2 Hold stacks in `test/hypertalk/helpers/fakeHost.ts`: data model and constructor
    - Add `FakeStackEntry`, `FakeStackInit`, `FakeStacksInit` and `DEFAULT_STACK = { id: 'stack-1', name: 'Stack 1' }`. Keep `FakeHostInit` and `FakeStack` with their shapes. Add the `findStackByName` and `goToStack` entries to `HostCall`.
    - Add `readonly stacks: FakeStackEntry[]` and a private `currentStackIndex`. Turn `state` into a getter that returns the current entry's `state` object.
    - The constructor takes `FakeHostInit | FakeStacksInit` and tells them apart with `'stacks' in init`. The cards form becomes one stack equal to `DEFAULT_STACK` whose cards keep the ids `card-<n>`. The stacks form gives stack ids `stack-<n>` and card ids `<stack id>/card-<n>` by default. Every stack other than the current one has `current = 1`.
    - Throw for no stacks, a stack with no cards, duplicate stack ids, stack names equal ignoring case, a card id used twice in any stacks, and a `currentStack` or `current` that is not an integer in range.
    - Card calls keep their code, which reads `this.state`, so they answer from the current stack and `cardOf` still throws for a ref from another stack.
    - Existing tests that build a `FakeHost` from `cards` must pass without edits.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.10_

  - [x] 2.3 Add the stack calls, `stack()` and the new `clone()` to the fake host
    - `findStackByName(name)` logs `{ call: 'findStackByName', name }` and returns `{ id, name }` with the stored name, matching ignoring case, or `undefined`.
    - `goToStack(stack, effect)` logs `{ call: 'goToStack', id, ...(effect ? { effect } : {}) }`, then throws before any change for an unknown id or a name that differs from that stack's name. Otherwise it sets the left stack's `current` to 1, switches `currentStackIndex`, sets the target's `current` to 1, and returns `{ index: 1, id, name }` of the first card.
    - `stack(): StackRef` returns the current stack's id and name and logs nothing.
    - `clone()` rebuilds through the stacks form: each entry's id, name and `structuredClone` of its cards, `currentStack`, `current`, the remaining replies, then the log so far.
    - Done when `npm run typecheck` passes again.
    - _Requirements: 7.7, 7.8, 7.9, 7.11, 7.12_

  - [x] 2.4 Write fake host example tests in `test/hypertalk/fakeHost.test.ts`
    - New `describe` blocks for: building from stacks (default ids, given ids, `currentStack` and `current`, `state` being the current entry's object); the cards form holding one stack equal to `DEFAULT_STACK`; each constructor error of Requirement 7.5; `findStackByName` (case, stored name, `undefined` for a missing name and for `''`, logged); `goToStack` (return value, log with and without effect, left stack reset to card 1, current stack as target, both throws leaving the current stack, the current card and `stacks` unchanged, with the call still logged); card calls after `goToStack`, and old refs throwing; `stack()` not logged; `clone()` with several stacks after a `goToStack`, equal and independent.
    - _Requirements: 8.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [x] 2.5 Write the public API type test in `test/hypertalk/index.test.ts`
    - A new `it`: `StackRef` from the public API equals `host.StackRef` and `{ id: string; name: string }`; `Host['findStackByName']` is `(name: string) => StackRef | undefined`; `Host['goToStack']` is `(stack: StackRef, effect?: Effect) => CardRef`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7_

- [x] 3. Run `go to stack` in `src/hypertalk/runtime.ts`
  - Replace the placeholder from 1.1. `go()` takes the pending effect out of the frame first, then splits on the target kind: the stack branch calls `targetStack`, then `checkDepth`, then `host.goToStack(stack, effect)`; the card branch keeps its order of `targetCard`, `checkDepth`, `host.goToCard(card, effect)`. Both end with `await openCard(card, frame, ctx)`.
  - `targetStack`: `toStr(evaluate(expr))`, the empty-name error, `findStackByName` with the text unchanged, and `there is no stack named ${quoteValue(name)}`. It never calls `toNumber` or `cardAt`.
  - Move the depth check and the nested `openCard` run out of `go()` into `checkDepth` and `openCard`, with the existing messages and the existing `scriptId` rule (the innermost failing card names itself).
  - The runtime caches no card or stack state.
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 6.8_

- [x] 4. Example tests for parsing, printing and running `go to stack`
  - [x] 4.1 Write parser and lexer example tests
    - `test/hypertalk/parser.test.ts`, new `describe('go to stack (go-to-stack-command Requirement 1)')`: with and without `to` and in mixed case giving the same tree; each primary kind as target (`"Home"`, `3`, `true`, `it`, `dest`, `field "Where"`, `("Haunted" && "House")`); inside a block `if`, a one-line `if` with `else`, and an `else if` chain.
    - Syntax errors from the design's table, with line, column and full message: one parentheses-hint case per operator `+ - * / & &&`, the missing target (also as the last line with no `end mouseUp`), `go to stack "A" "B"`, `go to card 1 of stack "A"`, `put 1 into stack` and `global stack`, plus the variants `put 1 into STACK` and `global a, stack`. The `go home` case waits for task 8.
    - `test/hypertalk/lexer.test.ts`: `isReserved` is true for `stack`, `STACK` and `Stack`.
    - _Requirements: 8.1, 8.2, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10_

  - [x] 4.2 Write printer example tests in `test/hypertalk/printer.test.ts`
    - New `describe('printing go to stack')`: a string target, a variable target, a `bin` target without a `paren` node printed in parentheses, and a `not` target with parentheses. Each printed line parses back to the same node.
    - _Requirements: 8.3, 2.1, 2.2_

  - [x] 4.3 Create `test/hypertalk/runtime.stacks.test.ts` with lookup and effect tests
    - Fixture: a Home stack (`home`, card `Home` with button `House` and field `note`) and a Haunted House stack (`house`, cards `Hall`, `Crypt`, `Attic`, `Lobby`, each with field `note` and button `door`), plus an `inHandler` helper as in `runtime.navigation.test.ts`.
    - Existing stack with the exact log; other case passed to `findStackByName` unchanged; a number target matching a stack named `3` with no `cardCount` or `cardAt` call; `go to stack 2` with no such stack.
    - Missing stack and empty name, as literals and through `ask` (reply and cancel): error on the `go` line, stack and card unchanged, no `goToStack` or `goToCard`, later `answer` not run, no `findStackByName` for the empty name. An evaluation error in the target after `visual effect dissolve`.
    - The current stack as target, started on card 3. The effect logged with `goToStack` and not with a later `go to next card`; the effect dropped for a missing stack.
    - _Requirements: 8.4, 8.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2_

  - [x] 4.4 Add `openCard`, depth, continuation and globals tests to `test/hypertalk/runtime.stacks.test.ts`
    - The first card's `openCard` runs with fresh locals and an empty `it`. A runtime error and a syntax error in its script come back with `scriptId: 'house/card-1'`, that script's line, the move kept and the rest of the button handler not run. A deeper error from card 2's `openCard` carries `house/card-2`.
    - The depth limit through two stacks whose first cards go to each other's stack: the depth message on the `go` line at level 16, with 16 `goToStack` calls. A mixed chain of stack and card gos stops after 16 moves in total.
    - The rest of the handler runs after a stack go and writes the new card's field only. A global set on Home is appended to by Hall's `openCard`, which reads the local `x` as `''`; the store ends with `visits = "12"`.
    - _Requirements: 8.6, 8.7, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.4_

  - [x] 4.5 Add current-stack-only card resolution tests to `test/hypertalk/runtime.stacks.test.ts`
    - A fixture variant where Home has cards `Home` and `Lobby`, so the house has more cards and a card with the same name.
    - Before the stack go: `go to card 3` fails with `there is no card 3: the stack has 2 cards`, `go to card "Crypt"` fails, `go to last card` and `go to card "lobby"` reach Home's card 2.
    - After the stack go: `go to card "Lobby"` reaches the house's card 4, `go to card 3` reaches Attic, `go to first card` from Attic reaches Hall, `go to last card` reaches Lobby, next from Lobby wraps to Hall, prev from Hall wraps to Lobby, and `field "note"` and `hide button "door"` act on the house's current card only.
    - _Requirements: 8.8, 5.2, 5.3, 6.5, 6.8_

- [x] 5. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Correctness properties
  - [x] 6.1 Extend the P1 generator and write the P1 coverage test
    - **Property 1: Round trip with stack targets (P1)**
    - `test/hypertalk/helpers/arbitraries.ts`: `simpleStmtArb` gains `exprArb.map(expr => ({ t: 'go', target: { k: 'stack', expr } }))`. `Renderer.simple` writes `go [to] stack <expr at PRIMARY>` with `to` dropped at random and random keyword case, as for `card`.
    - `test/hypertalk/roundtrip.property.test.ts`: the P1 tests stay as written. A new coverage `it` checks that a fixed-seed sample of `scriptArb` has stack targets of every expression kind, inside `if` blocks too, and that renderings write the stack go with and without `to`.
    - The new `simpleStmtArb` alternative also changes what `mutantArb` draws for the P4 ratio tests (`seed: 5`), and the workspace's pre-task hook blocks the next task while the suite is red. So run `npx vitest --run test/hypertalk/syntaxerror.property.test.ts` before finishing this task. If a ratio test fails, apply the rule of task 7 now: leave the test as written, report the measured ratios and ask the user.
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 9.1**

  - [x] 6.2 Add the stack P2 generators to `test/hypertalk/helpers/arbitraries.ts`
    - Export `GenStackOfCards`, `GenStackSet`, `StackTarget`, `StackNavCase`, `stackNavCaseArb` and `stackGoScript`, as the design describes them.
    - 1 to 5 stacks with ids `st<n>`, names unique ignoring case (lettered names, or one time in five a digit name `"0"` to `"5"`), 1 to 4 cards per stack with ids `st<n>-c<m>` and scripts from `cardScriptArb`. A random starting stack and card, an optional effect, and a target that is a name as written, in swapped case, or missing (`missingNameArb`, the empty string, or an unused digit), passed as a literal, through `ask`, or as a number.
    - Leave `GenStack`, `stackArb`, `navCaseArb` and `goScript` unchanged, so the card P2 stays on one stack.
    - _Requirements: 9.2, 9.3, 9.6_

  - [x] 6.3 Write the stack P2 property in `test/hypertalk/stacknavigation.property.test.ts` (new file)
    - **Property 2: Stack navigation outcomes (P2 stack navigation)**
    - Test name starts with "P2 stack navigation", with the comment `Feature: go-to-stack-command, Property 2: Stack navigation outcomes`. 300 runs.
    - `expectedStackOutcome(case)` comes from the generated stacks alone; `observedStackOutcome(result, host, case, goLine)` classifies the run into (a), (b) or (c). The test checks that exactly one outcome holds, that it is the expected one, and the `findStackByName` and `goToStack` entries of the log.
    - A coverage test on 1000 fixed-seed samples: each outcome in at least 10% of cases, and every combination the design lists occurs. The model's match agrees with `rel` for every sample.
    - `test/hypertalk/navigation.property.test.ts` stays as written.
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.7, 4.9, 9.2, 9.3, 9.4, 9.5, 9.6**

  - [x] 6.4 Add `stackSessionArb` and `anySessionArb` to `test/hypertalk/helpers/arbitraries.ts`
    - `runnableSimpleArb`, `runnableStmtArb` and `runnableScriptArb` take an optional list of stack names. Without it, their `commands` list is the same as today, so `sessionArb` draws the same values for the existing fixed-seed coverage tests.
    - With stack names, they add `runnableStackGoArb(stacks)`: an existing name in random case, sometimes `Nowhere 7`, the empty string, or `it`.
    - `stackSessionArb`: 1 to 3 lettered stack names; 1 to 3 cards per stack cut in order from one `fc.uniqueArray` of card names; fields and buttons from `cardItemsArb`; card scripts from `sessionCardScriptArb` plus `on openCard` / `go to stack "<name>"` / `end openCard`; a random starting stack and card; replies over card and stack names; a `mouseUp` from `runnableScriptArb(cardNames, stackNames)`.
    - Widen `Session.host` to `FakeHostInit | FakeStacksInit`. Export `anySessionArb = fc.oneof(sessionArb, stackSessionArb)`.
    - _Requirements: 9.7_

  - [x] 6.5 Extend the P3 property in `test/hypertalk/determinism.property.test.ts`
    - **Property 3: Determinism across stacks (P3)**
    - Run P3 on `anySessionArb`. `runOn` also returns `host.stacks` and `host.stack()`. Before running, check that the clone's `stacks` and `stack()` equal the original's. Compare results, `state`, `stacks`, current stack, replies, globals and logs, including `findStackByName` and `goToStack` calls.
    - A coverage test on 500 fixed-seed samples of `stackSessionArb`: runs reach `findStackByName` and `goToStack`, some end in a stack other than the starting one, and some fail on a stack go of the run script. The existing `sessionArb` coverage test stays as written.
    - **Validates: Requirements 6.8, 7.11, 9.7, 9.8**

  - [x] 6.6 Extend the P5 property in `test/hypertalk/runtimeerror.property.test.ts`
    - **Property 5: Runtime error lines across stacks (P5)**
    - Run P5 on `anySessionArb`. `scriptOf` finds the error's `scriptId` in every stack: `host.stacks.flatMap((s) => s.state.cards).find((c) => c.id === error.scriptId)`.
    - A coverage test on 1000 fixed-seed samples of `stackSessionArb`: the errors include run-script runtime errors, card-script runtime and syntax errors, and the depth limit.
    - **Validates: Requirements 4.7, 4.8, 9.7, 9.9**

  - [x] 6.7 Add `stack` to the P4 mutation generator in `test/hypertalk/helpers/arbitraries.ts`
    - **Property 4: Syntax error lines with the stack keyword (P4)**
    - `REPLACEMENTS` gains `'stack'`. `JUNK_LINES` gains `'go to stack'`, `'go to stack n + 1'`, `'go to card 1 of stack "A"'` and `'put 1 into stack'`.
    - `test/hypertalk/syntaxerror.property.test.ts` stays as written; its P4 tests now see stack gos and stack junk through `mutantArb`. Task 7 confirms its fixed-seed ratio tests. Run that file before finishing this task too, with the same rule as in 6.1 if a ratio test fails.
    - **Validates: Requirements 1.4, 1.5, 1.6, 1.8, 1.10, 9.10**

- [x] 7. Checkpoint - Full suite and the P4 ratio tests
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.
  - The design flagged the P4 fixed-seed ratio tests as unverified, because 6.1 and 6.7 change what `mutantArb` draws for `seed: 5`. Run `npx vitest --run test/hypertalk/syntaxerror.property.test.ts` and confirm both pass in `describe('mutation generator (P4)')`: "at least 30% of generated mutants fail to parse" and "at least a quarter of the mutants with a lexer error report a parse error found before it (2.1–2.3)".
  - If either fails, do not edit the test, its threshold or its seed (Requirement 9.12). Report the measured ratios and ask the user before changing the generators.
  - _Requirements: 9.10, 9.11, 9.12_

- [x] 8. Change the `go` fallback message and its three expected copies
  - `src/hypertalk/parser.ts`: the fallback in `go()` becomes `expected next card, prev card, first card, last card, card … or stack … after "go"`.
  - In the same change, update the expected text and nothing else in `GO_MESSAGE` in `test/hypertalk/parser.test.ts`, the R14.3 syntax error test in `test/hypertalk/runtime.navigation.test.ts`, and `GO_MESSAGE` in `test/hypertalk/helpers/lexMask.ts`.
  - Add the `go home` case (line 2, column 6, full message) to the `go to stack` describe in `test/hypertalk/parser.test.ts`.
  - Leave the old message in the documents under `.kiro/specs/lexer-error-masks-parse-error-fix/` as it is.
  - _Requirements: 1.7, 8.2, 9.12_

- [ ] 9. Amend the hypertalk-interpreter spec
  - [x] 9.1 Amend `.kiro/specs/hypertalk-interpreter/requirements.md`
    - R1.8 adds stack names to the case-insensitive names. R2 opens with the sentence that card targets refer to the current stack, and gains R2.7 to R2.10 as the design words them. R8.4 names `stack` as reserved. R10.1 lists stack lookup by name and going to a stack, and says the card calls refer to the current stack.
    - P1 covers `go to stack` targets of every expression form. P2 gains the stack P2 paragraph with its three outcomes and the note that the card P2 stays on one stack. P3 covers sessions of 1 to 3 stacks and compares all stacks, the current stack and the `findStackByName` and `goToStack` calls. P5 runs on the same sessions and finds the script an error names in any stack.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 9.2 Amend `.kiro/specs/hypertalk-interpreter/design.md`
    - Grammar: the `'stack' primaryExpr` alternative of `go`. Grammar notes: the stack target is a primary expression, a calculated name gets the parentheses hint, and `stack` is reserved. AST: the `{ k: 'stack'; expr: Expr }` variant of `GoTarget`.
    - Host interface: `StackRef`, `findStackByName`, `goToStack`, the rule that card calls and `CardRef.index` refer to the current stack, and card ids unique across stacks. Runtime `go` bullet: the stack branch. Testing strategy: the fake host holds stacks, and `state` is the current stack's `{ cards, current }`.
    - _Requirements: 10.6, 10.7_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.
  - The post-task hook commits after every task, so `git status` alone shows little. Check with `git diff --name-only <commit before task 1>..HEAD` plus `git status` that code changes are only under `src/hypertalk` and `test/hypertalk`, and document changes only under `.kiro/specs/hypertalk-interpreter` and `.kiro/specs/go-to-stack-command`, apart from the hook's entries in `docs/kiro-log.md`.
  - _Requirements: 9.11, 9.12, 10.8_

## Notes

- No sub-task is marked optional. Requirements 8 and 9 make the example tests and the properties part of the feature, so skipping them would leave requirements unmet.
- The order is the one asked for, with two adjustments that keep every top-level task green: the runtime placeholder in 1.1 (removed in task 3), and the parser's fallback message moved from task 1 to task 8 so it changes together with the three tests that spell it out.
- Between 2.1 and 2.3 the test project's type check fails, because `FakeHost` does not yet have the two new methods. The top-level task 2 ends green. The workspace's pre-task hook runs only `vitest`, which does not type-check, so it does not block 2.2 or 2.3.
- The pre-task hook blocks every task while `vitest` is red. A red suite must be fixed or reported inside the task that turned it red, not left for the next checkpoint (see 6.1 and 6.7).
- The post-task hook appends an entry to `docs/kiro-log.md` and commits after each task. That file is the one allowed change outside the two spec folders and the code folders (Requirement 10.8).
- `test/hypertalk/helpers/arbitraries.ts` is edited by 6.1, 6.2, 6.4 and 6.7, so these run one after another. Tasks that run tests on it are not scheduled alongside an edit to it.
- Every existing example test stays as written except the three message strings in task 8 (Requirement 9.12). The existing fixed-seed coverage tests for `sessionArb`, `mutantArb` and the card P2 also stay as written.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4", "2.5"] },
    { "id": 6, "tasks": ["3"] },
    { "id": 7, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 8, "tasks": ["4.4"] },
    { "id": 9, "tasks": ["4.5"] },
    { "id": 10, "tasks": ["5"] },
    { "id": 11, "tasks": ["6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3"] },
    { "id": 14, "tasks": ["6.4"] },
    { "id": 15, "tasks": ["6.5", "6.6"] },
    { "id": 16, "tasks": ["6.7"] },
    { "id": 17, "tasks": ["7"] },
    { "id": 18, "tasks": ["8"] },
    { "id": 19, "tasks": ["9.1", "9.2"] },
    { "id": 20, "tasks": ["10"] }
  ]
}
```
