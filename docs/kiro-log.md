# Kiro log

## lexer-error-masks-parse-error-fix, task 1: Write bug condition exploration tests
- Done: 18 new tests that encode the fix and fail on the unfixed code, as intended. 7 parser unit tests (Repros 1–3, Repro 1 with `\r\n`, `x = 1`, a column-1 lexer error, two handlers), runtime, `openCard` navigation and public `parse` tests, a mutant count (0 of 135 lexer-error mutants report a parse error today), and 3 fast-check properties (300, 100, 100 runs) in the new `test/hypertalk/lexmask.property.test.ts`, driven by the new generator `test/hypertalk/helpers/lexMask.ts`. Suite: 18 failed (all new), 302 passed; typecheck passes.
- Kiro: Property 1 (Bug Condition) from the bugfix design, requirements 1.1–1.4 and 2.1–2.4 (hypertalk-interpreter R12.3); property-based tests whose generator self-checks pass while the bug check fails; the tech steering rule that errors name their script line; the PostTaskExec hook that wrote this entry.
- Why it matters: every counterexample matched the predicted line and column, which confirms the root cause (the early return in `parseUnguarded`) before any source code changes.

## lexer-error-masks-parse-error-fix, task 2: Write preservation property tests (BEFORE implementing the fix)
- Done: 14 new tests that record today's behavior and pass on the unfixed code. 11 parser unit tests (lexer error first, a rule that needs the broken token, a handler or `if` still open at the lexer error, only the first of three lexer errors, the `=` and quote hints), 1 `openCard` navigation test, and 2 fast-check properties in `test/hypertalk/lexmask.property.test.ts`: `lexerErrorFirstArb` (300 runs) and a mutant invariant (500 runs). New `NEEDS_TOKEN_AT_L` table and `lexerErrorFirstArb` in `test/hypertalk/helpers/lexMask.ts`. Suite: 334 passed, 0 failed; typecheck passes.
- Kiro: Property 2 (Preservation) from the bugfix design, requirements 3.1–3.11; observation-first property tests; the tests-green PreTaskExec gate, which blocked this task until task 1's 18 exploration tests were marked `it.fails`.
- Why it matters: the fix in task 3 now has to keep every script outside the bug condition giving exactly the error it gives today.

## lexer-error-masks-parse-error-fix, task 3.1: Keep the tokens the lexer read before its first error
- Done: `src/hypertalk/lexer.ts` gains the exported `LexPrefix` and `tokenizeUntilError(source)`, which returns the tokens read before the first error (no eof) plus that error; `tokenize` is now a two-line wrapper with the same results. No rule or message changed, and `index.ts` does not export the new function. 3 unit tests in `test/hypertalk/lexer.test.ts` and 1 fast-check property (1,000 runs) in `test/hypertalk/lexer.property.test.ts` tie `tokenizeUntilError` to `tokenize` and to `textBefore`. Suite: 338 passed, 0 failed; typecheck passes.
- Kiro: requirements 3.5, 3.7, 3.8 and 3.9 (lexer behavior unchanged); root cause 2 from the bugfix design; the tests-green gate, which still passes because task 1's tests stay marked `it.fails` until the parser changes.
- Why it matters: the parser can now see the tokens before a lexer error, which task 3.2 needs to report an earlier parse error.

## lexer-error-masks-parse-error-fix, task 3.2: Run the parser over the tokens before the lexer error
- Done: `src/hypertalk/parser.ts` (30 lines, no grammar rule touched) drops the early return in `parseUnguarded`, passes the lexer error into `Parser`, and `peek` throws that error when a rule reads past the tokens before it. A new `position()` keeps the internal-error catch from throwing. No message text changed. The `.fails` markers on task 1's 18 tests were removed by reverse-applying commit 02826fb. Suite: 338 passed, 0 failed, with all 18 task 1 tests passing as normal tests; typecheck passes.
- Kiro: Property 1 (Bug Condition) now holds and Property 2 (Preservation) still holds, covering requirements 2.1–2.4 and 3.1–3.6, 3.10; root causes 1 and 3 from the bugfix design; the tests-green gate, which is green again without markers.
- Why it matters: `put 1 into` above an unclosed string now reports line 2, the line the back of the card should point at.

## lexer-error-masks-parse-error-fix, task 3.3: Describe the new rule in the interpreter design
- Done: 2 edits to `.kiro/specs/hypertalk-interpreter/design.md`: the `lexer.ts` module line names the internal `tokenizeUntilError(source)`, and a new Parser bullet explains that the parser runs over the tokens before a lexer error, a parse error found before it wins (R12.3), and an `on` or `if` still open there is not reported. No code changed; suite still 338 passed.
- Kiro: requirements 2.1–2.3 and 3.4; the interpreter spec's design document, kept in step with the code; `validate_spec_format`, which reported the same 5 pre-existing issues before and after.
- Why it matters: the interpreter spec now states the rule the code follows, so a later change to the parser starts from the right description.

## lexer-error-masks-parse-error-fix, task 3.4: Verify the bug condition exploration tests now pass
- Done: re-ran task 1's 18 tests unchanged; all 18 pass (6 files, 173 tests passed). No `.fails` marker is left. The mutant count went from 0 to 74 of 135 lexer-error mutants (54.8%) reporting a parse error found before the lexer error, as the design predicted. No file changed except the PBT status in `tasks.meta.json`.
- Kiro: Property 1 (Expected Behavior), requirements 2.1–2.4; the same property-based tests that failed in task 1 now pass, with their PBT status set to passed; the `x = 1` decision from design review is pinned by one of them.
- Why it matters: the tests that proved the bug now prove the fix, with no edits between the two runs other than removing the temporary markers.
