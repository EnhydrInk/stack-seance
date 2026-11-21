# Tasks: HyperTalk interpreter

- [x] 1. Project setup
  - Check whether the repo has a `package.json`; if not, create a minimal one with TypeScript, vitest and fast-check (Vite arrives with the UI spec).
  - Create `src/hypertalk/` and `test/hypertalk/` with a `tsconfig` that has no DOM lib for `src/hypertalk` (supports R10.2).
  - _Requirements: R10, R13_

- [x] 2. Errors, tokens and lexer
  - [x] 2.1 `errors.ts` with `SyntaxError`, `RuntimeError`, `clampLine`.
  - [x] 2.2 `tokens.ts` with keyword and reserved word tables.
  - [x] 2.3 `lexer.ts`: words, numbers, strings, comments, two-character operators, line and column on every token, `\r\n` handling.
  - [x] 2.4 Example tests: unclosed string reports its line, unknown character, CRLF line numbers, trailing newline does not add a line.
  - [x] 2.5 Comment tests: a trailing comment and a comment-only line are ignored, line numbers after a comment are unchanged, `--` inside a string stays in the string, and a syntax error after a comment names the right line.
  - _Requirements: R11.7, R11.9, R12_

- [x] 3. AST and parser
  - [x] 3.1 `ast.ts` with the types and `stripPositions`.
  - [x] 3.2 Expression parser with the precedence levels and `is not`.
  - [x] 3.3 Statement parser: go, visual effect, answer, ask, put, show, hide, wait, global.
  - [x] 3.3a Haunts: the `HAUNTS` table and `HauntKind` in `tokens.ts`, with every haunt word added to `KEYWORDS` (so `RESERVED` has them). Add the `haunt` statement to `ast.ts`, and in `statement()` parse a haunt by looking up the first word in a map built from the table and then expecting the entry's remaining words.
  - [x] 3.4 `if` in block and single-line forms, including the nested single-line error.
  - [x] 3.4a `else if` chains in the block form (nested `if` in the else list, one `end if`), and `else if` in the single-line form as a syntax error.
  - [x] 3.4b `true` and `false` as `bool` nodes in the primary-expression parser, and both words in the reserved word table.
  - [x] 3.5 Handlers: names, mismatched `end`, unclosed handler, duplicate handler, empty script.
  - [x] 3.6 Example tests for each syntax error in R1, R4.2, R5.5, R8.4, R9.5, R11.2 (non-chaining comparison) with the expected line numbers. Include `put 1 into true` and `global false` (reserved), and `else if` in a single-line `if`.
  - [x] 3.7 Else-if example tests: a three-way chain (`if` / `else if` / `else if` / `else` / `end if`) parses to `if` with `else: [if …, else: [if …, else: […]]]`, and equals the tree of the same logic written as `else` with nested block `if`s. A chain with no `end if` reports a syntax error on the line of the first `if`, not on an `else if` line.
  - [x] 3.7a Haunt parse example tests: `release bat`, `howl`, `summon witch` and `drop spider` parse to `haunt` nodes with kinds `bat`, `howl`, `witch` and `spider` (also in mixed case, and as the statement of a single-line `if`). `release` alone and `summon cat` are syntax errors on their line. `put 1 into bat`, `global spider` and `put howl into x` are reserved-word errors. A table test checks that each entry's first word is unique and starts no other statement, and that no word is `it`, `true` or `false`.
  - _Requirements: R1, R2.1, R3.1, R9.6, R11.9, R11.10, R4.1–R4.3, R5.1, R5.5, R6.1, R7.1, R8, R9, R11, R15.1, R15.4_

- [x] 4. Printer and round trip
  - [x] 4.1 `printer.ts` with canonical output and minimal parentheses for ASTs without `paren` nodes. Prints `bool` as lowercase `true`/`false`, and an `else` holding exactly one `if` as `else if`.
  - [x] 4.1a Printer for haunts: a `haunt` node prints as its `HAUNTS` words in lowercase. Example tests: the four kinds print as `release bat`, `howl`, `summon witch` and `drop spider`, and parsing each printed line gives the same node back.
  - [x] 4.2 Write `arbitraries.ts` for expressions, statements and scripts (valid by construction, keyword case and spacing variants through a source-level renderer).
  - [x] 4.2a The statement arbitrary draws `haunt` statements with `fc.constantFrom(...HAUNTS.map(h => h.kind))`, and the source-level renderer varies the case and spacing of haunt words, so P1 covers haunts. The same arbitrary feeds P3 (10.1a).
  - [x] 4.3 **Property P1** (round trip), and a test that single-line and block `if` give equal trees. The script arbitrary includes `bool` expressions and `else if` chains of length 1 to 4, and the property covers both.
  - _Requirements: R9.3, R9.6, R11.10, R15.1, P1_

- [ ] 5. Syntax error line property
  - [ ] 5.1 Mutation arbitrary: delete, duplicate, swap, replace tokens, truncate, insert junk lines.
  - [ ] 5.2 **Property P4** against `parseUnguarded` (so `clampLine` cannot hide a wrong line), plus a check that `parse` and `parseUnguarded` agree, plus the test that at least 30% of generated mutants fail to parse.
  - _Requirements: R12.1, R12.4, P4_

