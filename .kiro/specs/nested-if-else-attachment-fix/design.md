# Nested If Else Attachment Fix Bugfix Design

## Overview

Inside a block `if`, the parser gives an `else`, `else if … then` or `end if` line that comes directly after a one-line `if` to the enclosing block `if`. The one-line `if` node looks the same as a block `if` once it is parsed (R9.3), so `blockIf()` cannot tell what it is closing. In Repro 1 the `answer` ends up in the outer `else` and runs when it should not. In Repro 2 the stray `end if` closes the outer `if` early, and the error lands on the later, correct `end if`.

The fix stays inside `src/hypertalk/parser.ts`. The parser remembers which `IfStmt` nodes it parsed in the one-line form. At the end of each block it checks the block's last statement:

- An `else` (bare or `else if`) after a one-line `if` without its own `else` is a syntax error on that `else` (2.1, 2.3).
- An `end if` after a one-line `if` is still accepted, but the parser records it. If the handler later reaches an unmatched `else` or `end if` that does not itself follow a one-line `if`, the error names the last recorded `end if` (2.4).

Nothing else in the parser changes. The syntax tree, printer, runtime, lexer and public API stay as they are.

The test renderer `renderScript` can write exactly the shape the fix rejects, so it changes too: it never writes a one-line `if` without `else` as the last command before an `else` or `else if` line.

## Glossary

