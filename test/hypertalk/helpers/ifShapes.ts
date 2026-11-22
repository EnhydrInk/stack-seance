// Test helpers for nested-if-else-attachment-fix (design: "Property-Based Tests").
// Scripts are written line by line from a small vocabulary of commands and conditions whose
// trees are known. Each code line gets random indentation and keyword case, sometimes a
// trailing comment or blanks, and sometimes blank or comment-only lines before it. The line
// builder records where the first token of each code line lands, so the expected result of
// a shape is known by construction, without asking the parser.

import fc from 'fast-check';
import type { Expr, HandlerName, Pos, Script, Stmt, WithoutPos } from '../../../src/hypertalk/ast';
import type { SyntaxError } from '../../../src/hypertalk/errors';
import { tokenize } from '../../../src/hypertalk/lexer';
import { isReserved, type Token } from '../../../src/hypertalk/tokens';

// ---- messages and the repros of bugfix.md ----------------------------------------

/** The 2.1 and 2.3 message, reported on the else. */
export const ELSE_AFTER_ONE_LINE_IF =
  '"else" right after a one-line if; a one-line if keeps its else on the same line (or write the if in block form with "end if")';

/** The 2.4 message, reported on the stray end if. `ifLine` is the line of the if it closed. */
export function strayEndIfMessage(ifLine: number): string {
  return `"end if" right after a one-line if closes the "if" on line ${ifLine}; a one-line if has no "end if"`;
}

export interface Repro {
  source: string;
  /** What the parser reports once the fix is in. */
  error: SyntaxError;
}

/** With field "key" = "iron" and field "door" = "open", the unfixed parser shows "The door is locked." */
export const ONE_LINE_IF_REPRO_1: Repro = {
  source: [
    'on mouseUp',
    '  if field "key" is "gold" then',
    '    if field "door" is "open" then go next card',
    '    else',
    '      answer "The door is locked."',
    '  end if',
    'end mouseUp',
  ].join('\n'),
  error: { kind: 'syntax', line: 4, column: 5, message: ELSE_AFTER_ONE_LINE_IF },
};

/** The unfixed parser reports the correct end if on line 6, not the stray one on line 4. */
export const ONE_LINE_IF_REPRO_2: Repro = {
  source: [
    'on mouseUp',
    '  if a then',
    '    if b then go next card',
    '    end if',
    '    answer "x"',
    '  end if',
    'end mouseUp',
  ].join('\n'),
  error: { kind: 'syntax', line: 4, column: 5, message: strayEndIfMessage(2) },
};

// ---- vocabulary -------------------------------------------------------------------

/** Source text and the tree the parser gives for it. */
interface Known<T> {
  text: string;
  tree: WithoutPos<T>;
}

const COMMANDS: readonly Known<Stmt>[] = [
  { text: 'howl', tree: { t: 'haunt', kind: 'howl' } },
  { text: 'release bat', tree: { t: 'haunt', kind: 'bat' } },
  { text: 'go next card', tree: { t: 'go', target: { k: 'next' } } },
  { text: 'go to prev card', tree: { t: 'go', target: { k: 'prev' } } },
  { text: 'answer "The door is locked."', tree: { t: 'answer', prompt: { t: 'str', value: 'The door is locked.' }, labels: [] } },
  { text: 'put 1 into n', tree: { t: 'putVar', value: { t: 'num', value: 1 }, name: 'n' } },
];

const CONDITIONS: readonly Known<Expr>[] = [
  { text: 'a', tree: { t: 'var', name: 'a' } },
  { text: 'not done', tree: { t: 'not', operand: { t: 'var', name: 'done' } } },
  { text: 'x is 1', tree: { t: 'bin', op: 'is', left: { t: 'var', name: 'x' }, right: { t: 'num', value: 1 } } },
  {
    text: 'field "door" is "open"',
    tree: { t: 'bin', op: 'is', left: { t: 'field', name: 'door' }, right: { t: 'str', value: 'open' } },
  },
];

/**
 * A statement the shapes are made of. A block if here holds one command in each part, so
 * none of its own lines is an else or end if right after a one-line if. `strayIf` is
 * `if c then` / a one-line if / `end if`: valid, with a stray end if (3.3).
 */
