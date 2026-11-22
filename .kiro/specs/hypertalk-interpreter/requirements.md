# Requirements: HyperTalk interpreter

## Introduction

This spec covers the HyperTalk parser and runtime for Stack Séance. A script is stored in a card, written by the authoring-time compiler or edited by the user, and run by this interpreter when the user clicks a button or opens a card.

Out of scope: UI, the LLM compiler, persistence, and any HyperTalk feature not listed below (loops, `repeat`, user functions, `send`, `sort`, unary minus, chunk expressions such as `word 2 of`, and so on). Each gets its own spec or is not planned.

The runtime reaches the stack and the user only through a host interface (R10), so every requirement below can be tested in vitest without a browser.

## Glossary

- **Script**: the source text of one button or card.
- **Line**: a 1-based line number in the script text. Line breaks are `\n` or `\r\n`. A trailing line break does not start a new line. A script of N lines has lines 1..N.
- **Host**: the object that implements the host interface (R10).
- **Handler**: `on <name> … end <name>`.
- **Value**: a string or a number.

## Requirements

### R1. Handlers

**User story:** As a card author, I want a script to react to a click and to a card opening, so that buttons and cards can do things.

1. The parser SHALL accept `on mouseUp … end mouseUp` and `on openCard … end openCard`, with zero or more statements in the body.
2. The parser SHALL accept a script with several handlers, and an empty script (no handlers).
3. WHEN the name after `end` differs from the name after `on` (case-insensitive), the parser SHALL report a syntax error on the `end` line.
4. WHEN a handler name is not `mouseUp` or `openCard`, the parser SHALL report a syntax error on the `on` line.
5. WHEN a handler is not closed before the end of the script, the parser SHALL report a syntax error on the line of its `on`.
6. WHEN a script defines the same handler twice, the parser SHALL report a syntax error on the line of the second `on`.
7. WHEN the runtime is asked to run a handler the script does not define, it SHALL do nothing and report no error.
8. Keywords and handler names SHALL be case-insensitive. Variable names, field names, button names, card names and stack names SHALL also be case-insensitive when compared.

### R2. Navigation

**User story:** As a user, I want buttons to move me between cards.

Card targets (next, prev, first, last, card numbers and card names) refer to the current stack: the stack that holds the current card.

1. The parser SHALL accept `go [to] next card`, `prev card`, `first card`, `last card` (the word `card` is required, `to` is optional), and `go [to] card <expression>`.
2. WHEN `next card` runs on the last card, the current card SHALL become the first card. WHEN `prev card` runs on the first card, it SHALL become the last card.
3. WHEN the target of `go to card` evaluates to a number, or to a string that looks like a number (same rule as R11.5), the runtime SHALL treat it as a 1-based card number. Any other string SHALL be treated as a card name. Values from `ask`, `answer` and `field` are always strings, so `ask "Which room?"` followed by `go to card it` goes to card 3 when the user types `3`.
4. IF the card number is not an integer in 1..cardCount, or no card has that name, THEN the runtime SHALL report a runtime error naming the line of the `go` statement, stop the handler, and leave the current card unchanged.
5. WHEN a `go` succeeds, including when the target is the current card, the runtime SHALL run the `openCard` handler of the new card (see R14).
6. After a successful `go`, the rest of the handler SHALL keep running. Later `field`, `button`, `show` and `hide` names SHALL resolve on the new current card, as in HyperCard.
7. The parser SHALL accept `go [to] stack <expression>`, with the expression rule of `go [to] card <expression>`: a calculated name needs parentheses.
8. The target's value, converted to a string (R11.8), SHALL be a stack name, compared ignoring case. There are no stack numbers: `go to stack 3` looks for the stack named "3".
9. IF the name is empty or no stack has it, THEN the runtime SHALL report a runtime error naming the line of the `go`, stop the handler, drop the pending effect (R3.3), and leave the current stack and card unchanged.
10. WHEN the stack exists, also when it is the current stack, the host SHALL make it the current stack and show its first card with the pending effect (R3.2). The runtime SHALL then run that card's `openCard` as in R2.5 and R14, with the same depth limit and error reporting (R12.3, R12.5). The rest of the handler keeps running in the new current stack (R2.6), and globals stay shared (R8.2).

### R3. Visual effects

