# Lexer Error Masks Parse Error Fix Bugfix Design

## Overview

`parseUnguarded` tokenizes the whole script before it parses anything, and returns the lexer's error as soon as the lexer fails (`src/hypertalk/parser.ts` lines 23 to 24). The parser never runs, so a parse error earlier in the script is never seen. `runHandler` parses through the same function (`src/hypertalk/runtime.ts` line 72), so running a handler, including another card's `openCard`, reports the same later line.

The fix keeps the lexer's rules and messages and changes only which error is reported:

- The lexer gets an internal entry point, `tokenizeUntilError`, that returns the tokens it read before its first error together with that error. `tokenize` becomes a two-line wrapper around it and returns exactly what it returns today (3.7).
- The parser runs over those tokens. When it tries to read past the last of them, it is reading the text at the lexer error, so it stops and reports the lexer error. This is one check in `Parser.peek`, the single place every grammar rule reads a token through.

A parse error the parser raises while it is still inside the tokens before the lexer error wins (2.1 to 2.3). Everything that needs the text at the lexer error reports the lexer error as today: the next token a rule needs (3.3), and the end-of-script checks for an unclosed `on` or `if` (3.4), because the token list has no eof to find. The runtime, printer, AST, token types and public API do not change. The lexer does not recover past its first error.

A scratch copy of this fix, built outside the repo, gives the expected result for every repro and every 3.x example in `bugfix.md`, and the existing 302 tests pass with it swapped in.

## Glossary

- **Bug_Condition (C)**: A script with a lexer error in which the parser, reading only the tokens before that error, raises a parse error. Formalised as `isBugCondition` below.
- **Property (P)**: For a script in C, the result is that parse error, with the line, column and message the parser gives for it in a script without the lexer error. Running a handler of the script returns the same error and runs nothing. Formalised as `expectedBehavior` below.
- **Preservation**: For every script not in C, `parse`, `parseUnguarded`, `runHandler` and `tokenize` give the same result as before the fix (3.1 to 3.11).
- **F / F'**: `parseUnguarded` before and after the fix. `parse` and `runHandler` follow, since both call it.
- **L**: The first lexer error of a script, the error `tokenize` returns today. "Before L" compares line, then column.
- **before(s)**: The tokens the lexer reads before L, in order, with no eof. This is `tokenizeUntilError(s).tokens` after the fix.
- **Reading a token**: A grammar rule reads a token when it looks at it as the current token, looks one token ahead (`atWord('if', 1)` after `end`, `atWord('not', 1)` after `is`), or names its position in an error (`this.fail(this.current(), …)`). All of these go through `Parser.peek` (`src/hypertalk/parser.ts` line 75).
- **Reading past**: Reading a token after the last token in before(s). It means the rule needs the text at L.
- **Found before L**: A parse error the rules raise without reading past. This is the bugfix.md term, made exact.
- **textBefore(s, L)**: A test helper. It returns the part of the original source before L. It walks the source counting `\r\n` as one character, so the cut never splits a `\r\n` pair and the text is normalised only once, by the lexer. `normaliseLineBreaks` is not idempotent: `'\r\r\n'` becomes `'\r\n'`, and normalising again gives `'\n'`. Slicing the normalised text and lexing it again therefore moves positions. The scratch check hit this once in 20,000 random texts.
- **Clean twin**: A test helper. It is a generated script with each lexer-error span replaced by a valid text from the same table entry, for example `answer "unclosed` by `answer "unclosed"`. The twin has no lexer error, so `parseUnguarded(twin)` takes the code path that 3.1 keeps unchanged.
- **`tokenizeUntilError`**: The new internal lexer function in `src/hypertalk/lexer.ts`. It is not exported from `src/hypertalk/index.ts`, and neither is `tokenize`.
- **`run`**: The runtime's parse-then-execute function (`src/hypertalk/runtime.ts` line 70). Line 175 adds `scriptId` to an error from another card's `openCard`.

## Bug Details

### Bug Condition