type Item =
  | { k: 'command'; cmd: Known<Stmt> }
  | { k: 'oneLineIf'; cond: Known<Expr>; then: Known<Stmt>; else: Known<Stmt> | undefined }
  | { k: 'blockIf'; cond: Known<Expr>; then: Known<Stmt>; else: Known<Stmt> | undefined }
  | { k: 'strayIf'; cond: Known<Expr>; last: Item };

const commandArb = fc.constantFrom(...COMMANDS);
const conditionArb = fc.constantFrom(...CONDITIONS);

const commandItemArb: fc.Arbitrary<Item> = commandArb.map((cmd): Item => ({ k: 'command', cmd }));

const oneLineIfArb = (withElse: boolean): fc.Arbitrary<Item> =>
  fc
    .tuple(conditionArb, commandArb, commandArb)
    .map(([cond, then, other]): Item => ({ k: 'oneLineIf', cond, then, else: withElse ? other : undefined }));

const blockIfItemArb: fc.Arbitrary<Item> = fc
  .tuple(conditionArb, commandArb, fc.option(commandArb, { nil: undefined }))
  .map(([cond, then, other]): Item => ({ k: 'blockIf', cond, then, else: other }));

/** Any item, for a place where the next code line starts a command or an if. */
const anyItemArb = fc.oneof(commandItemArb, oneLineIfArb(false), oneLineIfArb(true), blockIfItemArb);

/** Items an else line can follow without the bug condition (3.1, 3.2). */
const beforeElseItemArb = fc.oneof(commandItemArb, blockIfItemArb, oneLineIfArb(true));

/** Items an end if can follow without being a stray end if (3.1). */
const beforeEndIfItemArb = fc.oneof(commandItemArb, blockIfItemArb);

const oneLineIfEitherArb = fc.oneof(oneLineIfArb(false), oneLineIfArb(true));

/** Empty, or up to one item of any kind followed by `last`. */
const bodyArb = (last: fc.Arbitrary<Item>): fc.Arbitrary<Item[]> =>
  fc.oneof(
    fc.constant<Item[]>([]),
    fc.tuple(fc.array(anyItemArb, { maxLength: 1 }), last).map(([before, l]) => [...before, l]),
  );

const strayIfArb: fc.Arbitrary<Item> = fc
  .tuple(conditionArb, oneLineIfEitherArb)
  .map(([cond, last]): Item => ({ k: 'strayIf', cond, last }));

// ---- the line builder -------------------------------------------------------------

type CaseStyle = 'lower' | 'upper' | 'capital' | 'alternate';

/** How one code line is written. */
interface LineStyle {
  /** Two spaces or one tab per nesting level, or the same text at every level. */
  indent: { per: string } | { fixed: string };
  case: CaseStyle;
  /** Blank or comment-only lines written before the code line. None of them counts (glossary). */
  gap: readonly string[];
  /** Written after the code: nothing, blanks, or a comment. */
  tail: string;
}

const lineStyleArb: fc.Arbitrary<LineStyle> = fc.record({
  indent: fc.oneof(
    { weight: 3, arbitrary: fc.constant({ per: '  ' }) },
    { weight: 1, arbitrary: fc.constant({ per: '\t' }) },
    { weight: 1, arbitrary: fc.constantFrom('', ' ', '     ').map((fixed) => ({ fixed })) },
  ),
  case: fc.constantFrom<CaseStyle>('lower', 'lower', 'upper', 'capital', 'alternate'),
  gap: fc.oneof(
    { weight: 5, arbitrary: fc.constant<readonly string[]>([]) },
    {
      weight: 1,
      arbitrary: fc.constantFrom<readonly string[]>([''], ['   '], ['-- otherwise'], ['\t-- else'], ['', '  -- end if'], ['-- if a then howl']),
    },
  ),
  tail: fc.oneof(
    { weight: 5, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: fc.constantFrom(' ', '\t', ' -- the door', '  -- else', ' -- end if') },
  ),
});

const HANDLER_WORDS: ReadonlySet<string> = new Set(['mouseup', 'opencard']);

/** Strings, words and single characters, in order. The vocabulary has no comments. */
const PIECE = /"[^"]*"|[\p{L}_][\p{L}\p{M}0-9_]*|[\s\S]/gu;