1. The parser SHALL accept `visual effect dissolve`, `wipe left`, `wipe right`, `iris open`, and `iris close`.
2. WHEN a visual effect statement runs, the runtime SHALL remember the effect. The next `go` statement SHALL ask the host to play that effect together with the card change, and then the remembered effect SHALL be cleared.
3. WHEN the next `go` fails with a runtime error, the effect SHALL be cleared and not played.
4. A second `visual effect` before a `go` SHALL replace the first.
5. A remembered effect SHALL NOT survive the end of the outermost handler run.

### R4. Dialogs

1. The parser SHALL accept `answer <expression>` with zero to three labels: `answer <expression> with "<label>" [or "<label>" [or "<label>"]]`. Labels are string literals.
2. WHEN the script gives a fourth label, the parser SHALL report a syntax error on that line.
3. The parser SHALL accept `ask <expression>`.
4. WHEN `answer` runs, the runtime SHALL ask the host to show the message with the labels (or `OK` when there are none) and SHALL put the label of the chosen button into `it`.
5. WHEN `ask` runs, the runtime SHALL ask the host for text and put the reply into `it`. WHEN the user cancels, `it` SHALL be the empty string.
6. The prompt expression SHALL be converted to a string before it goes to the host.

### R5. Fields

1. The parser SHALL accept `put <expression> into field "<name>"`, `put <expression> after field "<name>"`, `put <expression> before field "<name>"`, and `put <expression> into <variable>`.
2. `into` SHALL replace the field text, `after` SHALL append, and `before` SHALL prepend. Values are converted to strings first.
3. A `field "<name>"` expression SHALL read the field text from the current card as a string.
4. IF no field with that name exists on the current card, THEN the runtime SHALL report a runtime error naming the line.
5. The runtime SHALL NOT support `after` or `before` for variables in v1. The parser SHALL report a syntax error naming the line.

### R6. Visibility

1. The parser SHALL accept `show` and `hide` followed by `button "<name>"` or `field "<name>"`.
2. IF the named button or field does not exist on the current card, THEN the runtime SHALL report a runtime error naming the line.
3. Showing a visible item or hiding a hidden one SHALL be a no-op and SHALL NOT be an error.

### R7. Timing

1. The parser SHALL accept `wait <expression> second` and `wait <expression> seconds`.
2. The runtime SHALL ask the host to wait for that many seconds and SHALL NOT use real timers itself.
3. IF the value is not a number, or is negative, or is not finite, THEN the runtime SHALL report a runtime error naming the line.

### R8. Variables

1. Variables SHALL be local to one handler run by default. A variable that was never set SHALL evaluate to the empty string.
2. `global <name>[, <name>…]` SHALL declare names as global for the rest of the handler. Global variables SHALL be shared by all handlers of all cards in the same session, through a global store that the caller passes in.
3. `it` SHALL be an ordinary local variable that `answer` and `ask` set.
4. The parser SHALL report a syntax error naming the line WHEN a variable name (in `put … into`, or in `global`) is a reserved word of the subset. The reserved words are the keywords of the grammar (`stack` among them), `true` and `false`.

### R9. Control flow

1. The parser SHALL accept the block form `if <condition> then` / statements / [`else` / statements] / `end if`, with `then` and `else` on separate lines.
2. The parser SHALL accept the single-line form `if <condition> then <statement> [else <statement>]` on one line.
3. The two forms SHALL produce the same syntax tree for the same meaning. Blocks MAY nest.
4. A condition SHALL evaluate to a boolean. A value that is not `true` or `false` (case-insensitive) SHALL cause a runtime error naming the line of the `if`.
5. WHEN `end if` is missing, the parser SHALL report a syntax error on the line of the `if`. For a chain (R9.6) this is the line of the first `if`.
6. In the block form, `else if <condition> then` MAY follow the statements of an `if` or of another `else if`, any number of times, with an optional final `else`. The whole chain SHALL close with a single `end if`. The syntax tree SHALL be a nested `if` in the else branch, so a chain and the same logic written as `else` with a nested block `if` give the same tree. `else if` in the single-line form SHALL be a syntax error on that line.

### R10. Host interface