The bug shows up when a script has a lexer error and the parser would find a parse error before reaching it. There are three causes. `parseUnguarded` returns the lexer's error before it builds a parser (lines 23 to 24). The lexer's `fail` throws away the tokens it already read (`src/hypertalk/lexer.ts` lines 21 to 24). And the parser has only one end marker, eof, so it cannot tell "the tokens stop at a lexer error" apart from "the script ends".

**Formal Specification:**
```
-- tokenize is the lexer; this fix does not change what it returns.
-- rules(toks) runs the parser's grammar rules over the token list toks and stops at the
-- first syntax error they raise. readsPast(toks) holds when rules(toks) reads a token
-- after the last one in toks before it raises an error. The end-of-script checks
-- ('"on …" is never closed', '"if" is never closed') need the token after the last one,
-- so in a token list without eof they always read past.

FUNCTION isBugCondition(s)
  INPUT: s of type string (the source of one script)
  OUTPUT: boolean

  lexed := tokenize(s)
  IF lexed.ok THEN RETURN false                -- no lexer error: F already reports the first parse error (3.1)
  toks := before(s)
  RETURN rules(toks) raises a syntax error
         AND NOT readsPast(toks)               -- the parse error is found before L (2.1, 2.2, 2.3)
END FUNCTION
```

For every `s` in C, F returns `{ ok: false, error: L }`, which is the defect. For a script with a lexer error that is not in C, F also returns L, and that is the correct result (3.2 to 3.5). So the fix must change F's result exactly on C.

Two facts follow from the definition, and the tests rely on them:

1. When C holds, the error `e` names a token in before(s), so `e` is before L.
2. When C holds, `F(textBefore(s, L))` returns `e`. That text lexes to before(s) followed by an eof. The rules read the same tokens in the same order and raise `e` before they reach the eof. The scratch check found no exception in 1,587 cases.

### Examples

The current results below were observed on the unfixed code at commit `edef939` by running `parse` with `vite-node`. The expected results were observed on the scratch copy of the fix.