function caseWord(word: string, style: CaseStyle): string {
  switch (style) {
    case 'lower': return word.toLowerCase();
    case 'upper': return word.toUpperCase();
    case 'capital': return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    case 'alternate': return [...word].map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join('');
  }
}

/** Writes every keyword and handler name in `style`. Strings and variable names keep their text. */
function recase(text: string, style: CaseStyle): string {
  return (text.match(PIECE) ?? [])
    .map((p) => (/^[\p{L}_]/u.test(p) && (isReserved(p) || HANDLER_WORDS.has(p.toLowerCase())) ? caseWord(p, style) : p))
    .join('');
}

/** Writes source line by line. Uses the styles in turn, from the first again when it runs out. */
class LineBuilder {
  private readonly lines: string[] = [];
  private next = 0;

  constructor(private readonly styles: readonly LineStyle[]) {}

  /** Writes one code line at nesting `depth`, after its gap lines, and returns where its first token is. */
  code(depth: number, text: string): Pos {
    const style = this.styles[this.next++ % this.styles.length]!;
    this.lines.push(...style.gap);
    const indent = 'per' in style.indent ? style.indent.per.repeat(depth) : style.indent.fixed;
    this.lines.push(indent + recase(text, style.case) + style.tail);
    // A tab is one column: columns count UTF-16 code units.
    return { line: this.lines.length, column: indent.length + 1 };
  }

  item(depth: number, item: Item): void {
    switch (item.k) {
      case 'command':
        this.code(depth, item.cmd.text);
        return;
      case 'oneLineIf':
        this.code(depth, `if ${item.cond.text} then ${item.then.text}${item.else ? ` else ${item.else.text}` : ''}`);
        return;
      case 'blockIf':
        this.code(depth, `if ${item.cond.text} then`);
        this.code(depth + 1, item.then.text);
        if (item.else) {
          this.code(depth, 'else');
          this.code(depth + 1, item.else.text);
        }
        this.code(depth, 'end if');
        return;
      case 'strayIf':
        this.code(depth, `if ${item.cond.text} then`);
        this.item(depth + 1, item.last);
        this.code(depth, 'end if');
        return;
    }
  }

  items(depth: number, items: readonly Item[]): void {
    for (const item of items) this.item(depth, item);
  }

  source(eol: string, finalBreak: boolean): string {
    return this.lines.join(eol) + (finalBreak ? eol : '');
  }
}

/** What every shape has around its handler. */
interface Frame {
  handler: HandlerName;
  /** The body of a complete valid handler of the other name, written first. It may hold a stray end if. */
  other: Item[] | undefined;
  styles: LineStyle[];
  eol: string;
  finalBreak: boolean;
}

const frameArb: fc.Arbitrary<Frame> = fc.record({
  handler: fc.constantFrom<HandlerName>('mouseUp', 'openCard'),
  other: fc.option(fc.array(fc.oneof(anyItemArb, strayIfArb), { maxLength: 3 }), { nil: undefined, freq: 2 }),
  styles: fc.array(lineStyleArb, { minLength: 1, maxLength: 12 }),
  eol: fc.constantFrom('\n', '\r\n'),
  finalBreak: fc.boolean(),
});

const otherName = (handler: HandlerName): HandlerName => (handler === 'mouseUp' ? 'openCard' : 'mouseUp');

/** Writes the other handler if any, then `on <handler>`, the body, and `end <handler>`. */
function writeScript<T>(frame: Frame, body: (b: LineBuilder) => T): { source: string; result: T } {
  const b = new LineBuilder(frame.styles);
  if (frame.other) {
    const name = otherName(frame.handler);
    b.code(0, `on ${name}`);
    b.items(1, frame.other);
    b.code(0, `end ${name}`);
  }
  b.code(0, `on ${frame.handler}`);
  const result = body(b);
  b.code(0, `end ${frame.handler}`);
  return { source: b.source(frame.eol, frame.finalBreak), result };
}

// ---- the bug condition shapes (C holds) -------------------------------------------

