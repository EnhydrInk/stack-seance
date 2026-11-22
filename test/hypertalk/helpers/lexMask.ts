// Test helpers for lexer-error-masks-parse-error-fix (design: "Property-Based Tests").
// Scripts are built line by line from tables. Each line has a `bad` text, which goes into
// the source, and a `clean` text, which goes into the source's clean twin: the same script
// with every lexer error replaced by valid text. The twin has no lexer error, so the
// parser's result for it is the expected result for the source.

import fc from 'fast-check';
import type { HandlerName } from '../../../src/hypertalk/ast';
import type { SyntaxError } from '../../../src/hypertalk/errors';
import { isReserved } from '../../../src/hypertalk/tokens';

// ---- positions ------------------------------------------------------------------

export interface At {
  line: number;
  column: number;
}

/** True when `a` comes before `b`, comparing the line, then the column. */
export function isBefore(a: At, b: At): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

/**
 * The part of `source` before line `at.line`, column `at.column`, counted as the lexer counts.
 * It walks the original text and counts `\r\n` as one character, so the cut never splits a
 * `\r\n` pair and the text is normalised once, by the lexer. Slicing normaliseLineBreaks(source)
 * would move positions instead: `'\r\r\n'` normalises to `'\r\n'`, and that normalises to `'\n'`.
 */
export function textBefore(source: string, at: At): string {
  let line = 1;
  let column = 1;
  let i = 0;
  for (;;) {
    if (line === at.line && column === at.column) return source.slice(0, i);
    if (i >= source.length) throw new Error(`textBefore: no line ${at.line}, column ${at.column} in the source`);
    const crlf = source[i] === '\r' && source[i + 1] === '\n';
    if (crlf || source[i] === '\n') {
      i += crlf ? 2 : 1;
      line++;
      column = 1;
    } else {
      i++;
      column++;
    }
  }
}

/**
 * The same script with the other line break: `\r\n` becomes `\n`, or `\n` becomes `\r\n`.
 * Only for scripts where no line ends with a lone `\r`, which the generator never writes.
 */
export function otherLineEnding(source: string): string {
  return source.includes('\r\n') ? source.replace(/\r\n/g, '\n') : source.replace(/\n/g, '\r\n');
}

// ---- the repros of bugfix.md ----------------------------------------------------

export interface Repro {
  name: string;
  /** Handler body lines, without indentation. The first one is line 2. */
  body: string[];
  /** What the parser reports for the script once the fix is in (2.1, 2.2, 2.3). */
  error: SyntaxError;
}

/** `on <name>`, the body lines indented by two spaces, `end <name>`. */
export function handlerSource(name: HandlerName, body: readonly string[], eol = '\n'): string {
  return [`on ${name}`, ...body.map((l) => `  ${l}`), `end ${name}`].join(eol);
}

const GO_MESSAGE = 'expected next card, prev card, first card, last card or card … after "go"';

/** The incomplete `put 1 into` on line 2; the lexer error is on line 3, column 10. */
export const REPRO_1: Repro = {
  name: 'Repro 1',
  body: ['put 1 into', 'answer "unclosed'],
  error: { kind: 'syntax', line: 2, column: 13, message: 'expected a variable name after "into"' },
};

/** The unknown target `nxt` on line 2; the lexer error (`=`) is on line 42, column 8. */
export const REPRO_2: Repro = {
  name: 'Repro 2',
  body: ['go to nxt card', ...Array.from({ length: 39 }, () => 'answer "ok"'), 'if x = 1 then howl'],
  error: { kind: 'syntax', line: 2, column: 9, message: GO_MESSAGE },
};

/** The misplaced `into` at column 7; the lexer error is at column 12 of the same line. */
export const REPRO_3: Repro = {
  name: 'Repro 3',
  body: ['put into "x'],
  error: { kind: 'syntax', line: 2, column: 7, message: 'expected a value but found "into", which is a reserved word' },
};

export const REPROS: readonly Repro[] = [REPRO_1, REPRO_2, REPRO_3];