- **Repro 1** (2.1): F gives line 3, column 10, `this string has no closing quote (") on this line`. Expected: line 2, column 13, `expected a variable name after "into"`. The parser decides this on the line break that ends line 2, which comes before L.
- **Repro 2** (2.2): F gives line 42, column 8, `unexpected character "="; use "is" to compare`. Expected: line 2, column 9, `expected next card, prev card, first card, last card or card … after "go"`.
- **Repro 3** (2.3): F gives line 2, column 12, the missing-quote message. Expected: line 2, column 7, `expected a value but found "into", which is a reserved word`.
- **Repro 1 with `\r\n`** (3.8): The same line and column as Repro 1, both before and after the fix.
- **Repro 1 as another card's `openCard`** (2.4): Card 1 runs `go to next card`, and card 2's script is Repro 1 with `on openCard` / `end openCard`. F gives line 3, column 10, scriptId `card-2`. Expected: line 2, column 13, scriptId `card-2`, and no statement of card 2's script runs.
- **Edge, the next token is the broken one** (3.3): `put 1 into "x` gives line 2, column 14, the missing-quote message, both before and after the fix. After `into`, `put` must look at the next token to choose between `field` and a variable name.
- **Edge, open constructs at L** (3.4): `on mouseUp` / `  if a then` / `    answer "x` / `end mouseUp` gives line 3, column 12. A script whose `on openCard` is on line 4, `  answer "x` on line 5 and `end openCard` on line 6 gives line 5, column 10. Both are unchanged, and neither reports a missing `end`.
- **Edge, the error would name the token at L**: In `answer "a" with "b" or "c" or "d" or "e`, the fourth `or` is enough to know the answer has too many buttons. But `answer can show at most 3 buttons` is reported at the next token, which is the broken string. The rule reads past, so the lexer error at line 2, column 40 is reported, as today. Because of this, every parse error that is reported names a position before L.
- **Edge, the first word is not a command**: `x = 1` alone on line 2 gives `unexpected character "="; use "is" to compare` at column 5 today. After the fix it gives `unknown command "x"` at column 3 on the same line, because `x` is rejected before the parser reads the `=`. This is the "first error from the top" rule chosen in the requirements phase. Decided: the user accepted this change at design review, with no special case for `=`, and a parser unit test pins it (tasks.md, task 1). The `=` hint still appears wherever a rule needs the token at the `=`, as in `if x = 1 then howl` or `put x = 1 into y`. `SYNTAX_ERROR_LINES` in `test/hypertalk/helpers/arbitraries.ts` contains `x = 1`, but its users check only the line, which stays the same.
- **Edge, the lexer error is at column 1**: `put 1 into` on line 2 and `#` alone on line 3 gives line 2, column 13. The line-break token of line 2 comes before L.
- **Edge, no tokens before L**: The script `=` gives line 1, column 1, the `=` message. The parser reads past at its first read.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A script with no lexer error gives the same tree with the same positions, or the same first parse error with the same line, column and message. Running it makes the same host calls and gives the same result (3.1). When the lexer succeeds, `tokenizeUntilError` returns the same token list as `tokenize`, ending with eof. `lexError` is then `undefined`, so `peek` takes its current branch.
- A lexer error with no parse error found before it is reported with the same line, column and message. This includes a lexer error on an earlier line than a parse error (3.2), a rule that needs the token at L (3.3), and a handler or block `if` that is still open at L, whether its `end` comes later or is missing (3.4).
- Only the first lexer error is reported when there are several (3.5). The lexer still stops at its first error.
- Every message, including the hints for `=`, curly quotes and single quotes, keeps its exact text (3.6). No message string changes.
- `tokenize` returns the same tokens or the same first error for every input (3.7).
- `\r\n` scripts give the same lines and columns as `\n` scripts, for lexer and parse errors alike (3.8). The lexer still normalises once, and the parser works only on token positions.
- Comments still hide characters that would be lexer errors, and `--` inside a string is still text (3.9). The lexer rules do not change, so comments produce no tokens and cannot be read past.
- `parse` and `parseUnguarded` return at most one error and never throw. The reported line is inside the script, and `clampLine` never changes it (3.10, P4). A parse error names a token before L, and L is a lexer position as today.
- A script that parses and then hits a runtime error still reports the first runtime error, stops, and keeps what was done before (3.11). The runtime does not change.

**Scope:**
All inputs that do NOT satisfy C should be completely unaffected by this fix. This includes:
- Every script the lexer accepts, which covers all scripts the printer writes and all rendered `scriptArb` scripts.
- Scripts whose first lexer error comes before any parse error, or where the parser needs the text at the first lexer error.
- Direct callers of `tokenize`: the lexer tests, and the source scan in `test/hypertalk/nonetwork.test.ts`, which only names it in a fixture.
- The runtime's handling of every tree the parser returns, and every runtime error.

## Hypothesized Root Cause

The requirements phase already found the cause, and the code and the scratch copy of the fix confirm it:

1. **The lexer's failure short-circuits parsing**: `parseUnguarded` calls `tokenize(source)` and runs `if (!lexed.ok) return lexed;` (lines 23 to 24) before it builds a `Parser`. Any lexer error anywhere wins.

2. **The lexer discards the tokens it read**: `fail` in `tokenize` (lines 21 to 24) returns only `{ ok: false, error }`. Even a caller that wanted to parse the start of the script has no tokens to parse.

3. **The parser has one end marker for two situations**: `peek` relies on the list ending with eof (line 76). The checks for `"on …" is never closed` (line 162) and `"if" is never closed` (line 390) fire on eof. Simply appending an eof to the tokens before L would give false "never closed" errors (3.4). It would also let the eof decide rules that need the text at L, such as `put 1 into "x` giving `expected a variable name after "into"` instead of 3.3's lexer error. The parser needs a distinct "stopped at a lexer error" end, and reading it must report the lexer error.

4. **The runtime inherits the defect**: `run` parses with `parseUnguarded` (`src/hypertalk/runtime.ts` line 72) before it executes anything. For another card's `openCard`, line 175 adds that card's id, and line 71 counts that script's lines for the line guard. The runtime needs no change of its own.