export interface IfShape {
  /**
   * 'else': an else or else if line right after a one-line if without else, inside a block if (2.1, 2.3).
   * 'end if': an unmatched else or end if, after a stray end if earlier in the same handler (2.4).
   */
  family: 'else' | 'end if';
  /** Which block ended before the else, or which unmatched line came, for the coverage check. */
  detail: string;
  handler: HandlerName;
  source: string;
  /** What the fixed parser reports. */
  error: SyntaxError;
  /** Family 'end if': where the if is that the reported end if closed. */
  closes?: Pos;
}

/** The block of the enclosing block if E that ends right before the else line. */
type EndedBlock = 'then part' | 'else if link' | 'else part';

/**
 * A family A script: handler-level items, 0 to 2 open block ifs, then E. The block of E that
 * ends is its then part, an else if link, or its else part, and it ends with `before` and
 * `last`. Every block of E before it ends with an item an else may follow. The follower is
 * `else` or `else if c then`, then one or two commands and the end ifs.
 */
interface ElseParts {
  frame: Frame;
  lead: Item[];
  /** The conditions of the open block ifs around E, outermost first. */
  wraps: Known<Expr>[];
  cond: Known<Expr>;
  ended: EndedBlock;
  /** E's then part, when it is not the block that ends. */
  thenBody: Item[];
  /** The else if links before the block that ends. */
  links: [Known<Expr>, Item[]][];
  /** The condition of the link that ends, for 'else if link'. */
  linkCond: Known<Expr>;
  before: Item[];
  last: Item;
  /** The condition of an `else if` follower, or undefined for a bare `else`. */
  follower: Known<Expr> | undefined;
  after: Item[];
}

const elsePartsArb = (last: fc.Arbitrary<Item>): fc.Arbitrary<ElseParts> =>
  fc.record({
    frame: frameArb,
    lead: fc.array(anyItemArb, { maxLength: 2 }),
    wraps: fc.array(conditionArb, { maxLength: 2 }),
    cond: conditionArb,
    ended: fc.constantFrom<EndedBlock>('then part', 'else if link', 'else part'),
    thenBody: bodyArb(beforeElseItemArb),
    links: fc.array(fc.tuple(conditionArb, bodyArb(beforeElseItemArb)), { maxLength: 2 }),
    linkCond: conditionArb,
    before: fc.array(anyItemArb, { maxLength: 2 }),
    last,
    follower: fc.option(conditionArb, { nil: undefined, freq: 2 }),
    after: fc.array(commandItemArb, { minLength: 1, maxLength: 2 }),
  });

/** Writes a family A script and returns where the follower's else is. */
function writeElseShape(s: ElseParts): { source: string; result: Pos } {
  return writeScript(s.frame, (b) => {
    b.items(1, s.lead);
    s.wraps.forEach((c, k) => b.code(1 + k, `if ${c.text} then`));
    const d = 1 + s.wraps.length;
    b.code(d, `if ${s.cond.text} then`);
    if (s.ended !== 'then part') {
      b.items(d + 1, s.thenBody);
      for (const [c, body] of s.links) {
        b.code(d, `else if ${c.text} then`);
        b.items(d + 1, body);
      }
      b.code(d, s.ended === 'else if link' ? `else if ${s.linkCond.text} then` : 'else');
    }
    b.items(d + 1, [...s.before, s.last]);
    const follower = b.code(d, s.follower ? `else if ${s.follower.text} then` : 'else');
    b.items(d + 1, s.after);
    b.code(d, 'end if');
    for (let k = s.wraps.length - 1; k >= 0; k--) b.code(1 + k, 'end if');
    return follower;
  });
}

/** Family A (2.1, 2.3): the block that ends ends with a one-line if without else. */
const elseAfterOneLineIfArb: fc.Arbitrary<IfShape> = elsePartsArb(oneLineIfArb(false))
  .map((s): IfShape => {
    const { source, result: at } = writeElseShape(s);
    return {
      family: 'else',
      detail: `${s.ended}, then ${s.follower ? 'else if' : 'else'}`,
      handler: s.frame.handler,
      source,
      error: { kind: 'syntax', line: at.line, column: at.column, message: ELSE_AFTER_ONE_LINE_IF },
    };
  });