// ---- tables -----------------------------------------------------------------------

/** One line of a generated script: `bad` goes into the source, `clean` into its twin. */
export interface Line {
  bad: string;
  clean: string;
}

const same = (text: string): Line => ({ bad: text, clean: text });

/**
 * Lines whose parse error the parser decides on the line itself, at one of its tokens or at
 * its line break. All of them lex. `end if` and `else` are errors only at the top level of
 * the handler body: inside a block `if` they would close it or start its else.
 */
export const PARSE_FIRST_LINES: readonly string[] = [
  'go to nxt card',
  'go nowhere',
  'put 1 into',
  'release',
  'put 1 into true',
  'summon cat',
  'put 1 < 2 < 3 into x',
  'put -5 into x',
  'go to card n + 1',
  'put 1 after x',
  'x',
  'on openCard',
  'wait 1',
  'ask',
  'answer "a" with "b" or "c" or "d" or "e"',
  'end if',
  'else',
];

const TOP_LEVEL_ONLY: ReadonlySet<string> = new Set(['end if', 'else']);

/**
 * A parse error before a lexer error on the same line (2.3). The parser rejects a token
 * before the bad text and does not look further. Each clean text keeps the bad text's
 * prefix up to that token, so the twin reports the same error at the same column.
 */
export const SAME_LINE_PARSE_FIRST: readonly Line[] = [
  { bad: 'put into "x', clean: 'put into "x"' },
  { bad: 'go nowhere "x', clean: 'go nowhere "x"' },
  { bad: 'put 1 < 2 < "x', clean: 'put 1 < 2 < "x"' },
  { bad: 'summon cat = 1', clean: 'summon cat is 1' },
  { bad: 'x = 1', clean: 'x is 1' },
  { bad: "put 1 into true 'a'", clean: 'put 1 into true "a"' },
  { bad: 'put -5 # 2 into x', clean: 'put -5 + 2 into x' },
];

/**
 * One lexer error of each kind, with a valid line to replace it in the twin. The `\r` sits
 * inside its line: at the end of a line it would join the line break.
 */
export const LEXER_LINES: readonly Line[] = [
  { bad: 'answer "unclosed', clean: 'answer "unclosed"' },
  { bad: 'if x = 1 then howl', clean: 'if x is 1 then howl' },
  { bad: 'answer \u201Chi\u201D', clean: 'answer "hi"' },
  { bad: "answer 'hi'", clean: 'answer "hi"' },
  { bad: 'put 1 # 2 into x', clean: 'put 1 + 2 into x' },
  { bad: 'put .5 into x', clean: 'put 0.5 into x' },
  { bad: 'put 1. into x', clean: 'put 1.0 into x' },
  { bad: `put ${'9'.repeat(400)} into x`, clean: 'put 99 into x' },
  { bad: 'put\u00A01 into x', clean: 'put 1 into x' },
  { bad: 'go\rto next card', clean: 'go to next card' },
];

/** Valid lines that lex. Comments hide characters the lexer would reject, and `--` in a string is text (R11.9). */
const FILLER_LINES: readonly string[] = [
  'put 1 into x',
  'go to next card',
  'howl',
  'global visits',
  'wait 1 second',
  'visual effect dissolve',
  'put "a" after field "note"',
  'show button "door"',
  'answer "ok"',
  '-- x = 1 # " \u201Ccurly\u201D \u2018single\u2019 it\'s',
  '-- answer "unclosed',
  'put 2 into x -- = # \' \u201C',
  'answer "a -- b"',
  'put "--" into x',
  'if x is 1 then howl',
  'if true then go to next card else go to prev card',
  '',
  '   ',
  '\t',
];

/** Closed block ifs, used as filler. */
const BLOCK_IFS: readonly (readonly string[])[] = [
  ['if a then', '  howl', 'end if'],
  ['if x is 1 then', '  put 2 into x', 'else', '  go to prev card', 'end if'],
  ['if a then', 'else if b then', '  answer "b -- c"', 'end if'],
];