5. **Ruled out**: The lexer's positions, messages and `\r\n` handling are right. Only the choice of error is wrong. The line guard plays no part, because both `parse` and `parseUnguarded` return the lexer error today.

## Correctness Properties

Property 1: Bug Condition - A parse error found before the first lexer error is reported

_For any_ script source `s` where the bug condition holds (isBugCondition returns true), the fixed `parseUnguarded` SHALL return `{ ok: false, error: e }`, where `e` is the parse error the rules raise from before(s). It has the line, column and message the parser gives for the same error in a script without the lexer error, which equals the result for the clean twin and for `textBefore(s, L)`. `e` is before L, and `parse(s)` returns the same value. Running a handler of `s` with `runHandler` SHALL return `e` and make no host call. When `s` is the script of another card whose `openCard` a `go` starts, the run SHALL return `e` with that card's id as `scriptId` and a line in that card's script, and SHALL make no host call after `getCardScript`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Every other script lexes, parses and runs as before

_For any_ script source `s` where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce the same result as the original code. A script without a lexer error gives the same tree or the same first parse error. A script with a lexer error gives exactly `tokenize(s).error`. `tokenize` returns the same tokens or error, `\r\n` and `\n` give the same result, at most one error is returned, nothing throws, the line guard changes nothing, and runs make the same host calls with the same result.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/hypertalk/lexer.ts`

**Function**: `tokenize` (line 14), new `tokenizeUntilError`, new type `LexPrefix`

**Specific Changes**:
1. **Keep the tokens read before an error**: Move the body of `tokenize` into a new exported function:
   ```ts
   /** The tokens before the first lexer error, and that error. Without an error the tokens end with eof. */
   export interface LexPrefix {
     tokens: Token[];
     error: SyntaxError | undefined;
   }

   /**
    * The lexer behind tokenize. At its first error it stops and returns the tokens it read
    * before the error, with no eof, so the parser can still report an earlier parse error.
    */
   export function tokenizeUntilError(source: string): LexPrefix
   ```
   `fail` returns `{ tokens, error: syntaxError(line, column(at), message) }`. The success path pushes eof as now and returns `{ tokens, error: undefined }`. The three `return fail(…)` sites (lines 56, 73 and 95) and every rule and message stay as they are.

2. **`tokenize` becomes a wrapper with the same result**:
   ```ts
   export function tokenize(source: string): LexResult {
     const { tokens, error } = tokenizeUntilError(source);
     return error ? { ok: false, error } : { ok: true, tokens };
   }
   ```
   `LexResult` does not change (3.7).

**File**: `src/hypertalk/parser.ts`

**Function**: `parseUnguarded` (line 22), `Parser` constructor (line 67), `Parser.peek` (line 75), new `Parser.position`

**Specific Changes**:
1. **Always run the parser**: `parseUnguarded` calls `tokenizeUntilError(source)` and passes both fields to the parser. The early return goes away:
   ```ts
   const lexed = tokenizeUntilError(source);
   const parser = new Parser(lexed.tokens, lexed.error);
   ```

2. **Give the parser the lexer error**: The constructor gains a second field:
   ```ts
   constructor(
     private readonly tokens: Token[],
     /** Set when the lexer stopped early. The tokens then end just before it, with no eof. */
     private readonly lexError: SyntaxError | undefined,
   ) {}
   ```

3. **Reading past the tokens reports the lexer error**: `peek` checks this before it clamps:
   ```ts
   private peek(offset: number): Token {
     const k = this.i + offset;
     // Past the tokens read before a lexer error is the text at that error, so report it (R12.3).
     if (this.lexError && k >= this.tokens.length) throw new ParseAbort(this.lexError);
     // Otherwise the list ends with eof, so this never runs past it.
     return this.tokens[Math.min(k, this.tokens.length - 1)]!;
   }
   ```
   `current`, `advance`, `atWord`, `atOp`, `atLineEnd`, `skipNewlines`, `expectLineEnd`, `expectWord`, `quoted` and every `this.fail(this.current(), …)` read through `peek`. So every rule gets the check with no change of its own. `previous()` reads behind the cursor and `comparison()` moves the cursor only over tokens it has read, so neither can get past the check. When the lexer fails, the token list has no eof. `script()` can therefore never return a tree, and the eof checks at lines 162 and 390 can never fire (3.4). The error thrown is the lexer's own error object, so its line, column and message are the ones `tokenize` returns (3.2, 3.3, 3.5, 3.6).

4. **Keep the internal-error path from throwing**: The `catch` in `parseUnguarded` reads `parser.current()` (line 30) to place an unexpected exception. `current()` can now throw `ParseAbort`, so it uses a new method that never aborts:
   ```ts
   /** Where the cursor is, for an internal parser error. Unlike current(), it never aborts. */
   position(): Pos {
     const at = this.tokens[this.i] ?? this.lexError ?? { line: 1, column: 1 };
     return { line: at.line, column: at.column };
   }
   ```
   Past the tokens, this is L's position, which is inside the script, so P4 still holds. The last fallback cannot be reached, because a successful lex always ends with eof.

5. **Update the header comment**: Line 2 becomes "Reports the first syntax error met reading from the top, from the lexer or the parser, and never throws (R12.3)."

**File**: `src/hypertalk/runtime.ts`, `src/hypertalk/index.ts`, `src/hypertalk/tokens.ts`, `src/hypertalk/ast.ts`, `src/hypertalk/printer.ts`

**Specific Changes**:
1. **None**: `run` already parses before it executes, and it adds the card id and line count for another card's `openCard` (2.4). The `Token` type gets no new kind, so `describe` and `primary` need no new case.

**File**: `.kiro/specs/hypertalk-interpreter/design.md`

**Specific Changes**:
1. **Module list** (line 10): The `lexer.ts` line also names `tokenizeUntilError(source)` as internal.
2. **Parser notes** (after the bullet on `parse(source)`, line 160): Add a bullet. When the lexer fails, the parser still runs over the tokens the lexer read before the error. Reading past them means reading the text at the lexer error, so the parser reports the lexer error there. A parse error found before that point wins. An `on` or `if` that is still open at that point is not reported, because finding it would need the end of the script.

**Alternatives considered**:
- Parse the tokens before L with an eof appended, then report whichever error comes first by position. This is wrong for 3.3 and 3.4. "Never closed" names the earlier `on` or `if` line, and the eof would decide rules that need the text at L.
- Make the lexer recover and keep going past bad characters. The requirements phase ruled this out. It would also change lexer output that 3.7 keeps.
- Throw from the lexer instead of returning a prefix. The lexer and parser never throw out of their APIs, and the parser would still have no tokens to work on.

**Interaction with `nested-if-else-attachment-fix`**: That spec changes `blockIf`, `handler` and `oneLineIf` in the same file. Its new checks read tokens through `atWord` and `current`, so they get the lexer-error check from `peek` without any change. The two fixes touch different lines and can land in either order.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Preservation tests are written and run green on the unfixed code before the fix, then run again after it.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write parser and runtime tests that assert the expected results from Property 1 for the repros. Add a property over the shape generator described below, and a count over mutants. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Repro 1 parse**: Expect line 2, column 13, `expected a variable name after "into"` (will fail on unfixed code: line 3, column 10).
2. **Repro 2 parse**: Expect line 2, column 9 (will fail on unfixed code: line 42, column 8).
3. **Repro 3 parse**: Expect line 2, column 7 (will fail on unfixed code: line 2, column 12).
4. **Repro 1 with `\r\n`**: Expect the same as case 1 (will fail on unfixed code).
5. **Repro 1 through `runHandler`**: Expect the case 1 error and an empty fake host log (will fail on unfixed code: the lexer error).
6. **Repro 1 as card 2's `openCard`**: Card 1 runs `go to next card`. Expect line 2, column 13, scriptId `card-2` (will fail on unfixed code: line 3, column 10).
7. **Mutant count**: In the 1,000-mutant sample at seed 5 that the existing generator checks use, count the mutants with a lexer error that report a parse error. Expect at least a quarter of them (will fail on unfixed code: none).

**Expected Counterexamples**:
- Cases 1 to 6 return the first lexer error with the values listed in "Examples". Cases 1 to 3 were observed.
- Case 7: 135 of the 1,000 mutants have a lexer error, and 0 of them report a parse error on unfixed code. With the scratch fix, 74 of them (55%) do. Larger samples agree: at seed 7, 20,000 mutants gave 2,787 with a lexer error, of which 1,587 switch.
- Possible causes, as hypothesised: the early return in `parseUnguarded`, the lexer dropping its tokens on failure, and the parser having no end marker other than eof.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FUNCTION expectedBehavior(s, result)
  INPUT: s of type string where isBugCondition(s), result of type ParseResult
  OUTPUT: boolean

  L := tokenize(s).error
  e := the syntax error rules(before(s)) raises
  RETURN result = { ok: false, error: e }
     AND e = parseUnguarded_original(textBefore(s, L)).error   -- same line, column, message (2.1, 2.2, 2.3)
     AND (e.line, e.column) < (L.line, L.column)
END FUNCTION

FOR ALL s WHERE isBugCondition(s) DO
  result := parseUnguarded_fixed(s)
  ASSERT expectedBehavior(s, result)
  ASSERT parse_fixed(s) = result                               -- the line guard changes nothing (3.10)
  run := runHandler_fixed(s, handlerOf(s), ctx with a FakeHost)
  ASSERT run = result AND FakeHost.log = []                    -- 2.4
  -- for openCard shapes: card 1 runs this mouseUp, card 2's script is s
  run2 := runHandler_fixed('on mouseUp\n  go to next card\nend mouseUp', 'mouseUp', ctx)
  ASSERT run2.error = { ...result.error, scriptId: 'card-2' }  -- 2.4, R12.5
     AND no FakeHost call after getCardScript('card-2')
END FOR
```

