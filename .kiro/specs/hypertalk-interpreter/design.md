# Design: HyperTalk interpreter

## Overview

Pure TypeScript, no dependencies other than the test libraries. The pipeline is `source → tokens → AST → run`, plus a printer `AST → source`. The printer exists for the round-trip property and for normalising the compiler's output. It is not used to show a script: the back of the card shows the stored source text as written, comments included, never the printed tree.

```
src/hypertalk/
  tokens.ts      Token types, keyword table
  lexer.ts       tokenize(source): LexResult  ({ ok: true, tokens } | { ok: false, error })
  ast.ts         AST types, stripPositions()
  parser.ts      parse(source): ParseResult
  printer.ts     print(script): string
  errors.ts      ScriptError types
  values.ts      toNumber, toStr, compare, looksNumeric
  host.ts        Host interface
  runtime.ts     runHandler, evaluate, execute
  index.ts       public exports
test/hypertalk/
  helpers/fakeHost.ts, helpers/arbitraries.ts
  *.test.ts, *.property.test.ts
```

The runtime imports only from `src/hypertalk`. `src/hypertalk` imports nothing from the UI or the compiler (R13).

## Errors

```ts
export interface SyntaxError { kind: 'syntax'; line: number; column: number; message: string; scriptId?: string }
export interface RuntimeError { kind: 'runtime'; line: number; message: string; scriptId?: string }
export type ScriptError = SyntaxError | RuntimeError;
```

The lexer and parser return results and never throw out of the public API. Internally the parser throws a `ParseAbort` carrying the error, caught in `parse`. The runtime does the same with `RuntimeAbort`.

Line numbers come from the token. The lexer counts lines after normalising `\r\n` to `\n`. Errors found at end of input use the line of the opening construct (R12.4), so `line <= lineCount` always holds. A helper `clampLine(line, lineCount)` is applied at the public boundary as a last guard (P4, P5), with an assertion in tests that it never changes a value.

## AST

```ts
export interface Pos { line: number; column: number }
export interface Script { handlers: Handler[] }
export interface Handler { name: 'mouseUp' | 'openCard'; body: Stmt[]; pos: Pos }

export type Stmt =
  | { t: 'go'; target: GoTarget; pos: Pos }
  | { t: 'effect'; effect: Effect; pos: Pos }
  | { t: 'answer'; prompt: Expr; labels: string[]; pos: Pos }
  | { t: 'ask'; prompt: Expr; pos: Pos }
  | { t: 'putField'; value: Expr; mode: 'into' | 'after' | 'before'; field: string; pos: Pos }
  | { t: 'putVar'; value: Expr; name: string; pos: Pos }
  | { t: 'show' | 'hide'; kind: 'button' | 'field'; name: string; pos: Pos }
  | { t: 'wait'; seconds: Expr; pos: Pos }
  | { t: 'global'; names: string[]; pos: Pos }
  | { t: 'if'; cond: Expr; then: Stmt[]; else: Stmt[]; pos: Pos };   // else is [] when absent

export type GoTarget =
  | { k: 'next' | 'prev' | 'first' | 'last' }
  | { k: 'card'; expr: Expr };

export type Effect = 'dissolve' | 'wipeLeft' | 'wipeRight' | 'irisOpen' | 'irisClose';

export type Expr =
  | { t: 'str'; value: string; pos: Pos }
  | { t: 'num'; value: number; pos: Pos }
  | { t: 'bool'; value: boolean; pos: Pos }         // the constants `true` and `false`; they evaluate to the strings "true" and "false"
  | { t: 'var'; name: string; pos: Pos }            // `it` is a var named "it"
  | { t: 'field'; name: string; pos: Pos }
  | { t: 'bin'; op: BinOp; left: Expr; right: Expr; pos: Pos }
  | { t: 'not'; operand: Expr; pos: Pos }
  | { t: 'paren'; inner: Expr; pos: Pos };

export type BinOp = '&' | '&&' | '+' | '-' | '*' | '/' | 'is' | 'isNot' | '<' | '>' | '<=' | '>=' | 'contains' | 'and' | 'or';
```

Decisions:

- Single-line and block `if` give the same node. Else-less ifs have `else: []`. An `if` with an empty `else` block and no `else` print the same, which is fine for round trip because the tree is equal.
- `else if` has no node of its own. `if a then X else if b then Y else Z end if` is `if a`, `else: [ if b, then: Y, else: Z ]`. A hand-written `else` block that holds exactly one `if` gives the same tree. The `pos` of the nested `if` is the line of its `else if`.
- `true` and `false` are `bool` nodes, matched case-insensitively. The tree does not keep the case, and the printer writes them in lowercase. A string literal `"true"` stays a `str` node, so the two never compare equal in a round trip by accident.
- `paren` stays in the tree. This keeps the printer simple and exact: it prints what was written. The printer also emits parentheses where precedence would otherwise change the meaning, for ASTs not produced by the parser (the generator builds ASTs directly for P1 as well).
- Variable and field names are stored as written. Comparison is by `toLowerCase()`. The printer keeps the stored case. Keyword case is not stored, so printing normalises it (`on mouseUp`, `end mouseUp`, `go to next card`, lowercase otherwise).
- `pos` is dropped for equality with `stripPositions(ast)`.
- Numbers are non-negative, so `print` uses `String(n)` and the lexer reads it back. Values such as `1e21` print in exponent form that the lexer does not accept, so the number generator is limited to values whose `String` form is plain decimal, and the printer renders others with `toFixed`-free fallback (`n.toLocaleString('en-US', {useGrouping:false, maximumFractionDigits:20})`). Parser-produced numbers always come from plain decimals, so this only matters for generated ASTs.

## Lexer

- Tokens: `word` (Unicode letters, combining marks, ASCII digits, underscore, starting with a letter or underscore), `number`, `string`, punctuation (`( ) , & &&  + - * / < > <= >=`), `newline`, and one final `eof` on the last line of the script. Columns are 1-based UTF-16 code units.
- A number literal too large to be finite is a syntax error. `.5` and `1.` are errors at the dot.
- Only space and tab are whitespace. A lone `\r` (not part of `\r\n`) is an unexpected character. Invisible characters are named by code point (`U+00A0`) in the message, and `=`, curly quotes and single quotes get a short hint.
- Comments `-- …` to end of line are skipped (R11.9). `--` must be lexed before `-`. Inside a string literal `--` is plain text, because strings are lexed first when a `"` is seen. The newline token that ends a comment line is kept, so line numbers do not change.
- `&&` is lexed before `&`; `<=` and `>=` before `<` and `>`.
- A string runs from `"` to the next `"` on the same line. Reaching the end of the line first gives a syntax error at that line.
- An unknown character gives a syntax error at its line and column.
- Line continuation with `¬` is not supported.

## Parser

Recursive descent over the token array. Newlines end statements. The parser works with a cursor and `expectWord('end')` style helpers that raise `ParseAbort` with the current token's line.

Grammar (keywords case-insensitive):

```
script     := { NL | handler }
handler    := 'on' NAME NL { stmt } 'end' NAME NL
stmt       := go | effect | answer | ask | put | show | hide | wait | global | if
go         := 'go' ['to'] ( 'next' 'card' | 'prev' 'card' | 'first' 'card' | 'last' 'card'
                          | 'card' primaryExpr )
effect     := 'visual' 'effect' ( 'dissolve' | 'wipe' 'left' | 'wipe' 'right' | 'iris' 'open' | 'iris' 'close' )
answer     := 'answer' expr [ 'with' STRING { 'or' STRING } ]      -- at most 3 labels
ask        := 'ask' expr
put        := 'put' expr ( 'into' target | ('after'|'before') 'field' STRING )
target     := 'field' STRING | NAME
show/hide  := ('show'|'hide') ('button'|'field') STRING
wait       := 'wait' expr ('second' | 'seconds')
global     := 'global' NAME { ',' NAME }
if         := 'if' expr 'then' ( NL block { 'else' 'if' expr 'then' NL block }
                                        [ 'else' NL block ] 'end' 'if'
                               | stmt [ 'else' stmt ] )
primary    := STRING | NUMBER | 'true' | 'false' | 'it' | NAME | 'field' STRING | '(' expr ')'
```

Notes:

- `go to card <primaryExpr>`: the card target is a primary expression (literal, variable, field, or parenthesised expression), so `go to card n + 1` needs parentheses. This avoids ambiguity with the next statement.
- `answer expr with …`: the expression is parsed below the `with` keyword, so `with` is not in the expression grammar. In `answer`, the label list's `or` belongs to the label list, not the `or` operator, because labels are string literals after `with`, and the prompt expression ends at `with`.
- A single-line `if`'s `else` is the same line. In the single-line form `else` on the next line is a syntax error (the `else` then has no `if`). A nested single-line `if` in a single-line `if` is a syntax error to avoid dangling-else (message: "use end if for nested if").
- After `then`, a newline selects the block form, anything else selects the single-line form.
- Chains (R9.6): in the block form, `else` followed by `if` on the same line starts a chain link. The parser builds a nested `if` in the `else` list and keeps reading links in a loop. The whole chain is closed by one `end if`, which the head `if` consumes. The parser remembers the head `if`'s line and uses it for the "missing `end if`" error, so a chain with no `end if` reports the line of the first `if`, not the line of an `else if`. An `else if` link needs a newline after `then`. In the single-line form, `else if` is a syntax error (nested single-line `if`).
- `put x into y` where `y` is a reserved word is a syntax error (R8.4). Reserved words are all keywords above plus `true` and `false` (R8.4, R11.10). `it` is not reserved, it is a normal variable name. The `RESERVED` set lives in `tokens.ts`, and the `true`/`false` entries mean `put 1 into true`, `global false` and similar give a syntax error on their line. The primary-expression parser turns the words `true` and `false` into `bool` nodes before it tries variable names, so a condition can be written `if correct is true then`.
- Expression precedence is implemented as one function per level (R11.2). Comparison parses one optional comparison operator, then `is not` is detected by looking ahead for `not` after `is`.
- `not` is a prefix operator at its own level, so `not a is b` means `not (a is b)`.
- Expression parsing stops at tokens that cannot continue it, then the statement parser expects NL or a closer, which gives "unexpected <token>" errors on that line.
- `parse(source)` returns `{ ok: true, script } | { ok: false, error: SyntaxError }`.

## Printer

`print(script): string` emits the canonical form: one statement per line, two-space indentation per level, block `if`, `\n` line endings, final newline. An `if` whose `else` list is exactly one `if` is printed as `else if …` and shares the outer `end if`, so chains print as chains. Comments are not in the tree and are lost on printing, which is why the printer is never used to show a card's script. `answer … with "A" or "B"`, `visual effect wipe left`, `go to next card`, `go to card <expr>`. Strings are printed in double quotes (they contain no quote). Handlers are separated by one blank line.

Round trip (P1): `parse(print(x))` is `ok` and `stripPositions` of it equals `stripPositions(x)`.

## Values

```ts
export type Value = string | number;
```

- `toStr(v)`: strings as is, numbers by `String(n)`.
- `looksNumeric(s)`: `/^\s*\d+(\.\d+)?\s*$/` or a number value.
- `toNumber(v)`: number, or numeric string; otherwise returns `undefined`, and the caller raises a runtime error naming the line.
- `compare(a, b)`: numeric when both look numeric; otherwise `toStr(a).toLowerCase()` against `toStr(b).toLowerCase()`.
- Boolean results are the strings `'true'` and `'false'`. `asBool(v, pos)` accepts those (case-insensitive) and raises otherwise.

## Host interface

```ts
export type CardRef = { index: number /* 1-based */; id: string; name: string | null };

export interface Host {
  cardCount(): number;
  currentCard(): CardRef;
  findCardByName(name: string): CardRef | undefined;       // case-insensitive
  cardAt(index: number): CardRef | undefined;
  goToCard(card: CardRef, effect?: Effect): void;          // changes current card, plays effect

  getField(name: string): string | undefined;               // current card; undefined = no such field
  setField(name: string, text: string): boolean;            // false = no such field
  setVisible(kind: 'button' | 'field', name: string, visible: boolean): boolean;  // false = missing

  answer(message: string, labels: string[]): Promise<string>;   // labels is never empty; runtime passes ['OK'] by default
  ask(message: string): Promise<string | null>;                 // null = cancelled

  wait(seconds: number): Promise<void>;
  getCardScript(card: CardRef): string;                          // source text, may be ''
}

export interface RunContext {
  host: Host;
  globals: Map<string, Value>;      // keys lower-cased
  scriptId: string;                 // id of the owner of the script being run
}

export type RunResult = { ok: true } | { ok: false; error: RuntimeError | SyntaxError };
export function runHandler(source: string, handler: 'mouseUp' | 'openCard', ctx: RunContext): Promise<RunResult>;
```

The host is asynchronous only where a person or a timer is involved (dialogs, wait). Everything else is synchronous so state changes are easy to reason about. The host changes visible state; the runtime holds no copy of card state, so there is one source of truth.

