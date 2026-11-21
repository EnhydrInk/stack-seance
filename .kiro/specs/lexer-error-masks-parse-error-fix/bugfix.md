# Bugfix Requirements Document

## Introduction

If a script has a lexer error anywhere, that error hides any parse error that comes before it. The whole script is tokenized before parsing begins, so the parser never runs once the lexer has failed. hypertalk-interpreter R12.3 says the parser reports the first syntax error only. Today "first" means the first lexer error if there is one, and the first parse error only if the script has no lexer error at all. The back of the card is meant to point at the line that is wrong. A writer who flips the card after Repro 1 or Repro 2 is sent to a later line, and the real mistake on line 2 stays hidden until the later one is fixed.

With this fix, the reported syntax error is the first one met when the script is read from the top, whether the lexer or the parser finds it. Error messages and hints do not change. Only the choice of which error gets reported changes.

Terms used below:

- A **lexer error** is a syntax error found while reading characters: a string with no closing quote on its line, an unexpected character (including `=`, curly quotes and single quotes, which come with a hint), a number too large to be finite, or a number with a leading or trailing dot.
- The **first lexer error** is the one reported today: the lexer error at the earliest position in the script.
- A **parse error** is a syntax error found in the order of words, numbers, strings and operators, for example a missing value, an unknown command or a missing `end`.
- A parse error is **found before** the first lexer error when the parser finds it while reading only the part of the script before the first lexer error's position. A parse error the parser can only decide by reading the text at or after that position is not found before it, even if its message names an earlier line. A missing `end if`, reported on the line of its `if` (R9.5), and a missing `end mouseUp`, reported on the line of its `on` (R1.5, R12.4), are both of this kind.
- Positions are compared by line, then by column. Line breaks may be `\n` or `\r\n` (glossary).

Line numbers in the repros count from 1 at `on mouseUp`.

Repro 1 reports line 3 today. The incomplete `put 1 into` is on line 2:

```
on mouseUp
  put 1 into
  answer "unclosed
end mouseUp
```

Repro 2 reports line 42 today. The unknown target `nxt` is on line 2:

```
on mouseUp
  go to nxt card
  answer "ok"          -- lines 3 to 41 are this same line
  …
  if x = 1 then howl   -- line 42
end mouseUp
```

Repro 3 reports column 12 today. The misplaced `into` is at column 7 of the same line:

```
on mouseUp
  put into "x
end mouseUp
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a script has a lexer error and a parse error found before it on an earlier line THEN the system reports the first lexer error and not the parse error (Repro 1: line 3, column 10, `this string has no closing quote (") on this line`)

1.2 WHEN the lexer error is many lines below the parse error found before it THEN the system still reports the first lexer error (Repro 2: line 42, column 8, `unexpected character "="; use "is" to compare`)

1.3 WHEN a parse error is found before the first lexer error on the same line, at an earlier column THEN the system reports the first lexer error (Repro 3: line 2, column 12, `this string has no closing quote (") on this line`)

1.4 WHEN a handler of a script that meets 1.1, 1.2 or 1.3 is run, including an `openCard` handler of another card started by `go` (R2.5, R14.3) THEN the system returns the first lexer error as the result of the run

### Expected Behavior (Correct)

2.1 WHEN a script has a lexer error and a parse error found before it on an earlier line THEN the system SHALL report that parse error, with the line, column and message the parser already gives for it in a script without a lexer error (Repro 1: line 2, column 13, `expected a variable name after "into"`)

2.2 WHEN the lexer error is many lines below the parse error found before it THEN the system SHALL report that parse error in the same way (Repro 2: line 2, column 9, `expected next card, prev card, first card, last card or card … after "go"`)

2.3 WHEN a parse error is found before the first lexer error on the same line, at an earlier column THEN the system SHALL report that parse error in the same way (Repro 3: line 2, column 7, `expected a value but found "into", which is a reserved word`)

2.4 WHEN a handler of a script that meets 2.1, 2.2 or 2.3 is run THEN the system SHALL return that parse error as the result of the run, without running any statement of the script. For an `openCard` handler of another card, the error SHALL name the line in that card's script and carry that script's id (R12.5, R14.3)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a script has no lexer error THEN the system SHALL CONTINUE TO give the same syntax tree as now, or the same first parse error with the same line, column and message. Running such a script SHALL CONTINUE TO make the same host calls and give the same result

3.2 WHEN a script has a lexer error and no parse error is found before it THEN the system SHALL CONTINUE TO report the first lexer error with the same line, column and message, for example a lexer error on line 2 followed by a parse error on line 3 (`answer "unclosed` on line 2 and `put 1 into` on line 3 give line 2, column 10)

3.3 WHEN the next thing the parser needs is the text at the first lexer error THEN the system SHALL CONTINUE TO report the first lexer error (`put 1 into "x` on line 2 gives line 2, column 14, `this string has no closing quote (") on this line`)

3.4 WHEN a handler or a block `if` is still open at the first lexer error THEN the system SHALL CONTINUE TO report the first lexer error and not a missing `end` error. This holds when the `end` is missing (`on mouseUp` / `if a then` / `answer "x` / `end mouseUp` gives line 3, column 12) and also when the `end` comes after the lexer error (`on openCard` on line 4, `answer "x` on line 5 and `end openCard` on line 6 give line 5, column 10)

3.5 WHEN a script has more than one lexer error and the lexer error is reported THEN the system SHALL CONTINUE TO report only the first lexer error

3.6 WHEN any syntax error is reported THEN the system SHALL CONTINUE TO use the current message text word for word, including the hints for `=` (`use "is" to compare`), curly quotes (`use straight quotes (")`) and single quotes (`strings use double quotes (")`)

3.7 WHEN the lexer is run on its own THEN the system SHALL CONTINUE TO return the same tokens, or the same first lexer error with the same line, column and message

3.8 WHEN a script uses `\r\n` line breaks THEN the system SHALL CONTINUE TO report the same line and column as for the same script with `\n` line breaks, for lexer errors and parse errors alike

3.9 WHEN a comment holds characters that would be a lexer error outside a comment, or a string holds `--` THEN the system SHALL CONTINUE TO treat them as now (R11.9), so they neither cause nor hide a syntax error

3.10 WHEN any source text is parsed THEN the system SHALL CONTINUE TO return at most one syntax error, never throw, and report a line inside the script without the last-resort line guard having to change it (R12.1, R12.2, R12.3, R12.4, P4)

3.11 WHEN a script parses and its handler runs into a runtime error THEN the system SHALL CONTINUE TO report the first runtime error, stop the run and keep every effect done before the error (R12.3)