The committed tests compute `e` without the unfixed parser. Generated shapes use `parseUnguarded(cleanTwin)`, which runs on a script without a lexer error, the path that Property 2 keeps unchanged.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL s WHERE NOT isBugCondition(s) DO
  ASSERT parseUnguarded_original(s) = parseUnguarded_fixed(s)
  ASSERT tokenize_original(s) = tokenize_fixed(s)
END FOR
```

For a script with a lexer error that is not in C, `parseUnguarded_original(s)` is `{ ok: false, error: tokenize(s).error }`, and the committed tests use that as the expected value. For scripts without a lexer error, the committed suite keeps no frozen copy of the old parser. Instead, the existing suite pins those results, and a one-off differential run compares F and F' directly (see "Property-Based Tests").

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for lexer-first scripts, rules that need the token at L, constructs open at L, multiple lexer errors, comments and strings with lexer-bad characters, `\r\n` scripts and lexer-clean scripts. Then write property-based tests capturing that behavior.

**Test Cases**:
1. **Lexer error first (3.2, 3.5)**: Observe that `answer "unclosed` on line 2 and `put 1 into` on line 3 give line 2, column 10 on unfixed code, and that a second lexer error is never reported. Then write a test to verify this continues after the fix.
2. **The rule needs the token at L (3.3)**: Observe that `put 1 into "x` gives line 2, column 14 on unfixed code, along with the other lines in the `NEEDS_TOKEN_AT_L` table below. Then write a test to verify this continues after the fix.
3. **Open constructs at L (3.4)**: Observe the two 3.4 examples, line 3, column 12 and line 5, column 10, on unfixed code, with up to three nested open block `if`s and the `end` lines present or missing. Then write a test to verify this continues after the fix.
4. **Exact messages (3.6)**: Observe the full message text through `parse` for `if x = 1 then howl`, `answer “hi”` and `answer 'hi'` in a handler on unfixed code. Then write a test to verify this continues after the fix.
5. **Standalone lexer (3.7)**: Observe that the existing lexer tests and lexer properties pass on unfixed code. Then keep them passing, and add the `tokenize`/`tokenizeUntilError` relation below.
6. **Comments, strings and `\r\n` (3.8, 3.9)**: Observe on unfixed code that comment lines with `=`, `#`, `"`, curly and single quotes, and strings with `--`, cause no error. Observe that `\r\n` and `\n` versions give the same result. Then write a test to verify this continues after the fix.
7. **P4 and the runtime (3.10, 3.11)**: Observe that `syntaxerror.property.test.ts`, `runtimeerror.property.test.ts` and the runtime suites pass on unfixed code. Then keep them passing unchanged.