The runtime never caches the current card. Every `field`, `show`, `hide`, `put` and `go` asks the host at the moment it runs, and the host resolves names on its current card. So after a successful `go` the rest of the handler keeps running and names resolve on the new card (R2.6). If the nested `openCard` handler moves on again, the outer handler continues on wherever the host says the current card is.

## Runtime

`runHandler` parses `source` (a syntax error becomes the result, R12), finds the handler (none means `{ ok: true }`, R1.7), creates a frame `{ locals: Map, globalNames: Set, pendingEffect?: Effect }`, and executes the body.

- **Frame variables**: lookup key is `name.toLowerCase()`. If the key is in `globalNames`, read and write go to `ctx.globals`; otherwise to `locals`. Unset reads give `''`.
- **go**: resolve the target. `next`: `index % count + 1`. `prev`: `index === 1 ? count : index - 1`. `card`: evaluate the expression; if the value is a number or `looksNumeric` (R2.3, same helper as R11.5), convert with `toNumber`, check `Number.isInteger` and range, then use `host.cardAt`. Any other string goes through `findCardByName`. So `go to card it` after `ask` with reply `3` goes to card 3, and `2.5` is a number that is not an integer, so it is an error. Failure raises a runtime error at the `go` line, before anything changes. Success calls `host.goToCard(card, frame.pendingEffect)` and clears the effect (R3.2). Then the new card's `openCard` runs (R2.5, R14.2) in a nested `runHandler` with `depth + 1` and `scriptId` set to the new card's id. A failure there, runtime or syntax, is returned as the error of the outer run with its own `scriptId` and line, and the move is kept: the card is not moved back (P2, third outcome). The outer handler stops, because an error stops the run (R12.3). Depth above 16 raises an error at the `go` line (R14.4). Going to the current card still runs `openCard`.
- **visual effect**: sets `frame.pendingEffect`. `pendingEffect` is cleared when the frame ends (R3.5). A failing `go` clears it too (R3.3).
- **answer**: `toStr(eval(prompt))`, labels or `['OK']`, awaits the host, sets local/global `it`.
- **ask**: awaits the host, `null` becomes `''`.
- **putField**: evaluates the value, reads and writes via `getField`/`setField`; `undefined`/`false` raises an error at the line. `after` appends to the current text, `before` prepends.
- **show/hide**: `setVisible`, `false` raises an error.
- **wait**: evaluate, check finite and ≥ 0, `await host.wait(n)`.
- **if**: `asBool(eval(cond))`, run the chosen list.
- **global**: adds names to `globalNames`. A global that has never been set reads `''`.
- Evaluation errors name the line of the **expression's** `pos.line`, which is the same or a later line than the statement start only for multi-line constructs; since statements are single-line in this subset, it equals the statement line.
- Every thrown `RuntimeAbort` is caught in `runHandler` and turned into a result. Unexpected exceptions (bugs, or the host throwing) are caught too and returned as a runtime error at the line of the statement being executed, with the message from the exception, so the "errors name a line" rule holds even then. The runtime tracks `currentLine` for this.

## Determinism

The runtime has no clock, no randomness, no `Date`, no `Math.random`, no iteration over unordered collections that affects output (Maps keep insertion order). All outside input comes through the host. This makes P3 hold by construction, and the property test checks it.

## Testing strategy

- Example tests per requirement (one `describe` per R-number), with the fake host.
- `fakeHost.ts`: in-memory stack (cards with names, fields, buttons, visibility, scripts), a queue of scripted dialog replies, a call log, and a `clone()` for P3.
- `arbitraries.ts`: fast-check arbitraries for expressions, statements (with a depth limit), handlers and scripts, plus a stack arbitrary and a mutation arbitrary for P4. The stack arbitrary gives each card a script that is empty, valid, has a runtime error in `openCard`, or has a syntax error, so P2's third outcome is exercised. The `go` target arbitrary includes numeric strings. The script generator can be told which names exist in the stack so most runs do not stop at the first error, and sometimes picks missing names to exercise errors.
- Properties P1–P6 from the requirements, each in `*.property.test.ts`.
- R13 test: stub the globals, run, and a static scan of `src/hypertalk/**/*.ts` for banned names.

## Open points (decide while building, no need to ask)

- Whether to publish `print` through `index.ts` now. Yes, the later UI spec needs it.
- Whether `answer` with a label list that contains duplicates should be an error. Not in v1; the host receives them as written.