/**
 * One block if of a group, from the outside in. With `thenCommand` set the if has an else
 * part: the then part is that one command, and the rest goes into the else part. The last
 * part holds `lead`, the next level in, and `last`. Its end if is stray when `last` is a
 * one-line if.
 */
interface Level {
  cond: Known<Expr>;
  thenCommand: Known<Stmt> | undefined;
  lead: Item[];
  last: Item | undefined;
}

const levelWith = (last: fc.Arbitrary<Item>): fc.Arbitrary<Level> =>
  fc.record({
    cond: conditionArb,
    thenCommand: fc.option(commandArb, { nil: undefined, freq: 2 }),
    lead: fc.array(commandItemArb, { maxLength: 1 }),
    last: fc.option(last, { nil: undefined, freq: 4 }),
  });

/** A level whose end if may be stray. */
const levelArb: fc.Arbitrary<Level> = levelWith(fc.oneof(beforeEndIfItemArb, oneLineIfEitherArb));

/** Handler-level items, then a block if of 1 to 3 levels. */
type Group = [lead: Item[], levels: Level[]];

const groupsArb = (level: fc.Arbitrary<Level>): fc.Arbitrary<Group[]> =>
  fc.array(fc.tuple(fc.array(anyItemArb, { maxLength: 1 }), fc.array(level, { minLength: 1, maxLength: 3 })), {
    minLength: 1,
    maxLength: 3,
  });

/**
 * Makes one level end with `last`, so its end if is stray, without changing the generated
 * values. `forced` counts the levels of all groups in source order, modulo their number.
 */
function forceLast(groups: readonly Group[], forced: number, last: Item): Group[] {
  const total = groups.reduce((n, [, levels]) => n + levels.length, 0);
  let index = forced % total;
  return groups.map(([lead, levels]): Group => [lead, levels.map((level) => (index-- === 0 ? { ...level, last } : level))]);
}

type Unmatched = { k: 'end if' } | { k: 'else' } | { k: 'else if'; cond: Known<Expr> };

const unmatchedArb: fc.Arbitrary<Unmatched> = fc.oneof(
  fc.constant<Unmatched>({ k: 'end if' }),
  fc.constant<Unmatched>({ k: 'else' }),
  conditionArb.map((cond): Unmatched => ({ k: 'else if', cond })),
);

interface Stray {
  end: Pos;
  /** The if that the end if closed. */
  head: Pos;
}

/** Writes the levels of one group, outermost first, and records each stray end if in source order. */
function writeLevels(b: LineBuilder, depth: number, levels: readonly Level[], strays: Stray[]): void {
  const [level, ...inner] = levels;
  if (!level) return;
  const head = b.code(depth, `if ${level.cond.text} then`);
  if (level.thenCommand) {
    b.code(depth + 1, level.thenCommand.text);
    b.code(depth, 'else');
  }
  b.items(depth + 1, level.lead);
  writeLevels(b, depth + 1, inner, strays);
  if (level.last) b.item(depth + 1, level.last);
  const end = b.code(depth, 'end if');
  if (level.last?.k === 'oneLineIf') strays.push({ end, head });
}

/** Writes the groups at handler level and returns their stray end ifs in source order. */
function writeGroups(b: LineBuilder, groups: readonly Group[]): Stray[] {
  const strays: Stray[] = [];
  for (const [lead, levels] of groups) {
    b.items(1, lead);
    writeLevels(b, 1, levels, strays);
  }
  return strays;
}

/** Writes the unmatched line at handler level and returns where it starts. An else gets a command and an end if. */
function writeUnmatched(b: LineBuilder, u: Unmatched, afterElse: Item): Pos {
  const at = b.code(1, u.k === 'else if' ? `else if ${u.cond.text} then` : u.k);
  if (u.k !== 'end if') {
    b.item(2, afterElse);
    b.code(1, 'end if');
  }
  return at;
}

/**
 * Family B (2.4). 1 to 3 block ifs at handler level, each holding 0 to 2 more levels, and at
 * least one end if right after a one-line if (one level is forced to end with one). Then a
 * handler-level line P that is not a one-line if (none, a command or a block if), then an
 * unmatched end if, else or else if, and, for an else, a command and an end if after it.
 */
