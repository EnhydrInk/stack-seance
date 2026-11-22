# Kiro log

## lexer-error-masks-parse-error-fix, task 1: Write bug condition exploration tests
- Done: 18 new tests that encode the fix and fail on the unfixed code, as intended. 7 parser unit tests (Repros 1–3, Repro 1 with `\r\n`, `x = 1`, a column-1 lexer error, two handlers), runtime, `openCard` navigation and public `parse` tests, a mutant count (0 of 135 lexer-error mutants report a parse error today), and 3 fast-check properties (300, 100, 100 runs) in the new `test/hypertalk/lexmask.property.test.ts`, driven by the new generator `test/hypertalk/helpers/lexMask.ts`. Suite: 18 failed (all new), 302 passed; typecheck passes.
- Kiro: Property 1 (Bug Condition) from the bugfix design, requirements 1.1–1.4 and 2.1–2.4 (hypertalk-interpreter R12.3); property-based tests whose generator self-checks pass while the bug check fails; the tech steering rule that errors name their script line; the PostTaskExec hook that wrote this entry.
- Why it matters: every counterexample matched the predicted line and column, which confirms the root cause (the early return in `parseUnguarded`) before any source code changes.

## lexer-error-masks-parse-error-fix, task 2: Write preservation property tests (BEFORE implementing the fix)
- Done: 14 new tests that record today's behavior and pass on the unfixed code. 11 parser unit tests (lexer error first, a rule that needs the broken token, a handler or `if` still open at the lexer error, only the first of three lexer errors, the `=` and quote hints), 1 `openCard` navigation test, and 2 fast-check properties in `test/hypertalk/lexmask.property.test.ts`: `lexerErrorFirstArb` (300 runs) and a mutant invariant (500 runs). New `NEEDS_TOKEN_AT_L` table and `lexerErrorFirstArb` in `test/hypertalk/helpers/lexMask.ts`. Suite: 334 passed, 0 failed; typecheck passes.
- Kiro: Property 2 (Preservation) from the bugfix design, requirements 3.1–3.11; observation-first property tests; the tests-green PreTaskExec gate, which blocked this task until task 1's 18 exploration tests were marked `it.fails`.
- Why it matters: the fix in task 3 now has to keep every script outside the bug condition giving exactly the error it gives today.