- **Bug_Condition (C)**: A script in which the original parser reaches an `else` line directly after a one-line `if` without its own `else` while a block `if` is open (2.1, 2.3), or stops at an unmatched `else`/`end if` after an earlier `end if` in the same handler closed a block `if` directly after a one-line `if` (2.4). Formalised as `isBugCondition` below.
- **Property (P)**: The result the fixed parser must give for scripts in C: a syntax error on the `else` (2.1, 2.3) or on the stray `end if` (2.4), with the new messages. Formalised as `expectedBehavior` below.
- **Preservation**: For every script not in C, the fixed parser returns the same `ParseResult` as the original: the same tree with the same positions, or the same error with the same line, column and message (3.1 to 3.11).
- **F / F'**: `parseUnguarded` before and after the fix. `parse` and `runHandler` follow, since both call it.
- **One-line `if`**: `if <condition> then <statement> [else <statement>]` on one line (R9.2), parsed by `oneLineIf()` in `src/hypertalk/parser.ts` (line 428).
- **Block**: The statements returned by one call of `block()` (line 180): the body of a handler, the `then` part of a block `if` or an `else if` link, or an `else` part. `block()` stops at eof, or at `else` or `end` at the start of a line.
- **Trailing one-line `if`**: The last statement of a block, when it was parsed in the one-line form. The `else`, `else if` or `end` line that ends the block comes **directly after** it. `block()` skips blank and comment-only lines, so they do not count (the lexer keeps a comment's newline and drops the rest).
- **Unmatched `else` / `end if`**: One that reaches `handler()` (line 147) because no block `if` is open.
- **Stray `end if`**: An `end if` that closes a block `if` directly after a trailing one-line `if`. It is valid on its own (3.3) and only reported under 2.4.
- **`blockIf()`** (line 389): Parses `if c then` / … / `{else if c then / …}` / `[else / …]` / `end if`. `head` is the token of the first `if`.
- **`Renderer.ifStmt` / `Renderer.block`**: The test renderer in `test/hypertalk/helpers/arbitraries.ts` (lines 238 to 277) that writes generated trees as source with random case, spacing, comments and one-line forms.

## Bug Details

### Bug Condition

The bug shows up when a block inside a block `if` ends with a one-line `if`, and the next line is `else`, `else if … then` or `end if`. `block()` returns the statements and stops at that line. `blockIf()` then consumes the line as its own, because the one-line `if` is just another `IfStmt` in the list and cannot be told apart. The check that rejects these lines exists only in `handler()`, so it fires only when no block `if` is open. `handler()` also keeps no record of earlier `end if`s, so in Repro 2 it can only report the `end if` it is looking at.

**Formal Specification:**
```
-- F is the original parser. reached(s) is the list of tokens F reads, in order,
-- up to and including the token where it reports its first syntax error (eof if s parses).
-- For a token k that ends a block (an "else" or "end" at the start of a line):
--   trailing(k)      = the last statement of that block, or none if the block is empty
--   openBlockIfs(k)  = how many block ifs are open when F reaches k
--   oneLine(stmt)    = stmt was parsed by oneLineIf()

FUNCTION isBugCondition(s)
  INPUT: s of type string (the source of one script)
  OUTPUT: boolean

  RETURN elseClauseHolds(s) OR endIfClauseHolds(s)
END FUNCTION

FUNCTION elseClauseHolds(s)                                         -- 2.1, 2.3
  RETURN EXISTS k IN reached(s) WHERE
           k is the word "else" at the start of a line              -- bare else or else if
       AND openBlockIfs(k) > 0
       AND trailing(k) is not none AND oneLine(trailing(k))
       AND trailing(k).else = []
END FUNCTION

FUNCTION endIfClauseHolds(s)                                        -- 2.4
  u := the token where F(s) reports its first syntax error
  RETURN F(s) fails at u
     AND u starts an "else" or "end if" line AND openBlockIfs(u) = 0    -- unmatched
     AND NOT (trailing(u) is not none AND oneLine(trailing(u)))         -- excluded by 3.4
     AND EXISTS e IN reached(s) WHERE
           e comes before u in the same handler
       AND e starts an "end if" line AND openBlockIfs(e) > 0
       AND trailing(e) is not none AND oneLine(trailing(e))            -- a stray end if
END FUNCTION
```

The two clauses cannot point at the same token: `k` has a block `if` open and `u` does not. If both hold, `k` comes first, because `reached(s)` ends at `u`.

### Examples

Observed on the unfixed parser at commit `edef939` (`parse` run with `vite-node`):

- **Repro 1** (`else` after a one-line `if`, 2.1, 2.2): F accepts it. The tree puts `answer "The door is locked."` in the `else` of the `if` on line 2. With field "key" = "iron" and field "door" = "open" the dialog appears. Expected: syntax error at line 4, column 5. Running it makes no host calls.
- **`else if` after a one-line `if`** (2.3): `if a then` / `if b then go next card` / `else if c then` / `howl` / `end if`. F accepts it and makes `else if c` a link of the outer chain. Expected: syntax error on the `else` of line 4.
- **Second `else` in an `else` part** (2.1): `if a then` / `howl` / `else` / `if b then go next card` / `else` / `answer "x"` / `end if`. F reports `this "if" already has an "else"` at line 6, column 3. Expected: the same line and column with the 2.1 message.
- **Blank and comment lines in between** (glossary, 2.1): Repro 1 with a blank line and `-- otherwise` before the `else`. F accepts it. Expected: syntax error on the `else`.
- **Repro 2** (stray `end if`, 2.4): F reports `"end if" without a matching "if" …` at line 6, column 3. Expected: line 4, column 5, naming the `if` on line 2.
- **Stray `end if`, then an unmatched `else`** (2.4): `if a then` / `if b then go next card` / `end if` / `answer "x"` / `else` / `answer "y"` / `end if`. F reports the `else` at line 6. Expected: line 4.
- **Several stray `end if`s** (2.4, "the last one"): `if a then` / `if b then howl` / `end if` / `if c then` / `if d then go next card` / `end if` / `end if` (lines 2 to 8). F reports line 8. Expected: line 7, the last `end if` that came directly after a one-line `if`.
- **Edge, unmatched line after a top-level one-line `if`** (3.4): Repro 2 with line 5 replaced by `if c then go prev card`. F reports line 6 with the current message. Expected: unchanged, even though line 4 is a stray `end if`.
- **Edge, stray `end if` in another handler** (3.5): `on openCard` / `if a then` / `if b then howl` / `end if` / `end openCard`, then `on mouseUp` / `howl` / `end if` / `end mouseUp`. F reports line 8. Expected: unchanged, because the stray `end if` on line 4 is in a different handler.
- **Edge, one-line `if` with its own `else`** (3.2): `if a then` / `if b then howl else go next card` / `else` / `answer "x"` / `end if`. F accepts it and attaches the `else` to the outer `if`. Expected: unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A block that ends with any statement other than a one-line `if` (a command, or a block `if` closed by its own `end if`) still hands the following `else`, `else if … then` or `end if` to the enclosing block `if`, with the same tree and positions (3.1).
- A block that ends with a one-line `if` with its own same-line `else` still hands the following `else` or `else if … then` to the enclosing block `if` (3.2). In an `else` part this is still `this "if" already has an "else"`.
- An `end if` directly after a one-line `if` still closes the enclosing block `if` with the same tree when no unmatched `else` or `end if` follows in the handler (3.3). This includes the R9.3 test at `test/hypertalk/parser.test.ts` lines 325 to 328.
- Unmatched `else` and `end if` lines directly after a one-line `if`, such as the tests at lines 336 to 341 and 350 to 354 of `test/hypertalk/parser.test.ts`, keep their line, column and current message (3.4).
- Unmatched `else` and `end if` lines with no earlier stray `end if` in the same handler keep their line, column and message (3.5).
- One-line `if … then … else …` on a single line, at the top level or inside any block, parses to the same tree (3.6).
- Block `else if` chains give the same nested tree and positions (3.7).
- Every other `if` error keeps its line, column and message: a missing `end if` (R9.5), a second `else`, a command on the same line as `else` or `else if … then`, `else if` in the one-line form, and an `if` inside a one-line `if` (3.8).
- Scripts that parse today and are not in C parse to the same tree, and running them makes the same host calls with the same result (3.9).
- `parse` returns at most the first error, never throws, and reports lines that `clampLine` does not have to change (3.10, R12.3, R12.4, P4).
- `parse(print(ast))` gives back `ast` without positions (3.11, P1).

**Scope:**
All inputs that do NOT involve a trailing one-line `if` before an `else` line inside a block `if`, or an unmatched line after a stray `end if`, should be completely unaffected by this fix. This includes:
- Every script whose blocks end with commands or block `if`s
- Scripts whose one-line `if`s are followed by a command, by `end <handler>`, or by an `end if` with nothing unmatched after it
- Every script the printer writes, since the printer never writes the one-line form
- Lexer errors and every syntax error not listed in 2.1, 2.3 and 2.4
- The runtime's handling of every tree the parser produces

## Hypothesized Root Cause

Based on the code and the observed results above, the causes are:

1. **The one-line form is invisible after parsing**: `oneLineIf()` returns the same `IfStmt` shape as `blockIf()` (R9.3, by design), and the tree records no form. When `block()` returns, no code can ask whether its last statement was a one-line `if`.
   - `block()` stops at `else` or `end` without looking at what came before.
   - `blockIf()` consumes any `else`, `else if` or `end if` that follows its block (lines 389 to 425).

2. **The "one-line if keeps its else on the same line" check lives only in `handler()`**: The two messages at lines 164 and 168 fire only when the handler body ends at `else` or `end if`, which means no block `if` is open. Inside a block `if`, nothing rejects the line.

3. **`handler()` has no memory of earlier `end if`s**: When it reaches an unmatched `end if` or `else`, it can only report that token. The `end if` that actually caused the mismatch was consumed earlier by `blockIf()`, and nothing recorded it.

4. **Ruled out**: The lexer keeps newlines and drops comments, so "directly after" already works the same across blank and comment lines. The runtime runs the tree it is given, and in Repro 1 that tree already has the `answer` in the outer `else`. The printer always writes the block form (`printIf`, "Always the block form"), so it never writes the shape.

## Correctness Properties

Property 1: Bug Condition - Else and stray end if after a one-line if inside a block if

_For any_ script source `s` where the bug condition holds (isBugCondition returns true), the fixed parser SHALL return `{ ok: false }` with a syntax error. When `elseClauseHolds(s)`, the error is on the line and column of the first such `else`, with the message `"else" right after a one-line if; a one-line if keeps its else on the same line (or write the if in block form with "end if")`. Otherwise the error is on the line and column of the `end` of the last stray `end if` before the unmatched line, with the message `"end if" right after a one-line if closes the "if" on line N; a one-line if has no "end if"`, where N is the line of the `if` that this `end if` closed. Running such a script with `runHandler` SHALL return the same error and SHALL make no host call.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Every other script parses and runs as before

_For any_ script source `s` where the bug condition does NOT hold (isBugCondition returns false), the fixed parser SHALL produce the same result as the original parser, preserving the same tree with the same positions for accepted scripts, the same line, column and message for rejected ones, the first-error-only and never-throw guarantees, the round trip through the printer, and the same host calls and result when the script is run.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/hypertalk/parser.ts`

**Function**: `Parser.oneLineIf`, `Parser.blockIf`, `Parser.handler`, plus two new private helpers

**Specific Changes**:
1. **Remember one-line `if`s**: Add `private readonly oneLineIfs = new WeakSet<IfStmt>()`. `oneLineIf()` adds the node it builds before returning it. Add a helper:
   ```ts
   /** The last statement of `block` if it was written as a one-line if. */
   private trailingOneLineIf(block: Stmt[]): IfStmt | undefined {
     const last = block[block.length - 1];
     return last?.t === 'if' && this.oneLineIfs.has(last) ? last : undefined;
   }
   ```
   The tree type does not change, so R9.3 (both forms give the same tree) and `stripPositions` stay as they are.

2. **Reject an `else` after a one-line `if` without `else` (2.1, 2.3)**: In `blockIf()`, keep a variable `ended` for the block that just ended: `root.then` first, then each link's `then`, then `tail.else`. Before the `else` token is consumed, call:
   ```ts
   private rejectElseAfterOneLineIf(ended: Stmt[]): void {
     const t = this.trailingOneLineIf(ended);
     if (t && t.else.length === 0) {
       this.fail(this.current(), '"else" right after a one-line if; a one-line if keeps its else on the same line (or write the if in block form with "end if")');
     }
   }
   ```
   There are two call sites. The first is in the loop, just before `this.advance()` past `else`, so it covers both a bare `else` and `else if`. The second is after the `else` part, just before the existing `this "if" already has an "else"` failure. The check runs before `else` is consumed, so the error is on the `else` token. A one-line `if` with its own `else` passes through unchanged (3.2).

3. **Record stray `end if`s (2.4)**: Add `private strayEndIf: { end: Token; closes: Token } | undefined`, reset to `undefined` at the start of `handler()` next to `this.handlerName = name`. In `blockIf()`, at both places that consume `end if`, record `{ end: this.current(), closes: head }` when `trailingOneLineIf(ended)` is set, with or without its own `else`. Later records overwrite earlier ones, so the last one wins. Nothing fails here, so 3.3 holds.

4. **Report the stray `end if` at the unmatched line (2.4, 3.4, 3.5)**: In `handler()`, after `const body = this.block()` and the eof check, and before the existing `else` check:
   ```ts
   const unmatched = this.atWord('else') || (this.atWord('end') && this.atWord('if', 1));
   if (unmatched && this.strayEndIf && !this.trailingOneLineIf(body)) {
     const { end, closes } = this.strayEndIf;
     this.fail(end, `"end if" right after a one-line if closes the "if" on line ${closes.line}; a one-line if has no "end if"`);
   }
   ```
   When the unmatched line follows a top-level one-line `if`, or no stray `end if` was recorded in this handler, the existing code runs unchanged with its current messages (3.4, 3.5). The reported line is a real token's line, so it is inside the script and `clampLine` never changes it (3.10).

5. **Leave everything else alone**: `ast.ts`, `printer.ts`, `runtime.ts`, `lexer.ts` and `index.ts` do not change. The runtime parses before it runs anything, so 2.2 follows from the parser change.

**Round trip (P1), confirmed**: `printIf` in `src/hypertalk/printer.ts` always writes the block form, so printed text contains no one-line `if`. Both new checks need a trailing one-line `if`, so neither can fire on printed text, and `print(parse(print(ast)))` is unaffected. The P1 tests that parse `renderScript` output depend on the renderer change below.

**File**: `test/hypertalk/helpers/arbitraries.ts`

**Function**: `Renderer.block`, `Renderer.ifStmt`, `RenderOptions.ifForm`

**Specific Changes**:
1. **Pass down whether an `else` line follows**: `block(stmts, depth, beforeElse = false)` passes `beforeElse` to `ifStmt` for its last statement only.

2. **Never write the rejected shape**: In `ifStmt(s, depth, beforeElse = false)`, the one-line form is allowed only when `fits && !(beforeElse && s.else.length === 0)`. A one-line `if` with its own `else` before an `else` line is still written sometimes, so 3.2 stays covered. A one-line `if` before `end if` is also still written, so 3.3 stays covered.

3. **Choose the continuation before writing the block**: The loop now decides `else if` (the `chance(0.6)` draw) and `else` (the `chance(0.15)` draw for an explicit empty `else`) before it writes the block that comes before them, then calls `this.block(body, depth + 1, isElseIf || isElse)`. Today these draws happen after the block is written. The same seed still gives the same text, but not the text it gave before the change. No test pins rendered text. The trees come from fast-check, not from the renderer's random stream, so session trees and their runs do not change.

4. **Document the exception**: The `ifForm` comment says that `'oneLine'` still writes the block form for an `if` without `else` that is the last command before an `else` or `else if` line, because the parser rejects the one-line form there.

**File**: `.kiro/specs/hypertalk-interpreter/design.md`, "Parser", line 153

**Specific Changes**:
1. **Note the rule inside block `if`s**: Extend the bullet on single-line `if`. Inside a block `if`, an `else` or `else if` line right after a one-line `if` without its own `else` is a syntax error on that `else`. An `end if` right after a one-line `if` closes the enclosing block `if`. When a later `else` or `end if` in the same handler is then unmatched, the error names that `end if`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Preservation tests are written and run green on the unfixed parser before the fix, then run again after it.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write parser and runtime tests that assert the expected errors from Property 1 for the examples in "Bug Details". Run these tests on the UNFIXED code to observe failures and understand the root cause. Also count how often `renderScript` writes the rejected shape, to confirm the renderer has to change.

**Test Cases**:
1. **Repro 1 parse**: Expect a syntax error at line 4, column 5 (will fail on unfixed code: accepted).
2. **Repro 1 run**: `runHandler` with field "key" = "iron" and field "door" = "open". Expect the syntax error and an empty host log (will fail on unfixed code: the dialog appears).
3. **`else if` after a one-line `if`**: Expect an error on the `else` (will fail on unfixed code: accepted as a chain link).
4. **Second `else` in an `else` part**: Expect the 2.1 message at line 6, column 3 (will fail on unfixed code: `this "if" already has an "else"`).
5. **Repro 2**: Expect line 4, column 5 (will fail on unfixed code: line 6).
6. **Several stray `end if`s**: Expect line 7 (will fail on unfixed code: line 8).
7. **Stray `end if`, then an unmatched `else`**: Expect line 4 (will fail on unfixed code: line 6).
8. **Blank and comment lines before the `else`**: Expect an error on the `else` (will fail on unfixed code: accepted).

**Expected Counterexamples**:
- Cases 1 to 3 and 8 parse without an error, and the tree attaches the `else` part to the outer `if`. This was observed for Repro 1, the `else if` case and the comment case.
- Cases 4 to 7 report the later line or the old message: line 6 `this "if" already has an "else"`, Repro 2 line 6, several strays line 8, and the stray-then-`else` case line 6. All were observed.
- Renderer: in a sample of 2000 `scriptArb` trees rendered with random seeds, 124 sources had a one-line `if` without `else` directly before an `else` or `else if` line, and 100 had one directly before `end if`. In the P5 session sample (`sessionArb`, 1000 runs, seed 11), 6 run scripts had the rejected shape. With only the parser fixed, the P1 rendered-source tests would fail. The P5 generator check would also fail, because it expects no `run script syntax` errors.
- Possible causes, as hypothesised: the form of the `if` is lost after parsing, the check exists only in `handler()`, and `handler()` keeps no record of earlier `end if`s.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FUNCTION expectedBehavior(s, result)
  INPUT: s of type string, result of type ParseResult
  OUTPUT: boolean

  IF elseClauseHolds(s) THEN
    k := the first token that satisfies elseClauseHolds
    RETURN result = { ok: false, error: { kind: 'syntax', line: k.line, column: k.column,
             message: '"else" right after a one-line if; a one-line if keeps its else on the same line (or write the if in block form with "end if")' } }
  ELSE                                                  -- endIfClauseHolds(s)
    e := the last stray "end if" token before u in u's handler
    h := the "if" token of the block if that e closed (the first if of its chain)
    RETURN result = { ok: false, error: { kind: 'syntax', line: e.line, column: e.column,
             message: '"end if" right after a one-line if closes the "if" on line ' & h.line
                      & '; a one-line if has no "end if"' } }
END FUNCTION

FOR ALL s WHERE isBugCondition(s) DO
  result := parseUnguarded_fixed(s)
  ASSERT expectedBehavior(s, result)
  ASSERT parse_fixed(s) = result
  run := runHandler_fixed(s, handlerOf(s), ctx with FakeHost)
  ASSERT run = result AND FakeHost.log = []
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL s WHERE NOT isBugCondition(s) DO
  ASSERT parseUnguarded_original(s) = parseUnguarded_fixed(s)
END FOR
```

The committed tests express `parseUnguarded_original(s)` as an expected result that the generator builds alongside the source. These tests are run on the unfixed parser first, where they must pass. The committed suite does not keep a frozen copy of the old parser, because any later parser change would break that copy.

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for every shape next to the bug (`else` after a command, a block `if` or a one-line `if` with `else`, valid stray `end if`s, unmatched lines after top-level one-line `if`s, unmatched lines with no stray `end if` in the handler), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Attach after other statements (3.1, 3.7)**: Observe that `else` and `else if` after a command or a closed block `if` attach to the enclosing `if` on unfixed code, then write a test to verify this continues after the fix.
2. **Attach after a one-line `if` with `else` (3.2)**: Observe that the `else` attaches on unfixed code, then write a test to verify this continues after the fix.
3. **Valid stray `end if` (3.3)**: Observe that `if a then` / `if b then go next card` / `end if` and the R9.3 nesting test are accepted with their trees on unfixed code, then write a test to verify this continues after the fix.
4. **Unmatched lines keep their report (3.4, 3.5)**: Observe that the top-level examples at `parser.test.ts` lines 336 to 341 and 350 to 354, the "edge" examples above, and an unmatched line after a stray `end if` in another handler report their own line on unfixed code, then write a test to verify this continues after the fix.
5. **Rendered scripts (3.6, 3.9, 3.11)**: Observe that the existing P1 round-trip tests pass on unfixed code, then keep them passing after the renderer and parser changes.

### Unit Tests

- In `test/hypertalk/parser.test.ts`, a new `describe` block for this fix. It covers each "Bug Details" example with the exact line, column and message: Repro 1, `else if`, a second `else` in an `else` part, blank and comment lines in between, Repro 2, a stray `end if` followed by an unmatched `else`, several stray `end if`s (the last one is reported), and a stray `end if` that closes an inner block `if` two levels deep.
- The same block covers the preservation edges: a one-line `if` with its own `else` before `else` (3.2), a valid stray `end if` (3.3), an unmatched line after a top-level one-line `if` with a stray `end if` earlier (3.4), and an unmatched line whose only stray `end if` is in an earlier handler (3.5).
- The existing tests at lines 325 to 328, 336 to 341 and 350 to 354 stay unchanged and must pass (3.3, 3.4).
- In `test/hypertalk/runtime.statements.test.ts`: Repro 1 through `runHandler` with the fake host returns the syntax error at line 4. The host log stays empty, the current card is unchanged and no dialog is shown (2.2).

### Property-Based Tests

- **Shape generator** in a new `test/hypertalk/helpers/ifShapes.ts`. It builds the source line by line, with random indentation, keyword case, and blank or comment lines between code lines. It builds the expected result alongside, from a small vocabulary of commands and conditions whose trees are known. It exports `bugShapeArb` (C holds) and `preservedShapeArb` (C does not hold), so neither property discards inputs.
  - Family A, a block followed by an `else` line: an enclosing block `if` E, 0 to 2 levels deep in other block `if`s. The block that ends is E's `then` part, an `else if` link, or E's `else` part, and its last statement T is a command, a closed block `if`, a one-line `if`, or a one-line `if` with `else`. The follower is `else` or `else if c then`. If T is a one-line `if` without `else`, C holds and the expected result is the 2.1 error on the follower. If the block is an `else` part, the expected result is `this "if" already has an "else"` on the follower. Otherwise the expected result is the tree with the follower attached to E.
  - Family B, stray `end if`s followed by an unmatched line: 1 to 3 block `if`s at handler level, each possibly wrapped in 1 or 2 more block `if`s. The line before each `end if` is a command, a closed block `if`, or a one-line `if` with or without `else`. Next comes a handler-level line P (none, a command, a block `if`, or a one-line `if`), then an unmatched `end if`, `else` or `else if x then`. If some `end if` came directly after a one-line `if` and P is not a one-line `if`, C holds and the expected result is the 2.4 error on the last such `end if`, naming its `if`'s line. Otherwise the expected result is the current error on the unmatched line (3.4, 3.5). Some cases add an earlier handler that holds a valid stray `end if`.
  - Family C is Family B without the unmatched line. The script is valid and the expected result is the tree (3.3).
- **Property 1** in a new `test/hypertalk/nestedif.property.test.ts`: for `bugShapeArb`, `parseUnguarded` returns exactly the expected error, `parse` returns the same value, and `runHandler` on the shape's handler returns that error with an empty fake host log (300 runs).
- **Property 2** in the same file: for `preservedShapeArb`, `parseUnguarded` returns exactly the expected result, with the tree compared through `stripPositions` and errors compared on line, column and message (300 runs). This test is written and run on the unfixed parser first.
- **Renderer shape check** in the "generator coverage" block of `test/hypertalk/roundtrip.property.test.ts`: tokenize 2000 renderings of `scriptArb` and 1000 `sessionArb` scripts. No source has a one-line `if` without `else` directly before an `else` line. The `scriptArb` renderings still include a one-line `if` with `else` before an `else` line (3.2) and a one-line `if` before `end if` (3.3).
- **Existing properties stay green**: P1 round trip (3.6, 3.9, 3.11), P4 error lines on mutants, including inserted `else` and `end if` junk lines (3.10), P3 determinism and P5 runtime error lines on sessions, and the generator threshold tests for the mutation and session samples.

### Integration Tests

- **Full suite and types**: `npm test` (`vitest --run`) and `npm run typecheck` pass with the parser, renderer and new tests in place.
- **Run path**: The runtime test above sends Repro 1 through `runHandler`, the entry point the card UI uses. It checks that the back of the card would get line 4, and that the card does nothing.
- **One-off differential check, not committed**: Extract the old parser with `git show edef939:src/hypertalk/parser.ts` into a temporary file outside the repo, with its imports pointed at `src/hypertalk`, and run both parsers with `vite-node` on about 20000 sources: P4 mutants, rendered `scriptArb` scripts and both shape families. Wherever the results differ, the fixed result must carry one of the two new messages, and its line must be no later than the old error's line (or the old parse succeeded). For the shape families, the results must differ exactly on the inputs the generator marks as C. This checks Property 2 on inputs the shape generator does not reach.