- [ ] 6. Values and host
  - [ ] 6.1 `values.ts`: `toStr`, `toNumber`, `looksNumeric`, `compare`, `asBool`, with example tests.
  - [ ] 6.2 `host.ts` interface and `RunContext`.
  - [ ] 6.3 `test/hypertalk/helpers/fakeHost.ts` with call log, scripted dialog replies, `clone()`.
  - [ ] 6.4 `haunt(kind: HauntKind): Promise<void>` in the `Host` interface. The fake host adds `{ call: 'haunt', kind }` to its call log, changes no card, field or visibility state, and resolves at once.
  - _Requirements: R10, R11.4–R11.6, R11.8, R15.2, R15.3_

- [ ] 7. Runtime: expressions and variables
  - [ ] 7.1 `evaluate` for all expression forms, with runtime errors that carry lines.
  - [ ] 7.2 Frames, locals, globals, `global` statement, `it`.
  - [ ] 7.3 Example tests: operators, precedence, `&` vs `&&`, division by zero, non-numeric arithmetic, comparison rules, `contains`, boolean operators.
  - [ ] 7.4 `bool` evaluation gives the strings `"true"` and `"false"`. Example test: with the `ask` reply `yes`, the script `put it is "yes" into correct` followed by `if correct is true then` takes the then branch; with the reply `no` it takes the else branch.
  - [ ] 7.5 Runtime check of an `else if` chain: only the first true branch runs, the final `else` runs when none is true, and a non-boolean condition in an `else if` reports the line of that `else if`.
  - _Requirements: R8, R9.4, R9.6, R11_

- [ ] 8. Runtime: statements
  - [ ] 8.1 `put` into field, after, before, and into variable. Missing field error.
  - [ ] 8.2 `show` and `hide`, missing item error.
  - [ ] 8.3 `answer` and `ask` (default label, cancel gives empty `it`).
  - [ ] 8.4 `wait` with validation.
  - [ ] 8.5 `if`/`else` with boolean check.
  - [ ] 8.6 Top-level catch that turns unexpected exceptions into a runtime error with a line.
  - [ ] 8.7 `haunt`: `await ctx.host.haunt(stmt.kind)` and nothing else. Example tests: running each of the four haunts adds exactly one haunt call with its kind to the call log. After a haunt, the current card, fields, visibility, a local, a global and `it` are unchanged. With a host whose `haunt` promise is resolved by the test, the next statement does not run until it resolves.
  - _Requirements: R4, R5, R6, R7, R9, R12.3, R15.2, R15.3_

- [ ] 9. Runtime: navigation, effects, openCard
  - [ ] 9.1 `go` for next, prev, first, last, with wrap-around.
  - [ ] 9.2 `go to card` by number, by numeric string and by name, failure leaves the card unchanged. Example test: `ask` replies `3`, then `go to card it` reaches card 3; reply `2.5` and a missing name are errors on the `go` line.
  - [ ] 9.2a After a successful `go`, later statements in the same handler resolve `field`, `show` and `hide` names on the new card (example test with the same field name on two cards).
  - [ ] 9.3 Visual effect: pending effect used by the next `go`, cleared on failure and at the end of the run.
  - [ ] 9.3a Example test: with a haunt between `visual effect dissolve` and `go to next card`, the `go` still plays `dissolve`.
  - [ ] 9.4 `openCard` after `go` (also when the target is the current card), nested errors with `scriptId` and own line, the move kept after an `openCard` error, depth limit of 16.
  - [ ] 9.5 **Property P2** (navigation) with all three outcomes, with example tests for both wraps, for a failing go leaving the card unchanged, and for an `openCard` error keeping the move.
  - _Requirements: R2, R3, R12.5, R14, R15.3, P2_

- [ ] 10. Remaining properties
  - [ ] 10.1 **Property P3** (determinism) using `fakeHost.clone()` and the script and stack arbitraries.
  - [ ] 10.1a P3 scripts include haunt statements (4.2a), and the compared call logs include the haunt calls with their kinds.
  - [ ] 10.2 **Property P5** (runtime error lines).
  - [ ] 10.3 **Property P6** (global sharing).
  - _Requirements: R8.2, R12.1, R15.2, P3, P5, P6_

- [ ] 11. No network or LLM
  - [ ] 11.1 Test that runs a sample script with `fetch`, `XMLHttpRequest`, `WebSocket` replaced by failing stubs.
  - [ ] 11.2 Static test scanning `src/hypertalk/**/*.ts` for banned names (`fetch`, `XMLHttpRequest`, `WebSocket`, `window`, `document`, `setTimeout`, `Date`, `Math.random`) and for imports from outside `src/hypertalk`.
  - _Requirements: R10.2, R13_

- [ ] 12. Public API
  - [ ] 12.1 `index.ts` exporting `parse`, `print`, `runHandler`, the AST types, the error types, and `Host`.
  - [ ] 12.1a Export `HauntKind` from `index.ts`. Static test for R15.4: no file in `src/hypertalk` other than the `HAUNTS` table holds a haunt word or kind as a string literal.
  - [ ] 12.2 Run the whole suite once (`vitest --run`) and fix failures.
  - _Requirements: all_