const unmatchedAfterStrayEndIfArb: fc.Arbitrary<IfShape> = fc
  .record({
    frame: frameArb,
    groups: groupsArb(levelArb),
    forced: fc.nat(),
    forcedLast: oneLineIfEitherArb,
    p: fc.option(beforeEndIfItemArb, { nil: undefined }),
    unmatched: unmatchedArb,
    afterElse: commandItemArb,
  })
  .map((s): IfShape => {
    const groups = forceLast(s.groups, s.forced, s.forcedLast);
    const { source, result: stray } = writeScript(s.frame, (b) => {
      const strays = writeGroups(b, groups);
      if (s.p) b.item(1, s.p);
      writeUnmatched(b, s.unmatched, s.afterElse);
      return strays[strays.length - 1]!;
    });
    return {
      family: 'end if',
      detail: `unmatched ${s.unmatched.k}`,
      handler: s.frame.handler,
      source,
      error: { kind: 'syntax', line: stray.end.line, column: stray.end.column, message: strayEndIfMessage(stray.head.line) },
      closes: stray.head,
    };
  });

/** Scripts in the bug condition C by construction, with the error the fixed parser reports. */
export const bugShapeArb: fc.Arbitrary<IfShape> = fc.oneof(elseAfterOneLineIfArb, unmatchedAfterStrayEndIfArb);

// ---- the preserved shapes (C does not hold) ---------------------------------------

/** What the unfixed parser says for an unmatched else or else if (3.4, 3.5). */
export const UNMATCHED_ELSE = '"else" without a matching "if"; a one-line if keeps its else on the same line';

/** What the unfixed parser says for an unmatched end if (3.4, 3.5). */
export const UNMATCHED_END_IF = '"end if" without a matching "if" (a one-line if has no "end if")';

/** What the unfixed parser says for an else line after an else part (3.8). */
export const ALREADY_HAS_ELSE = 'this "if" already has an "else"';

/** A parse result with the tree's positions removed. */
export type ExpectedParse = { ok: true; script: WithoutPos<Script> } | { ok: false; error: SyntaxError };

export interface PreservedShape {
  /**
   * The family of design "Property-Based Tests":
   * 'A': an else or else if line after a block that does not end with a one-line if without else (3.1, 3.2, 3.7, 3.8).
   * 'B': an unmatched line with no stray end if before it in its handler, or right after a one-line if (3.4, 3.5).
   * 'C': family B without the unmatched line, so the script is valid (3.3).
   */
  family: 'A' | 'B' | 'C';
  /** Which case of the family, for the coverage check. */
  detail: string;
  handler: HandlerName;
  source: string;
  /** What the unfixed parser returns, and the fixed parser must still return. */
  expected: ExpectedParse;
}

type S = WithoutPos<Stmt>;

const ifTree = (cond: Known<Expr>, then: S[], otherwise: S[] = []): S => ({ t: 'if', cond: cond.tree, then, else: otherwise });

function itemTree(item: Item): S {
  switch (item.k) {
    case 'command':
      return item.cmd.tree;
    case 'oneLineIf':
    case 'blockIf':
      return ifTree(item.cond, [item.then.tree], item.else ? [item.else.tree] : []);
    case 'strayIf':
      return ifTree(item.cond, [itemTree(item.last)]);
  }
}

const itemTrees = (items: readonly Item[]): S[] => items.map(itemTree);

/** The tree that writeLevels writes, as a list of none or one statement. */
function levelsTree(levels: readonly Level[]): S[] {
  const [level, ...inner] = levels;
  if (!level) return [];
  const part = [...itemTrees(level.lead), ...levelsTree(inner), ...(level.last ? [itemTree(level.last)] : [])];
  return [level.thenCommand ? ifTree(level.cond, [level.thenCommand.tree], part) : ifTree(level.cond, part)];
}

const groupsTree = (groups: readonly Group[]): S[] =>
  groups.flatMap(([lead, levels]) => [...itemTrees(lead), ...levelsTree(levels)]);

/** The tree of the script writeScript writes, given the body of the frame's handler. */
function scriptTree(frame: Frame, body: S[]): WithoutPos<Script> {
  const main = { name: frame.handler, body };
  return { handlers: frame.other ? [{ name: otherName(frame.handler), body: itemTrees(frame.other) }, main] : [main] };
}

