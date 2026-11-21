# Bugfix Requirements Document

## Introduction

Inside a block `if`, the parser attaches an `else` or `end if` that comes directly after a one-line `if` to the enclosing block `if`. A one-line `if` keeps its `else` on its own line and has no `end if`, so a writer who puts `else` or `end if` on the next line most likely meant it for the one-line `if`. Today the parser accepts this without an error. In Repro 1 the wrong branch runs. In Repro 2 the error points at a later `end if` that is correct, not at the stray one.

Outside a block `if`, the same lines already give a syntax error on the line of the `else` or `end if` (hypertalk-interpreter design.md, "Parser": in the single-line form, `else` on the next line is a syntax error). The back of the card is meant to point at the line that is wrong, and inside a block `if` it currently cannot.

Terms used below:

- A **one-line `if`** is `if <condition> then <statement> [else <statement>]` written on one line (R9.2).
- A **block** is the list of statements in the `then` part of a block `if`, in an `else if` link, or in an `else` part.
- An `else`, `else if … then` or `end if` line comes **directly after** a one-line `if` when it is the next line that holds a command, `else` or `end`. Blank lines and comment-only lines in between do not count.
- An `else` or `end if` is **unmatched** when no block `if` is open for it to belong to.

Line numbers in the repros count from 1 at `on mouseUp`.

Repro 1 parses today. With field "key" = "iron" and field "door" = "open", clicking the button shows "The door is locked.":

```
on mouseUp
  if field "key" is "gold" then
    if field "door" is "open" then go next card
    else
      answer "The door is locked."
  end if
end mouseUp
```

Repro 2 reports its error on line 6 today, but the stray `end if` is on line 4:

```
on mouseUp
  if a then
    if b then go next card
    end if
    answer "x"
  end if
end mouseUp
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a block holds a one-line `if` without its own `else` and an `else` line comes directly after it THEN the system parses that `else` as the `else` of the enclosing block `if` and reports no error (Repro 1: the `else` on line 4 becomes the `else` of the `if` on line 2)

1.2 WHEN Repro 1's `mouseUp` handler runs with field "key" = "iron" and field "door" = "open" THEN the system runs the outer `else` branch and shows the dialog "The door is locked."

1.3 WHEN a block holds a one-line `if` without its own `else` and an `else if … then` line comes directly after it THEN the system parses that line as a link in the enclosing block `if`'s chain and reports no error

1.4 WHEN an `end if` comes directly after a one-line `if` and closes the enclosing block `if`, and a later unmatched `else` or `end if` in the same handler does not itself come directly after a one-line `if` THEN the system reports the syntax error on the line of that later `else` or `end if` (Repro 2: line 6) instead of on the stray `end if` (Repro 2: line 4)

### Expected Behavior (Correct)

2.1 WHEN a block holds a one-line `if` without its own `else` and an `else` line comes directly after it THEN the system SHALL report a syntax error on the line and column of that `else` (Repro 1: line 4, column 5), with a message that a one-line `if` keeps its `else` on the same line, which is the guidance it already gives for these lines outside a block `if`

2.2 WHEN Repro 1's `mouseUp` handler is run THEN the system SHALL return the syntax error from 2.1 (line 4) without running any statement, so no dialog appears and the current card does not change

2.3 WHEN a block holds a one-line `if` without its own `else` and an `else if … then` line comes directly after it THEN the system SHALL report a syntax error on the line and column of that `else`, with the same guidance as in 2.1

2.4 WHEN an `end if` comes directly after a one-line `if` and closes the enclosing block `if`, and a later unmatched `else` or `end if` in the same handler does not itself come directly after a one-line `if` THEN the system SHALL report the syntax error on the line and column of the `end if` that came directly after the one-line `if` (Repro 2: line 4, column 5), with a message that a one-line `if` has no `end if`. If more than one `end if` in that handler fits this description, the system SHALL report the last one before the unmatched `else` or `end if`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a block ends with a statement that is not a one-line `if` (any other command, or a block `if` closed by its own `end if`) and an `else`, `else if … then` or `end if` line follows THEN the system SHALL CONTINUE TO attach that line to the enclosing block `if` and give the same syntax tree and positions as now

3.2 WHEN a block ends with a one-line `if` that has its own `else` on the same line and an `else` or `else if … then` line follows THEN the system SHALL CONTINUE TO attach that line to the enclosing block `if`, because the one-line `if` cannot take a second `else`

3.3 WHEN an `end if` comes directly after a one-line `if` and closes the enclosing block `if`, and no unmatched `else` or `end if` follows in the same handler THEN the system SHALL CONTINUE TO accept the script with the same syntax tree (for example `if a then` / `if b then go next card` / `end if`, and the existing R9.3 test where a one-line `if` is the last statement of a block)

3.4 WHEN an unmatched `else` or `end if` comes directly after a one-line `if`, for example at the top level of a handler THEN the system SHALL CONTINUE TO report it on its own line and column with the current messages (`"else" without a matching "if"; a one-line if keeps its else on the same line` and `"end if" without a matching "if" (a one-line if has no "end if")`)

3.5 WHEN an unmatched `else` or `end if` appears and no earlier `end if` in the same handler came directly after a one-line `if` THEN the system SHALL CONTINUE TO report it on its own line and column with the current message

3.6 WHEN a one-line `if … then … else …` is written on a single line, at the top level of a handler or inside any block THEN the system SHALL CONTINUE TO accept it and give the same syntax tree as now

3.7 WHEN an `else if` chain is written in block form and none of its `else` or `else if` lines comes directly after a one-line `if` without its own `else` THEN the system SHALL CONTINUE TO give the same nested-`if` tree and positions, closed by a single `end if` (R9.6)

3.8 WHEN one of the existing `if` syntax errors occurs in a script that meets none of the conditions in 2.1, 2.3 and 2.4 (a missing `end if`, reported on the line of the first `if` (R9.5); a second `else`; a command on the same line as a block `else` or `else if … then`; `else if` in the one-line form; an `if` nested in a one-line `if`) THEN the system SHALL CONTINUE TO report it on the same line and column with the same message

3.9 WHEN a script that parses today has no `else` or `else if … then` line directly after a one-line `if` without its own `else` inside a block THEN the system SHALL CONTINUE TO parse it to the same syntax tree, and running it SHALL CONTINUE TO make the same host calls and give the same result

3.10 WHEN any source text is parsed THEN the system SHALL CONTINUE TO return at most the first syntax error, never throw, and report a line inside the script without the last-resort line guard having to change it (R12.3, R12.4, P4)

3.11 WHEN the printer's output for any syntax tree is parsed THEN the system SHALL CONTINUE TO give back the same tree without positions (P1)