### Unit Tests

- In `test/hypertalk/parser.test.ts`, add a `describe` block for this fix. It covers Repros 1 to 3 and Repro 1 with `\r\n`, each with the exact line, column and message. It also covers the edges from "Examples": a lexer error at column 1 of the next line, and a parse error in an earlier complete handler followed by a lexer error in a later one.
- The same block covers the preservation examples: 3.2's lexer-first script, 3.3's `put 1 into "x`, both 3.4 scripts, the four-label `answer` whose next token is the broken string, the script `=`, and three lexer errors in a row (only the first is reported). Each gets its exact line, column and message.
- The existing test "passes lexer errors through with their line" (`test/hypertalk/parser.test.ts` lines 573 to 575) stays as it is and must pass (3.2).
- In `test/hypertalk/lexer.test.ts`: `tokenizeUntilError('on mouseUp\n  put 1 into "x')` returns the tokens `on`, `mouseUp`, newline, `put`, `1`, `into` with their positions, no eof, and the error at line 2, column 14. `tokenizeUntilError('=')` returns no tokens and the error at line 1, column 1. For a valid script, it returns the same tokens as `tokenize`, ending with eof, and no error.

### Property-Based Tests

- **Shape generator** in a new `test/hypertalk/helpers/lexMask.ts`. It builds a script line by line around one `on mouseUp` or `on openCard` handler, sometimes after a complete valid handler of the other name. Lines get random indentation and keyword case, plus blank lines and filler. Filler lines are valid and include comment lines holding `=`, `#`, `"`, curly and single quotes, strings holding `--`, one-line `if`s and closed block `if`s (3.9). The script is joined with `\n` or `\r\n`. Tables of lines drive the shapes:
  - `PARSE_FIRST_LINES`: lines whose parse error is decided on the line itself, such as `go to nxt card`, `go nowhere`, `put 1 into`, `release`, `put 1 into true`, `summon cat`, `put 1 < 2 < 3 into x`, `put -5 into x`, `go to card n + 1`, `put 1 after x`, `x`, `on openCard`, `wait 1`, `ask` and `answer "a" with "b" or "c" or "d" or "e"`. `end if` and `else` are used only at the top level of the handler body.
  - `SAME_LINE_PARSE_FIRST`: pairs `{ bad, clean }` with a parse error before a lexer error on one line (2.3): `put into "x` / `put into "x"`, `go nowhere "x` / `go nowhere "x"`, `put 1 < 2 < "x` / `put 1 < 2 < "x"`, `summon cat = 1` / `summon cat is 1`, `x = 1` / `x is 1`, `put 1 into true 'a'` / `put 1 into true "a"`, `put -5 # 2 into x` / `put -5 + 2 into x`.
  - `LEXER_LINES`: pairs `{ bad, clean }` with one lexer error per kind: `answer "unclosed`, `if x = 1 then howl`, `answer “hi”`, `answer 'hi'`, `put 1 # 2 into x`, `put .5 into x`, `put 1. into x`, a 400-digit number, `put\u00A01 into x` and `go\rto next card`. Each clean version is a valid line. A `\r` is never placed at the end of a line, where it would join the line break.
  - `NEEDS_TOKEN_AT_L`: lines where a rule needs the token at the lexer error (3.3): `put 1 into "x`, `answer "x`, `go to next card =`, `put x = 1 into y`, `wait 1 #`, `go to card 1.`, `put 'a' into x`, `if a then "x`, the four-label `answer` ending in `"e`, and `end "x` at the top level of the body.