/** Block ifs that are still open at the target line. */
const WRAP_IFS: readonly string[] = ['if a then', 'if x is 1 then', 'if not b then'];

// ---- line decoration -------------------------------------------------------------

type CaseStyle = 'lower' | 'upper' | 'capital' | 'alternate';

const indentArb = fc.constantFrom('', ' ', '  ', '    ', '\t', '\t\t');
const caseArb = fc.constantFrom<CaseStyle>('lower', 'lower', 'upper', 'capital', 'alternate');

function caseWord(word: string, style: CaseStyle): string {
  switch (style) {
    case 'lower': return word.toLowerCase();
    case 'upper': return word.toUpperCase();
    case 'capital': return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    case 'alternate': return [...word].map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join('');
  }
}

const HANDLER_WORDS: ReadonlySet<string> = new Set(['mouseup', 'opencard']);

/** Strings, comments, words and single characters, in order. */
const PIECE = /"[^"\n]*"?|--.*|[\p{L}_][\p{L}\p{M}0-9_]*|[\s\S]/gu;

/**
 * Writes every keyword and handler name of `text` in one case style. Strings and comments
 * keep their text. The style is a function of the word only, so a bad line and its clean
 * line get the same case.
 */
function recase(text: string, style: CaseStyle): string {
  return (text.match(PIECE) ?? [])
    .map((p) => (/^[\p{L}_]/u.test(p) && (isReserved(p) || HANDLER_WORDS.has(p.toLowerCase())) ? caseWord(p, style) : p))
    .join('');
}

const decorate = (line: Line, indent: string, style: CaseStyle): Line => ({
  bad: indent + recase(line.bad, style),
  clean: indent + recase(line.clean, style),
});

/** A line from `lines` with random indentation and keyword case. */
const decorated = (lines: fc.Arbitrary<Line>): fc.Arbitrary<Line> =>
  fc.tuple(lines, indentArb, caseArb).map(([line, indent, style]) => decorate(line, indent, style));

const fillerLineArb = decorated(fc.constantFrom(...FILLER_LINES).map(same));
const lexerLineArb = decorated(fc.constantFrom(...LEXER_LINES));

const blockIfArb: fc.Arbitrary<Line[]> = fc
  .tuple(fc.constantFrom(...BLOCK_IFS), indentArb, caseArb)
  .map(([block, indent, style]) => block.map((l) => decorate(same(l), indent, style)));

/** Up to four valid filler items: single lines or closed block ifs. */
const fillerArb: fc.Arbitrary<Line[]> = fc
  .array(fc.oneof({ weight: 3, arbitrary: fillerLineArb.map((l) => [l]) }, { weight: 1, arbitrary: blockIfArb }), {
    maxLength: 4,
  })
  .map((items) => items.flat());

/** Lines after the target that lex: filler, and lines with parse errors the parser never reaches. */
const trailingLineArb: fc.Arbitrary<Line> = fc.oneof(
  { weight: 3, arbitrary: fillerLineArb },
  { weight: 1, arbitrary: decorated(fc.constantFrom(...PARSE_FIRST_LINES).map(same)) },
);

// ---- the masked parse error shape (C holds) ---------------------------------------

export interface MaskedParseError {
  /** The script: a parse error, then the first lexer error. */
  source: string;
  /** The script with every lexer error replaced by valid text. */
  twin: string;
  /** The handler the target line is in. */
  handler: HandlerName;
  /** The line of the parse error. */
  targetLine: number;
}

interface Target {
  line: Line;
  /** `end if` or `else`: only at the top level of the body, never inside a wrap if. */
  topLevelOnly: boolean;
  /** The lines after the target, up to the `end if` lines of the wraps. */
  after: Line[];
}

