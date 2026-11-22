# Kiro log

## lexer-error-masks-parse-error-fix, task 1: Write bug condition exploration tests
- Done: 18 new tests that encode the fix and fail on the unfixed code, as intended. 7 parser unit tests (Repros 1–3, Repro 1 with `\r\n`, `x = 1`, a column-1 lexer error, two handlers), runtime, `openCard` navigation and public `parse` tests, a mutant count (0 of 135 lexer-error mutants report a parse error today), and 3 fast-check properties (300, 100, 100 runs) in the new `test/hypertalk/lexmask.property.test.ts`, driven by the new generator `test/hypertalk/helpers/lexMask.ts`. Suite: 18 failed (all new), 302 passed; typecheck passes.
- Kiro: Property 1 (Bug Condition) from the bugfix design, requirements 1.1–1.4 and 2.1–2.4 (hypertalk-interpreter R12.3); property-based tests whose generator self-checks pass while the bug check fails; the tech steering rule that errors name their script line; the PostTaskExec hook that wrote this entry.
- Why it matters: every counterexample matched the predicted line and column, which confirms the root cause (the early return in `parseUnguarded`) before any source code changes.