- **`maskedParseErrorArb`** (C holds). Valid filler comes first, then the target: a `PARSE_FIRST_LINES` line followed by 1 to 60 lines that include 1 to 3 `LEXER_LINES` (2.1, 2.2), or one `SAME_LINE_PARSE_FIRST` line (2.3). Targets that do not start with `end` or `else` are sometimes wrapped in 1 or 2 block `if`s, whose `end if` lines come after the lexer error or are missing. The handler's `end` line is present or missing. The arbitrary yields `{ source, twin, handler, targetLine }`, where `twin` is the source with every `bad` replaced by its `clean`.
- **`lexerErrorFirstArb`** (C does not hold). Valid filler and 0 to 3 open block `if`s come first, then a `LEXER_LINES` or `NEEDS_TOKEN_AT_L` line. After it come any mix of `PARSE_FIRST_LINES`, more lexer lines, `end if` lines and the handler's `end` line, any of which may be missing (3.2 to 3.5). The arbitrary yields `{ source, handler }`.
- **Property 1** in a new `test/hypertalk/lexmask.property.test.ts` (300 runs, plus 100 runs for the run checks). For `maskedParseErrorArb`, it first checks the generator: `tokenize(source)` fails, `tokenize(twin)` succeeds, and `parseUnguarded(twin)` fails on `targetLine`. Then it asserts that `parseUnguarded(source)` equals `parseUnguarded(twin)`, that the error is before `tokenize(source).error`, that `parse(source)` returns the same value, and that the other line ending gives the same result. `runHandler(source, handler)` with a fake host must return the error with an empty log. For `openCard` shapes, a two-card stack whose card 1 runs `go to next card` must return the error with scriptId `card-2` and no host call after `getCardScript`.
- **Property 2** in the same file (300 runs). For `lexerErrorFirstArb`, `parseUnguarded(source)` and `parse(source)` equal `{ ok: false, error: tokenize(source).error }` with the other line ending too, and `runHandler` returns that error with an empty log. This test is written and run green on the unfixed code first.
- **Mutant invariant** in the same file (500 runs over `mutantArb`, written and run green on the unfixed code first). For every mutant with a lexer error L, `parseUnguarded` fails and returns one of two things. Either it returns exactly L, or it returns a parse error before L that equals `parseUnguarded(textBefore(source, L))`. The existing P4 properties in `syntaxerror.property.test.ts` stay unchanged and now also cover mutants that report a parse error before a lexer error (3.10).
- **Mutant count** (exploratory case 7) in the generator coverage block of `syntaxerror.property.test.ts`. The check is that at least a quarter of the lexer-error mutants in the seed-5 sample report a parse error.
- **Lexer relation** in `test/hypertalk/lexer.property.test.ts` (1,000 runs over its `scriptText` arbitrary). `tokenize(s)` equals the wrapper applied to `tokenizeUntilError(s)`. When there is an error L, the tokens equal `tokenize(textBefore(s, L)).tokens` without the final eof (3.7).
- **One-off differential run**, not committed, done once after the fix. Check out the base commit in a separate git worktree and compare its `parseUnguarded` and `tokenize` with the fixed ones. Use 20,000 `mutantArb` samples and 3,000 `renderScript` outputs. Results must be identical for every lexer-clean input, and for every lexer-error input outside C. The scratch copy passed this check: 17,213 lexer-clean mutants and 3,000 rendered scripts gave identical results.

### Integration Tests

- In `test/hypertalk/runtime.statements.test.ts`: Repros 1 to 3 through `runHandler` with the fake host return their 2.x errors, the log stays empty and no field or card changes (2.4).
- In `test/hypertalk/runtime.navigation.test.ts`: in a two-card stack, card 1's `go to next card` opens card 2, whose `openCard` script is Repro 1. The result is line 2, column 13 with scriptId `card-2`. The move to card 2 is kept, as for any `openCard` error today, and no statement of card 2's script runs. The second 3.4 script as card 2's `openCard` returns line 5, column 10 with scriptId `card-2` (3.4).
- In `test/hypertalk/index.test.ts`: `parse` from `src/hypertalk/index.ts` returns the 2.x results for Repros 1 to 3. This checks that the public boundary and its line guard return the parser's value unchanged.