const syntaxAt = (at: Pos, message: string): SyntaxError => ({ kind: 'syntax', line: at.line, column: at.column, message });

const LAST_KIND: Readonly<Record<Item['k'], string>> = {
  command: 'a command',
  blockIf: 'a block if',
  strayIf: 'a block if closed right after a one-line if',
  oneLineIf: 'a one-line if with else',
};

/** What a block may end with before an else line without C: anything but a one-line if without else. */
const preservedLastArb = fc.oneof(commandItemArb, blockIfItemArb, strayIfArb, oneLineIfArb(true));

/**
 * Family A without C. The follower attaches to the block that ended: E itself after its then
 * part, or the last link after an else if link (3.1, 3.2, 3.7). After E's else part the
 * follower is `this "if" already has an "else"` (3.2, 3.8).
 */
const elseAfterOtherStatementArb: fc.Arbitrary<PreservedShape> = elsePartsArb(preservedLastArb).map((s): PreservedShape => {
  const { source, result: at } = writeElseShape(s);
  const shape = {
    family: 'A' as const,
    detail: `${s.ended} ends with ${LAST_KIND[s.last.k]}, then ${s.follower ? 'else if' : 'else'}`,
    handler: s.frame.handler,
    source,
  };
  if (s.ended === 'else part') return { ...shape, expected: { ok: false, error: syntaxAt(at, ALREADY_HAS_ELSE) } };

  const ended = [...itemTrees(s.before), itemTree(s.last)];
  const follower = s.follower ? [ifTree(s.follower, itemTrees(s.after))] : itemTrees(s.after);
  let e: S;
  if (s.ended === 'then part') {
    e = ifTree(s.cond, ended, follower);
  } else {
    // The chain is a nested if in each else part (R9.6), so build it from the last link out.
    let rest = [ifTree(s.linkCond, ended, follower)];
    for (const [c, body] of [...s.links].reverse()) rest = [ifTree(c, itemTrees(body), rest)];
    e = ifTree(s.cond, itemTrees(s.thenBody), rest);
  }
  const wrapped = s.wraps.reduceRight((inner, c) => ifTree(c, [inner]), e);
  return { ...shape, expected: { ok: true, script: scriptTree(s.frame, [...itemTrees(s.lead), wrapped]) } };
});

const unmatchedError = (at: Pos, u: Unmatched): SyntaxError => syntaxAt(at, u.k === 'end if' ? UNMATCHED_END_IF : UNMATCHED_ELSE);

/**
 * Family B without C, first case: no end if in this handler comes right after a one-line if
 * (3.5). Levels end with a command, a block if or nothing, and P is anything but a block if
 * with a stray end if. The other handler, when there is one, may hold a stray end if.
 */
const unmatchedWithoutStrayArb: fc.Arbitrary<PreservedShape> = fc
  .record({
    frame: frameArb,
    groups: groupsArb(levelWith(beforeEndIfItemArb)),
    p: fc.option(anyItemArb, { nil: undefined }),
    unmatched: unmatchedArb,
    afterElse: commandItemArb,
  })
  .map((s): PreservedShape => {
    const { source, result: at } = writeScript(s.frame, (b) => {
      const strays = writeGroups(b, s.groups);
      if (strays.length > 0) throw new Error('generator: a level without a stray end if has one');
      if (s.p) b.item(1, s.p);
      return writeUnmatched(b, s.unmatched, s.afterElse);
    });
    const otherStray = s.frame.other?.some((item) => item.k === 'strayIf') ?? false;
    return {
      family: 'B',
      detail: `no stray end if${otherStray ? ' here, one in the other handler' : ''}, then unmatched ${s.unmatched.k}`,
      handler: s.frame.handler,
      source,
      expected: { ok: false, error: unmatchedError(at, s.unmatched) },
    };
  });