1. The runtime SHALL use only the `Host` interface (see design) for: current card, card count, card lookup by name, going to a card, stack lookup by name, going to a stack, field text, visibility, dialogs, visual effects, waiting, haunts, and card scripts. The card calls refer to the current stack.
2. The runtime SHALL NOT import DOM, `window`, `document`, `fetch`, `XMLHttpRequest`, `WebSocket`, or timers.
3. A fake host for tests SHALL exist in the test helpers and SHALL record every call.

### R11. Expressions

1. The parser SHALL accept: string literals, number literals (non-negative decimals), the constants `true` and `false`, `it`, variable names, `field "<name>"`, parentheses, and the operators `&`, `&&`, `+`, `-`, `*`, `/`, `is`, `is not`, `<`, `>`, `<=`, `>=`, `contains`, `and`, `or`, `not`.
2. Precedence from lowest to highest SHALL be: `or`, `and`, `not`, comparison (`is`, `is not`, `<`, `>`, `<=`, `>=`, `contains`), concatenation (`&`, `&&`), additive (`+`, `-`), multiplicative (`*`, `/`), primary. Binary operators SHALL be left-associative. Comparison SHALL NOT chain (`1 < 2 < 3` is a syntax error).
3. `a & b` SHALL join without a space. `a && b` SHALL join with one space.
4. Arithmetic SHALL accept numbers and strings that look like numbers, and SHALL report a runtime error naming the line for anything else. Division by zero SHALL cause a runtime error. A string looks like a number when it is an optional minus sign, digits and an optional decimal part (a dot followed by digits), with optional whitespace before and after it. So `"3"`, `" -2.5 "` and `"-5"` look like numbers, and `"- 5"`, `"+1"`, `".5"`, `"3."` and `"1e3"` do not. The minus sign is there because values can be negative at runtime (`0 - 5`) and come back from fields and `ask` as strings such as `"-5"`. Number literals in a script stay non-negative (R11.1) and there is no unary minus: this rule only widens what counts as a number at runtime.
5. WHEN both operands of a comparison are numbers or look like numbers (same rule as R11.4), the runtime SHALL compare them as numbers, so `"-2" < "-1"` is true. Otherwise it SHALL compare them as strings, case-insensitively.
6. `contains` SHALL test for a case-insensitive substring. `and`, `or`, `not` SHALL require booleans (`true`/`false`) and report a runtime error otherwise. Comparison and `contains` produce the strings `true` or `false`.
7. A string literal SHALL NOT contain a double quote and SHALL NOT span lines. WHEN a string is not closed on its line, the parser SHALL report a syntax error on that line.
8. Numbers SHALL convert to strings the way JavaScript does (`String(n)`), so `1/4` gives `0.25`.
9. `--` outside a string literal SHALL start a comment that runs to the end of the line, and the parser SHALL ignore it. A comment SHALL NOT change line numbers. A line that holds only a comment SHALL count as a blank line, and `--` inside a string literal is part of the string.
10. `true` and `false` (case-insensitive) SHALL be constants that evaluate to the strings `true` and `false`. They are reserved words (R8.4): they cannot be variable names. Because comparisons give the same strings (R11.6), `if correct is true then` works when `correct` holds the result of a comparison.

### R12. Error reporting

1. Every syntax error and every runtime error SHALL carry a line number: an integer from 1 to the number of lines in the script that the error comes from.
2. A syntax error SHALL also carry a message and the column where it was found.
3. The parser SHALL report the first syntax error only and SHALL NOT throw. The runtime SHALL report the first runtime error, stop the current handler run, and keep every effect done before the error.
4. For an error at the end of the script (for example a missing `end`), the line SHALL be the line the problem started on (R1.5, R9.5), so it is always inside the script.
5. An error raised while running an `openCard` handler of another card (R2.5) SHALL name the line in that card's script and identify which script it is (the host's script id).

### R13. No network, no LLM

1. Parsing and running a script SHALL NOT make network requests and SHALL NOT call an LLM.
2. A test SHALL run scripts with `fetch`, `XMLHttpRequest`, and `WebSocket` replaced by functions that fail the test, and SHALL scan the interpreter's source files for these names and for imports of the compiler module.

### R14. Running handlers

1. The runtime SHALL expose `runHandler(source, handlerName, ctx)` where `ctx` has the host, the global store, and the id of the script's owner.
2. After a successful `go`, the runtime SHALL look up the new card's script through the host, parse it, and run its `openCard` handler with a fresh set of local variables and the same global store.
3. A syntax error in a card's script found at that point SHALL be reported as an error with the line from that script (R12.5).
4. The runtime SHALL stop with a runtime error naming the line of the `go` that went too deep when `openCard` handlers chain more than 16 levels.