/** A PARSE_FIRST_LINES line, then 1 to 60 lines with 1 to 3 lexer errors among them (2.1, 2.2). */
const nextLineTargetArb: fc.Arbitrary<Target> = fc
  .tuple(
    fc.constantFrom(...PARSE_FIRST_LINES),
    indentArb,
    caseArb,
    fc.array(trailingLineArb, { maxLength: 57 }),
    fc.array(fc.tuple(fc.nat(), lexerLineArb), { minLength: 1, maxLength: 3 }),
  )
  .map(([text, indent, style, after, lexerLines]): Target => {
    const lines = [...after];
    for (const [at, line] of lexerLines) lines.splice(at % (lines.length + 1), 0, line);
    return { line: decorate(same(text), indent, style), topLevelOnly: TOP_LEVEL_ONLY.has(text), after: lines };
  });

/** A SAME_LINE_PARSE_FIRST line, then up to 10 lines, which may hold more lexer errors (2.3). */
const sameLineTargetArb: fc.Arbitrary<Target> = fc
  .tuple(
    decorated(fc.constantFrom(...SAME_LINE_PARSE_FIRST)),
    fc.array(fc.oneof({ weight: 3, arbitrary: trailingLineArb }, { weight: 1, arbitrary: lexerLineArb }), { maxLength: 10 }),
  )
  .map(([line, after]): Target => ({ line, topLevelOnly: false, after }));

const otherName = (name: HandlerName): HandlerName => (name === 'mouseUp' ? 'openCard' : 'mouseUp');

/** A complete valid handler. */
const validHandlerArb = (name: HandlerName): fc.Arbitrary<Line[]> =>
  fc
    .tuple(fillerArb, indentArb, caseArb, fc.boolean())
    .map(([body, indent, style, blankAfter]) => [
      decorate(same(`on ${name}`), indent, style),
      ...body,
      decorate(same(`end ${name}`), indent, style),
      ...(blankAfter ? [same('')] : []),
    ]);

/**
 * Scripts in the bug condition C by construction. Comment or blank lines, sometimes a
 * complete valid handler of the other name, then `on mouseUp` or `on openCard`, valid
 * filler, 0 to 2 open block ifs, the target and the lines after it. The `end if` lines of
 * the open ifs come after the lexer error or are missing, and so may the handler's `end`.
 * Joined with `\n` or `\r\n`, with or without a final line break.
 */
export const maskedParseErrorArb: fc.Arbitrary<MaskedParseError> = fc
  .constantFrom<HandlerName>('mouseUp', 'openCard')
  .chain((handler) =>
    fc.record({
      handler: fc.constant(handler),
      head: fc.array(fc.constantFrom('-- the crypt = # "', '').map(same), { maxLength: 2 }),
      other: fc.option(validHandlerArb(otherName(handler)), { nil: undefined }),
      header: fc.tuple(indentArb, caseArb).map(([indent, style]) => decorate(same(`on ${handler}`), indent, style)),
      before: fillerArb,
      wraps: fc.array(decorated(fc.constantFrom(...WRAP_IFS).map(same)), { maxLength: 2 }),
      target: fc.oneof(nextLineTargetArb, sameLineTargetArb),
      endIfs: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
      footer: fc.option(
        fc.tuple(indentArb, caseArb).map(([indent, style]) => decorate(same(`end ${handler}`), indent, style)),
        { nil: undefined, freq: 4 },
      ),
      eol: fc.constantFrom('\n', '\r\n'),
      finalBreak: fc.boolean(),
    }),
  )
  .map(({ handler, head, other, header, before, wraps, target, endIfs, footer, eol, finalBreak }): MaskedParseError => {
    const open = target.topLevelOnly ? [] : wraps;
    const ends = open.flatMap((_, k) => (endIfs[k] ? [same('  end if')] : []));
    const prefix = [...head, ...(other ?? []), header, ...before, ...open];
    const lines = [...prefix, target.line, ...target.after, ...ends, ...(footer ? [footer] : [])];
    const join = (pick: (l: Line) => string) => lines.map(pick).join(eol) + (finalBreak ? eol : '');
    return { source: join((l) => l.bad), twin: join((l) => l.clean), handler, targetLine: prefix.length + 1 };
  });