/** Family B without C, second case: stray end ifs, but P right before the unmatched line is a one-line if (3.4). */
const unmatchedAfterOneLineIfArb: fc.Arbitrary<PreservedShape> = fc
  .record({
    frame: frameArb,
    groups: groupsArb(levelArb),
    forced: fc.nat(),
    forcedLast: oneLineIfEitherArb,
    p: oneLineIfEitherArb,
    unmatched: unmatchedArb,
    afterElse: commandItemArb,
  })
  .map((s): PreservedShape => {
    const groups = forceLast(s.groups, s.forced, s.forcedLast);
    const { source, result: at } = writeScript(s.frame, (b) => {
      writeGroups(b, groups);
      b.item(1, s.p);
      return writeUnmatched(b, s.unmatched, s.afterElse);
    });
    return {
      family: 'B',
      detail: `a stray end if, then a one-line if, then unmatched ${s.unmatched.k}`,
      handler: s.frame.handler,
      source,
      expected: { ok: false, error: unmatchedError(at, s.unmatched) },
    };
  });

/** Family C: family B without the unmatched line. Valid, with or without stray end ifs (3.3). */
const validWithStrayEndIfArb: fc.Arbitrary<PreservedShape> = fc
  .record({
    frame: frameArb,
    groups: groupsArb(levelArb),
    forced: fc.option(fc.nat(), { nil: undefined }),
    forcedLast: oneLineIfEitherArb,
    p: fc.option(fc.oneof(anyItemArb, strayIfArb), { nil: undefined }),
  })
  .map((s): PreservedShape => {
    const groups = s.forced === undefined ? s.groups : forceLast(s.groups, s.forced, s.forcedLast);
    const { source, result: strays } = writeScript(s.frame, (b) => {
      const found = writeGroups(b, groups).length;
      if (s.p) b.item(1, s.p);
      return found + (s.p?.k === 'strayIf' ? 1 : 0);
    });
    return {
      family: 'C',
      detail: strays > 0 ? 'with a stray end if' : 'without a stray end if',
      handler: s.frame.handler,
      source,
      expected: { ok: true, script: scriptTree(s.frame, [...groupsTree(groups), ...(s.p ? [itemTree(s.p)] : [])]) },
    };
  });

/** Scripts outside the bug condition C by construction, with what the unfixed parser returns for them. */
export const preservedShapeArb: fc.Arbitrary<PreservedShape> = fc.oneof(
  elseAfterOtherStatementArb,
  fc.oneof(unmatchedWithoutStrayArb, unmatchedAfterOneLineIfArb),
  validWithStrayEndIfArb,
);

// ---- scanning rendered sources ------------------------------------------------------

/** How often a one-line if is directly followed by an else or end if line. */
export interface OneLineIfFollowers {
  /** A one-line if without else, then an else or else if line: the shape the fix rejects (2.1, 2.3). */
  elseAfterNoElse: number;
  /** A one-line if with its own else, then an else or else if line (3.2). */
  elseAfterOwnElse: number;
  /** A one-line if, with or without else, then an end if line (3.3). */
  endIfAfter: number;
}

/**
 * Counts the lines that directly follow a one-line if, skipping blank and comment-only lines
 * (the lexer drops comments, so those lines have no tokens). The source must lex.
 */
export function oneLineIfFollowers(source: string): OneLineIfFollowers {
  const lexed = tokenize(source);
  if (!lexed.ok) throw new Error(`oneLineIfFollowers: the source does not lex (${lexed.error.message}):\n${source}`);
  const lines: Token[][] = [];
  let current: Token[] = [];
  for (const t of lexed.tokens) {
    if (t.kind !== 'newline' && t.kind !== 'eof') {
      current.push(t);
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = [];
  }
  const isWord = (t: Token | undefined, word: string) => t?.kind === 'word' && t.text.toLowerCase() === word;
  const counts: OneLineIfFollowers = { elseAfterNoElse: 0, elseAfterOwnElse: 0, endIfAfter: 0 };
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    if (!next || !isWord(line[0], 'if')) return;
    // `then` is reserved, so the first word `then` ends the condition.
    const then = line.findIndex((t) => isWord(t, 'then'));
    if (then < 0 || then === line.length - 1) return; // the block form
    const ownElse = line.slice(then + 1).some((t) => isWord(t, 'else'));
    if (isWord(next[0], 'else')) counts[ownElse ? 'elseAfterOwnElse' : 'elseAfterNoElse']++;
    else if (isWord(next[0], 'end') && isWord(next[1], 'if')) counts.endIfAfter++;
  });
  return counts;
}