### R15. Haunts

1. The parser SHALL accept four haunt statements: `release bat`, `howl`, `summon witch`, `drop spider`. These words are keywords, so R8.4 reserves them.
2. WHEN a haunt statement runs, the runtime SHALL call `host.haunt(kind)` with kind `'bat' | 'howl' | 'witch' | 'spider'` and await it. The host decides how long the animation holds the script.
3. A haunt SHALL NOT change the current card, fields, visibility or variables.
4. Adding a creature later SHALL only need one new entry in a single table (statement words to kind), plus the host's animation.

## Correctness properties (fast-check)

Each property is a vitest test using fast-check, at least 200 runs, tagged with its name.

**P1. Round trip.** For any generated valid script, `parse(print(parse(s)))` equals `parse(s)`, ignoring line and column positions. Also `print(parse(print(ast)))` equals `print(ast)`. Generators produce every statement and expression form, including `go to stack` with every expression form as its target, both `if` forms, any nesting depth up to 4, mixed case keywords, and extra spaces and blank lines.

**P2. Navigation.** For any stack of 1..20 cards with unique names and any `go` target (the four named targets, any integer from -5 to 30, existing and missing names), after running the script one of these holds:
- the current card index is in 1..cardCount and the result has no error; or
- the result has a runtime error whose line is the `go` line, and the current card equals the one before; or
- the `go` moved to a new card and that card's `openCard` handler raised an error (runtime, or a syntax error in its script). The error carries that card's script id and a line inside that script (1..its lineCount), and the current card is the new card (R12.3 keeps the move).

Also, the named targets and valid numbers reach the expected cards, including both wraps. Numeric strings (for example `"3"` from `ask`) reach the same card as the number, and a non-numeric string reaches the card of that name. This card P2 stays on a single stack.

**P2, stack navigation.** For any 1 to 5 stacks with names unique ignoring case, each with 1 to 4 cards whose ids are unique across all stacks and whose first card's script is empty, valid, has a runtime error in `openCard`, or has a syntax error; any starting stack and card in it; an optional `visual effect`; and any target text that is a stack name as written, a stack name in other case, or no stack's name (the empty string included), passed as a string literal, through `ask` and `it`, or as a number literal; running a `mouseUp` handler with one `go to stack` gives exactly one of these outcomes:
- no error, and the current card is the first card of the stack whose name matches the text ignoring case; or
- a runtime error on the `go` line, the current stack and card are the ones before the run, and nothing moved; or
- the `go` opened the matching stack and its first card's `openCard` raised an error (runtime, or a syntax error in its script). The error carries that card's script id and a line inside that script (1..its lineCount), and the current card is that first card (R12.3 keeps the move).

The outcome is the one a model of the generated stacks expects: the second when the text is empty or matches no stack, the third when the matching stack's first card has an error, and the first otherwise. The host's call log holds one `findStackByName` call with the text unchanged (none for the empty text), and one `goToStack` call with the matching stack and the pending effect (none when no stack matches).

**P3. Determinism.** For any stack state (one stack, or 1 to 3 stacks for scripts with `go to stack`), any valid script (any statement mix, including dialogs, fields, visibility, `go`, `go to stack`, globals, and haunts), and a fixed list of dialog replies, running it twice from identical copies of the state gives equal resulting state (every stack with its cards and current card, and the current stack), equal results, and equal host call logs, the `findStackByName` and `goToStack` calls included.

**P4. Error lines.** For any script with a syntax error, the reported line is an integer in 1..lineCount. Generator: take a valid script and delete, duplicate, swap, or replace random tokens, truncate it at a random point, or insert junk lines. The test keeps the cases where `parse` fails. A separate example test makes sure the generator produces failures often enough (at least 30% of runs).

**P5. Runtime error lines.** For any generated script and stack state, from the same sessions as P3 (one stack, or 1 to 3 stacks), where `run` returns an error, the error line is in 1..lineCount of the script that raised it: the script that was run, or the card script whose id the error carries, found in any stack.

**P6. Global sharing.** A value stored in a `global` variable by one handler is read by another handler on another card in the same session, and a local with the same name is not shared.
