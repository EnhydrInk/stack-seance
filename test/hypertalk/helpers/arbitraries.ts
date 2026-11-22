// fast-check generators for HyperTalk syntax trees, and a renderer that writes a tree
// as source text with random keyword case, spacing, comments and blank lines.
// Trees are valid by construction and have no positions.

import fc from 'fast-check';
import type { BinOp, Effect, Expr, HandlerName, IfStmt, NavTarget, Script, Stmt, WithoutPos } from '../../../src/hypertalk/ast';
import { HAUNTS, isReserved } from '../../../src/hypertalk/tokens';
import type { Value } from '../../../src/hypertalk/values';
import type { FakeCardInit, FakeHostInit, FakeStackInit, FakeStacksInit, Reply } from './fakeHost';

export type E = WithoutPos<Expr>;
export type S = WithoutPos<Stmt>;
export type I = WithoutPos<IfStmt>;
export type Sc = WithoutPos<Script>;

// ---- leaves -------------------------------------------------------------------

/** Text for string literals: no `"` and no line breaks (R11.7). Includes `--` on purpose. */
export const textArb = fc.string({
  unit: fc.constantFrom(...'abcxyzABC019 .,!?#=&()<>+*/é\'', '--', ' -- '),
  maxLength: 10,
});

export const nameArb = fc.oneof(
  fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,6}$/).filter((n) => !isReserved(n)),
  fc.constantFrom('it', 'It', 'IT', 'x', 'n', 'score', 'café', 'Séance'),
);

export const numberArb = fc.oneof(
  fc.integer({ min: 0, max: 9999 }),
  fc.integer({ min: 0, max: 999_999 }).map((n) => n / 100),
  fc.constantFrom(0, 1, 1e21, 1e-7),
);

const leafArb: fc.Arbitrary<E> = fc.oneof(
  textArb.map((value): E => ({ t: 'str', value })),
  numberArb.map((value): E => ({ t: 'num', value })),
  fc.boolean().map((value): E => ({ t: 'bool', value })),
  nameArb.map((name): E => ({ t: 'var', name })),
  textArb.map((name): E => ({ t: 'field', name })),
);

export const BIN_OPS: readonly BinOp[] = [
  '&', '&&', '+', '-', '*', '/', 'is', 'isNot', '<', '>', '<=', '>=', 'contains', 'and', 'or',
];

export const exprArb: fc.Arbitrary<E> = fc.letrec<{ expr: E; bin: E; not: E; paren: E }>((tie) => ({
  expr: fc.oneof({ maxDepth: 3, depthIdentifier: 'expr' }, leafArb, tie('bin'), tie('not'), tie('paren')),
  bin: fc
    .tuple(fc.constantFrom(...BIN_OPS), tie('expr'), tie('expr'))
    .map(([op, left, right]): E => ({ t: 'bin', op, left, right })),
  not: tie('expr').map((operand): E => ({ t: 'not', operand })),
  paren: tie('expr').map((inner): E => ({ t: 'paren', inner })),
})).expr;

// ---- statements ---------------------------------------------------------------

const NAV: readonly NavTarget[] = ['next', 'prev', 'first', 'last'];
const EFFECTS: readonly Effect[] = ['dissolve', 'wipeLeft', 'wipeRight', 'irisOpen', 'irisClose'];

export const simpleStmtArb: fc.Arbitrary<S> = fc.oneof(
  fc.constantFrom(...NAV).map((k): S => ({ t: 'go', target: { k } })),
  exprArb.map((expr): S => ({ t: 'go', target: { k: 'card', expr } })),
  // go-to-stack-command Requirement 9.1: every expression form as a stack target.
  exprArb.map((expr): S => ({ t: 'go', target: { k: 'stack', expr } })),
  fc.constantFrom(...EFFECTS).map((effect): S => ({ t: 'effect', effect })),
  fc.tuple(exprArb, fc.array(textArb, { maxLength: 3 })).map(([prompt, labels]): S => ({ t: 'answer', prompt, labels })),
  exprArb.map((prompt): S => ({ t: 'ask', prompt })),
  fc
    .tuple(exprArb, fc.constantFrom<'into' | 'after' | 'before'>('into', 'after', 'before'), textArb)
    .map(([value, mode, field]): S => ({ t: 'putField', value, mode, field })),
  fc.tuple(exprArb, nameArb).map(([value, name]): S => ({ t: 'putVar', value, name })),
  fc
    .tuple(fc.constantFrom<'show' | 'hide'>('show', 'hide'), fc.constantFrom<'button' | 'field'>('button', 'field'), textArb)
    .map(([t, kind, name]): S => ({ t, kind, name })),
  exprArb.map((seconds): S => ({ t: 'wait', seconds })),
  fc.array(nameArb, { minLength: 1, maxLength: 3 }).map((names): S => ({ t: 'global', names })),
  fc.constantFrom(...HAUNTS.map((h) => h.kind)).map((kind): S => ({ t: 'haunt', kind })),
);

/** Folds `if c then … else if c2 then … [else …]` into nested ifs (R9.6). */
function chain(cond: E, then: S[], links: [E, S[]][], last: S[] | null): I {
  const root: I = { t: 'if', cond, then, else: [] };
  let tail = root;
  for (const [c, body] of links) {
    const link: I = { t: 'if', cond: c, then: body, else: [] };
    tail.else = [link];
    tail = link;
  }
  if (last) tail.else = last;
  return root;
}

const stmtByDepth = new Map<number, fc.Arbitrary<S>>();

/** Statements with `if` blocks nested at most `depth` deep. */
export function stmtArb(depth: number): fc.Arbitrary<S> {
  if (depth <= 0) return simpleStmtArb;
  const cached = stmtByDepth.get(depth);
  if (cached) return cached;
  const body = fc.array(stmtArb(depth - 1), { maxLength: 3 });
  const plainIf = fc.tuple(exprArb, body, body).map(([cond, then, els]): S => ({ t: 'if', cond, then, else: els }));
  // Fits the one-line form: one command in then, at most one in else.
  const shortIf = fc
    .tuple(exprArb, simpleStmtArb, fc.option(simpleStmtArb))
    .map(([cond, s, e]): S => ({ t: 'if', cond, then: [s], else: e ? [e] : [] }));
  const chainIf = fc
    .tuple(exprArb, body, fc.array(fc.tuple(exprArb, body), { minLength: 1, maxLength: 4 }), fc.option(body))
    .map(([cond, then, links, last]): S => chain(cond, then, links, last));
  const arb = fc.oneof(
    { weight: 5, arbitrary: simpleStmtArb },
    { weight: 1, arbitrary: plainIf },
    { weight: 1, arbitrary: shortIf },
    { weight: 1, arbitrary: chainIf },
  );
  stmtByDepth.set(depth, arb);
  return arb;
}

export const MAX_IF_DEPTH = 4;

const handlerBodyArb = fc.array(stmtArb(MAX_IF_DEPTH), { maxLength: 4 });

export const scriptArb: fc.Arbitrary<Sc> = fc
  .tuple(fc.option(handlerBodyArb), fc.option(handlerBodyArb), fc.boolean())
  .map(([mouseUp, openCard, openCardFirst]): Sc => {
    const handlers: { name: HandlerName; body: S[] }[] = [];
    if (mouseUp) handlers.push({ name: 'mouseUp', body: mouseUp });
    if (openCard) handlers.push({ name: 'openCard', body: openCard });
    if (openCardFirst) handlers.reverse();
    return { handlers };
  });

// ---- source renderer ----------------------------------------------------------

export interface RenderOptions {
  /**
   * Force every `if` that fits on one line into one form. Default: random.
   * `'oneLine'` still writes the block form for an `if` without `else` that is the last
   * command before an `else` or `else if` line, because the parser rejects the one-line form there.
   */
  ifForm?: 'random' | 'oneLine' | 'block';
  /** Add parentheses that are not needed (they become `paren` nodes). Default: true. */
  redundantParens?: boolean;
}

/** Writes a tree as source. The same tree, seed and options always give the same text. */
export function renderScript(script: Sc, seed: number, options: RenderOptions = {}): string {
  return new Renderer(mulberry32(seed), options).script(script);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Precedence from R11.2, written out again here so the renderer does not share the printer's table.
const OR = 1, NOT = 3, CMP = 4, PRIMARY = 8;
const LEVEL: Record<BinOp, number> = {
  or: 1, and: 2,
  is: 4, isNot: 4, '<': 4, '>': 4, '<=': 4, '>=': 4, contains: 4,
  '&': 5, '&&': 5, '+': 6, '-': 6, '*': 7, '/': 7,
};
const WORD_OPS: ReadonlySet<string> = new Set(['is', 'contains', 'and', 'or']);
const level = (e: E): number => (e.t === 'bin' ? LEVEL[e.op] : e.t === 'not' ? NOT : PRIMARY);

const EFFECT_WORDS: Record<Effect, string[]> = {
  dissolve: ['dissolve'],
  wipeLeft: ['wipe', 'left'],
  wipeRight: ['wipe', 'right'],
  irisOpen: ['iris', 'open'],
  irisClose: ['iris', 'close'],
};

const COMMENTS = ['note', 'go to next card', 'if then else', '"unclosed', 'end mouseUp', '# @ =', '--', 'é'];

type Tok = { kind: 'kw' | 'name' | 'num' | 'str' | 'op'; text: string };

class Renderer {
  private readonly lines: string[] = [];

  constructor(
    private readonly random: () => number,
    private readonly options: RenderOptions,
  ) {}

  private chance(p: number): boolean {
    return this.random() < p;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)]!;
  }

  private kw(word: string): Tok {
    const r = this.random();
    let text: string;
    if (r < 0.4) text = word.toLowerCase();
    else if (r < 0.6) text = word.toUpperCase();
    else if (r < 0.8) text = word.charAt(0).toUpperCase() + word.slice(1);
    else text = [...word].map((c) => (this.chance(0.5) ? c.toUpperCase() : c.toLowerCase())).join('');
    return { kind: 'kw', text };
  }

  private join(toks: Tok[]): string {
    const wordish = (t: Tok) => t.kind === 'kw' || t.kind === 'name' || t.kind === 'num';
    let out = '';
    toks.forEach((t, i) => {
      if (i > 0) {
        const prev = toks[i - 1]!;
        out += wordish(prev) && wordish(t) ? this.pick([' ', ' ', '  ', '\t', ' \t ']) : this.pick(['', ' ', ' ', '  ']);
      }
      out += t.text;
    });
    return out;
  }

  private emit(depth: number, toks: Tok[]): void {
    if (this.chance(0.08)) this.lines.push(this.pick(['', '   ', '\t']));
    if (this.chance(0.05)) this.lines.push(`${this.pick(['', '  ', '\t'])}-- ${this.pick(COMMENTS)}`);
    const indent = this.pick(['', ' ', '  '.repeat(depth), '\t'.repeat(depth), '    ']);
    let line = indent + this.join(toks);
    if (this.chance(0.1)) line += `${this.pick([' ', '\t', '   '])}-- ${this.pick(COMMENTS)}`;
    else if (this.chance(0.1)) line += this.pick([' ', '\t', '  ']);
    this.lines.push(line);
  }

  script(script: Sc): string {
    for (const h of script.handlers) {
      this.emit(0, [this.kw('on'), this.kw(h.name)]);
      this.block(h.body, 1);
      this.emit(0, [this.kw('end'), this.kw(h.name)]);
      if (this.chance(0.5)) this.lines.push('');
    }
    const eol = this.chance(0.3) ? '\r\n' : '\n';
    return this.lines.join(eol) + (this.chance(0.5) ? eol : '');
  }

  /** `beforeElse`: an `else` or `else if` line comes right after this block. */
  private block(stmts: S[], depth: number, beforeElse = false): void {
    stmts.forEach((s, i) => {
      if (s.t === 'if') this.ifStmt(s, depth, beforeElse && i === stmts.length - 1);
      else this.emit(depth, this.simple(s));
    });
  }

  private ifStmt(s: I, depth: number, beforeElse = false): void {
    const [first] = s.then;
    const [elseFirst] = s.else;
    const fits =
      s.then.length === 1 && first!.t !== 'if' &&
      (s.else.length === 0 || (s.else.length === 1 && elseFirst!.t !== 'if'));
    // The parser rejects a one-line if without else right before an else or else if line.
    const oneLineAllowed = fits && !(beforeElse && s.else.length === 0);
    const form = this.options.ifForm ?? 'random';
    if (oneLineAllowed && (form === 'oneLine' || (form === 'random' && this.chance(0.5)))) {
      const toks = [this.kw('if'), ...this.expr(s.cond), this.kw('then'), ...this.simple(first as Exclude<S, I>)];
      if (elseFirst) toks.push(this.kw('else'), ...this.simple(elseFirst as Exclude<S, I>));
      this.emit(depth, toks);
      return;
    }
    this.emit(depth, [this.kw('if'), ...this.expr(s.cond), this.kw('then')]);
    // Each continuation is chosen before the block in front of it is written, so that
    // block knows whether an else line follows it.
    let body = s.then;
    let tail = s;
    for (;;) {
      const only = tail.else.length === 1 ? tail.else[0] : undefined;
      const isElseIf = only?.t === 'if' && this.chance(0.6);
      // An explicit empty else gives the same tree as no else.
      const isElse = !isElseIf && (tail.else.length > 0 || this.chance(0.15));
      this.block(body, depth + 1, isElseIf || isElse);
      if (isElseIf) {
        this.emit(depth, [this.kw('else'), this.kw('if'), ...this.expr(only.cond), this.kw('then')]);
        body = only.then;
        tail = only;
        continue;
      }
      if (isElse) {
        this.emit(depth, [this.kw('else')]);
        this.block(tail.else, depth + 1);
      }
      this.emit(depth, [this.kw('end'), this.kw('if')]);
      return;
    }
  }

  private simple(s: Exclude<S, I>): Tok[] {
    const kw = (w: string) => this.kw(w);
    const str = (text: string): Tok => ({ kind: 'str', text: `"${text}"` });
    const to = () => (this.chance(0.5) ? [kw('to')] : []);
    switch (s.t) {
      case 'haunt':
        return HAUNTS.find((h) => h.kind === s.kind)!.words.map(kw);
      case 'go':
        switch (s.target.k) {
          case 'card':
          case 'stack':
            return [kw('go'), ...to(), kw(s.target.k), ...this.expr(s.target.expr, PRIMARY)];
          default:
            return [kw('go'), ...to(), kw(s.target.k), kw('card')];
        }
      case 'effect':
        return [kw('visual'), kw('effect'), ...EFFECT_WORDS[s.effect].map(kw)];
      case 'answer': {
        const toks = [kw('answer'), ...this.expr(s.prompt)];
        s.labels.forEach((label, i) => toks.push(kw(i === 0 ? 'with' : 'or'), str(label)));
        return toks;
      }
      case 'ask':
        return [kw('ask'), ...this.expr(s.prompt)];
      case 'putField':
        return [kw('put'), ...this.expr(s.value), kw(s.mode), kw('field'), str(s.field)];
      case 'putVar':
        return [kw('put'), ...this.expr(s.value), kw('into'), { kind: 'name', text: s.name }];
      case 'show':
      case 'hide':
        return [kw(s.t), kw(s.kind), str(s.name)];
      case 'wait':
        return [kw('wait'), ...this.expr(s.seconds), kw(this.pick(['second', 'seconds']))];
      case 'global':
        return [
          kw('global'),
          ...s.names.flatMap((name, i): Tok[] => [
            ...(i > 0 ? [{ kind: 'op', text: ',' } as Tok] : []),
            { kind: 'name', text: name },
          ]),
        ];
    }
  }

  /** Tokens for `e` where an expression of at least level `min` is expected. */
  private expr(e: E, min = OR): Tok[] {
    const toks = this.bare(e);
    const needed = level(e) < min;
    const extra = !needed && (this.options.redundantParens ?? true) && e.t !== 'paren' && this.chance(0.08);
    return needed || extra ? [{ kind: 'op', text: '(' }, ...toks, { kind: 'op', text: ')' }] : toks;
  }

  private bare(e: E): Tok[] {
    switch (e.t) {
      case 'str': return [{ kind: 'str', text: `"${e.value}"` }];
      case 'num': return [{ kind: 'num', text: numberText(e.value) }];
      case 'bool': return [this.kw(e.value ? 'true' : 'false')];
      case 'var': return [{ kind: 'name', text: e.name }];
      case 'field': return [this.kw('field'), { kind: 'str', text: `"${e.name}"` }];
      case 'paren': return [{ kind: 'op', text: '(' }, ...this.expr(e.inner), { kind: 'op', text: ')' }];
      case 'not': return [this.kw('not'), ...this.expr(e.operand, NOT)];
      case 'bin': {
        const lvl = LEVEL[e.op];
        const left = this.expr(e.left, lvl === CMP ? lvl + 1 : lvl);
        const op: Tok[] =
          e.op === 'isNot' ? [this.kw('is'), this.kw('not')]
          : WORD_OPS.has(e.op) ? [this.kw(e.op)]
          : [{ kind: 'op', text: e.op }];
        return [...left, ...op, ...this.expr(e.right, lvl + 1)];
      }
    }
  }
}

function numberText(n: number): string {
  const s = String(n);
  return s.includes('e') ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 }) : s;
}

// ---- mutations (P4) -----------------------------------------------------------
// A mutant is a rendered valid script with one to three edits applied. Most edits
// break the syntax; the P4 test keeps the mutants that fail to parse.

export type Mutation =
  | { op: 'delete'; at: number }
  | { op: 'duplicate'; at: number }
  | { op: 'swap'; at: number; with: number }
  | { op: 'replace'; at: number; text: string }
  | { op: 'truncate'; at: number }
  | { op: 'insertLine'; at: number; text: string; crlf: boolean };

export const MUTATION_OPS: readonly Mutation['op'][] = ['delete', 'duplicate', 'swap', 'replace', 'truncate', 'insertLine'];

export interface Mutant {
  original: string;
  mutations: Mutation[];
  source: string;
}

// Splits text into pieces whose concatenation is the text again. Written apart from the
// lexer so that mutations do not depend on the code under test, and so that it accepts
// any text, including text an earlier mutation already broke.
const PIECE = /\r\n|\n|[ \t]+|--[^\r\n]*|"[^"\r\n]*"?|[\p{L}_][\p{L}\p{M}0-9_]*|[0-9]+(?:\.[0-9]+)?|&&|<=|>=|[\s\S]/gu;
const GAP = /^[ \t]+$/;

const multiWordHaunts = HAUNTS.filter((h) => h.words.length > 1);

/** Tokens that replace a token: keywords, operators, and characters the lexer rejects. */
const REPLACEMENTS: readonly string[] = [
  'on', 'end', 'if', 'then', 'else', 'go', 'to', 'card', 'stack', 'next', 'put', 'into', 'after', 'field', 'button',
  'with', 'or', 'and', 'not', 'is', 'contains', 'global', 'wait', 'seconds', 'true', 'it', 'x', 'mouseUp',
  ...HAUNTS.flatMap((h): readonly string[] => h.words),
  '(', ')', ',', '+', '-', '*', '<', '>=', '&', '&&', '"', '"text"', '7', '2.5', '.', '.5', '1.',
  '=', "'", '\u201C', '\u00A0', '\r', '\n', '9'.repeat(400),
];

/** Whole lines to insert. Most are wrong; a few are valid so not every insert breaks the script. */
const JUNK_LINES: readonly string[] = [
  'end if', 'else', 'else if x then', 'end mouseUp', 'end openCard', 'on mouseUp', 'on openCard', 'on mouseDown', 'end',
  'if x then', 'if x then if y then go to next card', 'if x then go to next card else if y then go to prev card',
  'put 1 into', 'put 1 into true', 'put 1 after x', 'global false', 'go to card', 'go to card n + 1', 'go nowhere',
  // go-to-stack-command Requirement 9.10
  'go to stack', 'go to stack n + 1', 'go to card 1 of stack "A"', 'put 1 into stack',
  'answer "a" with "b" or "c" or "d" or "e"', 'answer "a" with b', 'ask', 'wait 1', 'show "x"', 'visual effect wipe up',
  '"unclosed', 'put "a -- b into x', 'x = 1', 'put 1 < 2 < 3 into x', 'put -5 into x', 'put .5 into x', 'put (1 into x',
  "put 'a' into x", 'go\rto next card', '\u00A0',
  ...multiWordHaunts.map((h) => h.words[0]),
  ...multiWordHaunts.map((h) => `${h.words[0]} cat`),
  ...HAUNTS.map((h) => `put 1 into ${h.words[h.words.length - 1]}`),
  'go to next card', '-- only a comment', '', '   ',
];

const junkLineArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...JUNK_LINES) },
  { weight: 1, arbitrary: fc.string({ unit: fc.constantFrom(...'abc ()"=,-&<>+*/.019\t'), maxLength: 12 }) },
);

export const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.nat().map((at): Mutation => ({ op: 'delete', at })),
  fc.nat().map((at): Mutation => ({ op: 'duplicate', at })),
  fc.tuple(fc.nat(), fc.nat()).map(([at, other]): Mutation => ({ op: 'swap', at, with: other })),
  fc.tuple(fc.nat(), fc.constantFrom(...REPLACEMENTS)).map(([at, text]): Mutation => ({ op: 'replace', at, text })),
  fc.nat().map((at): Mutation => ({ op: 'truncate', at })),
  fc.tuple(fc.nat(), junkLineArb, fc.boolean()).map(([at, text, crlf]): Mutation => ({ op: 'insertLine', at, text, crlf })),
);

/**
 * Applies one edit. `at` and `with` pick a token (or a character for truncate, a line
 * boundary for insertLine) modulo the number available, so any number is valid.
 * Tokens here are everything but runs of spaces and tabs: words, numbers, strings,
 * operators, comments and line breaks. Moved or new tokens get a space on each side
 * so they do not glue onto their neighbours.
 */
export function applyMutation(source: string, m: Mutation): string {
  if (m.op === 'truncate') return source.length === 0 ? source : source.slice(0, m.at % source.length);
  if (m.op === 'insertLine') {
    const eol = m.crlf ? '\r\n' : '\n';
    const starts = [0];
    for (let k = 0; k < source.length; k++) if (source[k] === '\n') starts.push(k + 1);
    const appendAtEnd = source.length > 0 && !source.endsWith('\n');
    const slot = m.at % (starts.length + (appendAtEnd ? 1 : 0));
    if (slot === starts.length) return source + eol + m.text;
    const at = starts[slot]!;
    return source.slice(0, at) + m.text + eol + source.slice(at);
  }
  const pieces = source.match(PIECE) ?? [];
  const tokens = pieces.flatMap((p, i) => (GAP.test(p) ? [] : [i]));
  if (tokens.length === 0) return source;
  const i = tokens[m.at % tokens.length]!;
  const piece = pieces[i]!;
  switch (m.op) {
    case 'delete':
      pieces[i] = '';
      break;
    case 'duplicate':
      pieces[i] = `${piece} ${piece}`;
      break;
    case 'replace':
      pieces[i] = ` ${m.text} `;
      break;
    case 'swap': {
      const j = tokens[m.with % tokens.length]!;
      const other = pieces[j]!;
      pieces[i] = ` ${other} `;
      pieces[j] = ` ${piece} `;
      break;
    }
  }
  return pieces.join('');
}

/** A rendered valid script with one to three mutations applied in order. */
export const mutantArb: fc.Arbitrary<Mutant> = fc
  .tuple(scriptArb, fc.integer(), fc.array(mutationArb, { minLength: 1, maxLength: 3 }))
  .map(([ast, seed, mutations]): Mutant => {
    const original = renderScript(ast, seed);
    return { original, mutations, source: mutations.reduce(applyMutation, original) };
  });

// ---- stacks and go targets (P2) -------------------------------------------------
// A stack is 1..20 cards with unique names. Each card's script is empty, valid, has a
// runtime error in openCard, or has a syntax error, so every outcome of P2 comes up.

/** What a card's script does when its openCard runs. */
export type CardScriptKind = 'empty' | 'valid' | 'runtimeError' | 'syntaxError';

export interface GenCardScript {
  script: string;
  kind: CardScriptKind;
  /** For the two error kinds: the line the error names. */
  errorLine?: number;
}

export interface GenCard extends GenCardScript {
  name: string;
}

export interface GenStack {
  cards: GenCard[];
  /** 1-based index of the current card. */
  current: number;
}

/** Letters only, so a card name never looks like a number (R2.3). */
export const cardNameArb = fc.stringMatching(/^[A-Z][a-z]{0,7}$/);

/** Has a space and a digit, so it is never a card name from cardNameArb, and never looks numeric. */
const missingNameArb = fc.oneof(fc.stringMatching(/^[A-Za-z]{1,6} [0-9]$/), fc.constant(''));

/** Scripts whose openCard (if any) runs without an error and stays on its card. */
const VALID_CARD_SCRIPTS: readonly string[] = [
  'on openCard\n  howl\nend openCard',
  '-- counts visits\non openCard\n  global visits\n  put visits & "*" into visits\nend openCard\n',
  // The effect dies with this openCard run (R3.5).
  'on openCard\n  visual effect dissolve\n  put "seen" into x\nend openCard',
  // No openCard handler, so going here runs nothing (R1.7).
  'on mouseUp\n  go to next card\nend mouseUp',
  'on openCard\nend openCard',
  '-- nothing happens on this card\n',
];

const FILLER_LINES: readonly string[] = ['put 1 into x', 'howl', 'global visits', '-- a comment', ''];

/** Each fails at run time on its own line. None moves: a failing go leaves the card alone. */
const RUNTIME_ERROR_LINES: readonly string[] = [
  'put 1 / 0 into x',
  'put "ghost" + 1 into x',
  'put field "missing" into x',
  'hide button "missing"',
  'wait "soon" seconds',
  'if "maybe" then howl',
  'go to card 99',
  'go to card "Nowhere 7"',
];

/** Each is a syntax error on its own line (lexer or parser). */
const SYNTAX_ERROR_LINES: readonly string[] = [
  'go nowhere',
  'put 1 into true',
  'summon cat',
  'put "unclosed into x',
  'put 1 < 2 < 3 into x',
  'answer "a" with "b" or "c" or "d" or "e"',
  'end mouseUp',
  'put -5 into x',
  'x = 1',
];

/** An openCard handler with one bad line among valid ones, and the line number of the bad one. */
function brokenScriptArb(kind: 'runtimeError' | 'syntaxError'): fc.Arbitrary<GenCardScript> {
  return fc
    .tuple(
      fc.array(fc.constantFrom('-- notes', ''), { maxLength: 2 }),
      fc.array(fc.constantFrom(...FILLER_LINES), { maxLength: 3 }),
      fc.constantFrom(...(kind === 'runtimeError' ? RUNTIME_ERROR_LINES : SYNTAX_ERROR_LINES)),
      fc.array(fc.constantFrom(...FILLER_LINES), { maxLength: 2 }),
      fc.boolean(),
    )
    .map(([head, before, bad, after, finalBreak]): GenCardScript => {
      const body = [...before, bad, ...after].map((l) => `  ${l}`);
      const lines = [...head, 'on openCard', ...body, 'end openCard'];
      return { script: lines.join('\n') + (finalBreak ? '\n' : ''), kind, errorLine: head.length + 2 + before.length };
    });
}

export const cardScriptArb: fc.Arbitrary<GenCardScript> = fc.oneof(
  fc.constant<GenCardScript>({ script: '', kind: 'empty' }),
  fc.constantFrom(...VALID_CARD_SCRIPTS).map((script): GenCardScript => ({ script, kind: 'valid' })),
  brokenScriptArb('runtimeError'),
  brokenScriptArb('syntaxError'),
);

export const stackArb: fc.Arbitrary<GenStack> = fc
  .uniqueArray(fc.tuple(cardNameArb, cardScriptArb), {
    minLength: 1,
    maxLength: 20,
    selector: ([name]) => name.toLowerCase(),
  })
  .chain((entries) => {
    const cards = entries.map(([name, s]): GenCard => ({ name, ...s }));
    // The first and the last card come up often, so both wraps do too.
    const current = fc.oneof(fc.constant(1), fc.constant(cards.length), fc.integer({ min: 1, max: cards.length }));
    return current.map((c): GenStack => ({ cards, current: c }));
  });

/** How a string target reaches the go: as a literal, or as the reply to `ask` in `it` (R2.3). */
export type Via = 'literal' | 'ask';

export type GoCase =
  | { k: 'nav'; nav: NavTarget }
  /** A number value: a literal, or `(0 - n)` for a negative one (there is no unary minus). */
  | { k: 'number'; n: number }
  /** A string that looks like a number (R11.4), such as " 3 ", "007", "3.0" or "2.5". */
  | { k: 'numericString'; text: string; n: number; whole: boolean; via: Via }
  /** A name of a card in the stack in random case, or a name no card has. */
  | { k: 'name'; name: string; via: Via };

const viaArb = fc.constantFrom<Via>('literal', 'ask');

const numericStringArb = fc
  .tuple(
    fc.integer({ min: -5, max: 30 }),
    fc.constantFrom('', '.0', '.5'),
    fc.constantFrom('plain', 'padded', 'zeros'),
    viaArb,
  )
  .map(([n, fraction, style, via]): GoCase => {
    const digits = style === 'zeros' ? `00${Math.abs(n)}` : `${Math.abs(n)}`;
    const number = `${n < 0 ? '-' : ''}${digits}${fraction}`;
    const text = style === 'padded' ? ` ${number} ` : number;
    return { k: 'numericString', text, n, whole: fraction !== '.5', via };
  });

/** Go targets for a stack: the four named ones, integers from -5 to 30, numeric strings, names. */
export function goCaseArb(stack: GenStack): fc.Arbitrary<GoCase> {
  const names = stack.cards.map((c) => c.name);
  return fc.oneof(
    fc.constantFrom<NavTarget>(...NAV).map((nav): GoCase => ({ k: 'nav', nav })),
    fc.integer({ min: -5, max: 30 }).map((n): GoCase => ({ k: 'number', n })),
    numericStringArb,
    fc.tuple(fc.mixedCase(fc.constantFrom(...names)), viaArb).map(([name, via]): GoCase => ({ k: 'name', name, via })),
    fc.tuple(missingNameArb, viaArb).map(([name, via]): GoCase => ({ k: 'name', name, via })),
  );
}

export const navCaseArb: fc.Arbitrary<{ stack: GenStack; target: GoCase }> = stackArb.chain((stack) =>
  goCaseArb(stack).map((target) => ({ stack, target })),
);

export interface GoScript {
  /** A mouseUp handler whose last command is the go. */
  source: string;
  /** Replies for the fake host: the text that `ask` returns. */
  replies: string[];
  goLine: number;
}

export function goScript(target: GoCase): GoScript {
  const handler = (lines: string[]) => ['on mouseUp', ...lines.map((l) => `  ${l}`), 'end mouseUp'].join('\n');
  switch (target.k) {
    case 'nav':
      return { source: handler([`go to ${target.nav} card`]), replies: [], goLine: 2 };
    case 'number': {
      const expr = target.n < 0 ? `(0 - ${-target.n})` : `${target.n}`;
      return { source: handler([`go to card ${expr}`]), replies: [], goLine: 2 };
    }
    case 'numericString':
    case 'name': {
      const text = target.k === 'name' ? target.name : target.text;
      if (target.via === 'ask') {
        return { source: handler(['ask "Which card?"', 'go to card it']), replies: [text], goLine: 3 };
      }
      return { source: handler([`go to card "${text}"`]), replies: [], goLine: 2 };
    }
  }
}

// ---- stacks and go to stack targets (stack P2) ------------------------------------
// go-to-stack-command Requirement 9.2, 9.3: 1 to 5 stacks with names unique ignoring case,
// each with 1 to 4 cards whose ids are unique across all stacks. Only the first card of the
// target stack is ever opened, so its script kind decides between outcomes (a) and (c).
// The card P2 above keeps its single stack (Requirement 9.6).

export interface GenStackOfCards {
  /** `st<n>`, n the 1-based position in the set. Given to the fake host explicitly. */
  id: string;
  name: string;
  /** 1 to 4. Ids are `st<n>-c<m>`; scripts come from cardScriptArb. */
  cards: (GenCard & { id: string })[];
}

export interface GenStackSet {
  /** 1 to 5, names unique ignoring case. */
  stacks: GenStackOfCards[];
  /** 1-based position in `stacks` of the starting stack. */
  currentStack: number;
  /** 1-based index of the starting card, in that stack. */
  current: number;
}

export interface StackTarget {
  /** What the generator meant the text to be: a stack's name as written or in other case, or no stack's name. */
  rel: 'asWritten' | 'otherCase' | 'missing';
  /** The text the runtime must pass to findStackByName. */
  text: string;
  /** A string literal, the reply to `ask` read through `it`, or a number literal whose String(n) is `text`. */
  via: 'literal' | 'ask' | 'number';
}

export interface StackNavCase {
  set: GenStackSet;
  target: StackTarget;
  /** The `visual effect` before the go, if any. */
  effect: Effect | null;
}

const DIGIT_NAMES: readonly string[] = ['0', '1', '2', '3', '4', '5'];

/** One or two capitalised words: never numeric, never empty, and never MISSING_NAME or a missingNameArb name. */
const letteredStackNameArb = fc.stringMatching(/^[A-Z][a-z]{0,6}( [A-Z][a-z]{0,6})?$/);

/**
 * Lettered names, or one time in five a digit name, so a name never looks like a missing name
 * from missingNameArb (those have a space and a digit, or are empty).
 */
const stackNameArb = fc.oneof(
  { weight: 4, arbitrary: letteredStackNameArb },
  { weight: 1, arbitrary: fc.constantFrom(...DIGIT_NAMES) },
);

const isDigitName = (name: string) => /^[0-9]$/.test(name);

/** Swaps the case of every letter. A lettered name always changes, and still matches only its own stack. */
const swapCase = (text: string) =>
  [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');

/** A target and, when it names a stack, that stack's 0-based position. */
function stackTargetArb(stacks: readonly GenStackOfCards[]): fc.Arbitrary<[StackTarget, number | undefined]> {
  const textVia = fc.constantFrom<StackTarget['via']>('literal', 'ask');
  const named = stacks.map((s, i) => [s, i] as const);
  const lettered = named.filter(([s]) => !isDigitName(s.name));
  const used = new Set(stacks.map((s) => s.name));
  const unusedDigits = Array.from({ length: 10 }, (_, d) => String(d)).filter((d) => !used.has(d));
  const asWritten = fc.constantFrom(...named).chain(([s, i]) =>
    // A number literal can only write a digit name.
    (isDigitName(s.name) ? fc.constantFrom<StackTarget['via']>('literal', 'ask', 'number') : textVia).map(
      (via): [StackTarget, number] => [{ rel: 'asWritten', text: s.name, via }, i],
    ),
  );
  const otherCase = lettered.length
    ? [
        fc
          .tuple(fc.constantFrom(...lettered), textVia)
          .map(([[s, i], via]): [StackTarget, number] => [{ rel: 'otherCase', text: swapCase(s.name), via }, i]),
      ]
    : [];
  const missing = fc.oneof(
    { weight: 3, arbitrary: fc.tuple(missingNameArb, textVia).map(([text, via]): StackTarget => ({ rel: 'missing', text, via })) },
    // 6 to 9 are never stack names, so there is always an unused digit.
    { weight: 1, arbitrary: fc.constantFrom(...unusedDigits).map((text): StackTarget => ({ rel: 'missing', text, via: 'number' })) },
  );
  return fc.oneof(
    asWritten,
    ...otherCase,
    missing.map((t): [StackTarget, undefined] => [t, undefined]),
  );
}

export const stackNavCaseArb: fc.Arbitrary<StackNavCase> = fc
  .uniqueArray(fc.tuple(stackNameArb, fc.array(fc.tuple(cardNameArb, cardScriptArb), { minLength: 1, maxLength: 4 })), {
    minLength: 1,
    maxLength: 5,
    selector: ([name]) => name.toLowerCase(),
  })
  .chain((entries) => {
    const stacks = entries.map(
      ([name, cards], i): GenStackOfCards => ({
        id: `st${i + 1}`,
        name,
        cards: cards.map(([cardName, script], j) => ({ id: `st${i + 1}-c${j + 1}`, name: cardName, ...script })),
      }),
    );
    return stackTargetArb(stacks).chain(([target, index]) => {
      const anyStack = fc.integer({ min: 1, max: stacks.length });
      // Often the target stack itself, so a go to the current stack from a card other than 1 comes up.
      const start = index === undefined ? anyStack : fc.oneof(fc.constant(index + 1), anyStack);
      return start.chain((currentStack) => {
        const count = stacks[currentStack - 1]!.cards.length;
        return fc
          .tuple(fc.oneof(fc.constant(count), fc.integer({ min: 1, max: count })), fc.option(fc.constantFrom(...EFFECTS), { nil: null }))
          .map(([current, effect]): StackNavCase => ({ set: { stacks, currentStack, current }, target, effect }));
      });
    });
  });

/** `on mouseUp`, [`visual effect …`], [`ask "Which stack?"`], `go to stack …`, `end mouseUp`. */
export function stackGoScript(c: StackNavCase): GoScript {
  const { text, via } = c.target;
  const lines: string[] = [];
  if (c.effect) lines.push(`visual effect ${EFFECT_WORDS[c.effect].join(' ')}`);
  if (via === 'ask') lines.push('ask "Which stack?"');
  lines.push(via === 'ask' ? 'go to stack it' : via === 'number' ? `go to stack ${text}` : `go to stack "${text}"`);
  return {
    source: ['on mouseUp', ...lines.map((l) => `  ${l}`), 'end mouseUp'].join('\n'),
    replies: via === 'ask' ? [text] : [],
    goLine: lines.length + 1,
  };
}

// ---- runnable sessions (P3, P5) ---------------------------------------------------
// A session is a stack whose cards have fields, buttons and scripts, the globals so far,
// a list of dialog replies, and a mouseUp script to run. The script mostly names fields,
// buttons, cards and variables that exist, and mostly computes with values of the right
// type, so most runs get past their first commands. Sometimes it names a missing item or
// mixes types, so runs also fail (design: "Testing strategy").

export const FIELD_NAMES: readonly string[] = ['score', 'Note', 'out'];
export const BUTTON_NAMES: readonly string[] = ['Door', 'lamp'];
/** Few names, so globals, locals and `it` meet. `visits` is also a global in VALID_CARD_SCRIPTS. */
export const VARIABLE_NAMES: readonly string[] = ['x', 'N', 'it', 'visits'];

/** No field, button or card in a session has this name (card names have no space or digit). */
const MISSING_NAME = 'Nowhere 7';

/** One of `names` in random case, or now and then a name that does not exist. */
const someNameArb = (names: readonly string[]): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 12, arbitrary: fc.mixedCase(fc.constantFrom(...names)) },
    { weight: 1, arbitrary: fc.constant(MISSING_NAME) },
  );

const smallNumberArb = fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 999 }).map((n) => n / 10));

const num = (value: number): E => ({ t: 'num', value });
const bin = ([op, left, right]: [BinOp, E, E]): E => ({ t: 'bin', op, left, right });
const runVarArb = fc.mixedCase(fc.constantFrom(...VARIABLE_NAMES)).map((name): E => ({ t: 'var', name }));
const runFieldArb = someNameArb(FIELD_NAMES).map((name): E => ({ t: 'field', name }));

/**
 * Expressions by the type they mostly give. Variables and fields can hold anything, so
 * an arithmetic or boolean operator on them sometimes fails, as it should for P5.
 * The first alternative of each is a leaf, because oneof falls back to it at maxDepth.
 */
const typedExprArb = fc.letrec<{ num: E; value: E; bool: E }>((tie) => ({
  num: fc.oneof(
    { maxDepth: 2, depthIdentifier: 'typed' },
    { weight: 4, arbitrary: smallNumberArb.map(num) },
    { weight: 1, arbitrary: runVarArb },
    { weight: 1, arbitrary: runFieldArb },
    { weight: 2, arbitrary: fc.tuple(fc.constantFrom<BinOp>('+', '-', '*', '/'), tie('num'), tie('num')).map(bin) },
  ),
  value: fc.oneof(
    { maxDepth: 2, depthIdentifier: 'typed' },
    { weight: 3, arbitrary: textArb.map((value): E => ({ t: 'str', value })) },
    { weight: 2, arbitrary: tie('num') },
    { weight: 2, arbitrary: runVarArb },
    { weight: 2, arbitrary: runFieldArb },
    { weight: 2, arbitrary: fc.tuple(fc.constantFrom<BinOp>('&', '&&'), tie('value'), tie('value')).map(bin) },
  ),
  bool: fc.oneof(
    { maxDepth: 2, depthIdentifier: 'typed' },
    { weight: 2, arbitrary: fc.boolean().map((value): E => ({ t: 'bool', value })) },
    {
      weight: 4,
      arbitrary: fc
        .tuple(fc.constantFrom<BinOp>('is', 'isNot', '<', '>', '<=', '>=', 'contains'), tie('value'), tie('value'))
        .map(bin),
    },
    { weight: 1, arbitrary: tie('bool').map((operand): E => ({ t: 'not', operand })) },
    { weight: 1, arbitrary: fc.tuple(fc.constantFrom<BinOp>('and', 'or'), tie('bool'), tie('bool')).map(bin) },
  ),
}));

/** go to a named target, to a card number (0 and count + 1 are missing), to a card name, or to `it`. */
function runnableGoArb(cards: readonly string[]): fc.Arbitrary<S> {
  const toCard = (expr: E): S => ({ t: 'go', target: { k: 'card', expr } });
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...NAV).map((k): S => ({ t: 'go', target: { k } })) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: cards.length + 1 }).map((n) => toCard(num(n))) },
    { weight: 2, arbitrary: someNameArb(cards).map((value) => toCard({ t: 'str', value })) },
    { weight: 1, arbitrary: fc.constant(toCard({ t: 'var', name: 'it' })) },
  );
}

/**
 * go to stack with an existing name in random case, sometimes MISSING_NAME, the empty name,
 * or `it`, which holds a stack name when `ask` got one (go-to-stack-command Requirement 9.7).
 */
function runnableStackGoArb(stacks: readonly string[]): fc.Arbitrary<S> {
  const toStack = (expr: E): S => ({ t: 'go', target: { k: 'stack', expr } });
  return fc.oneof(
    { weight: 4, arbitrary: someNameArb(stacks).map((value) => toStack({ t: 'str', value })) },
    { weight: 1, arbitrary: fc.constant(toStack({ t: 'str', value: '' })) },
    { weight: 1, arbitrary: fc.constant(toStack({ t: 'var', name: 'it' })) },
  );
}

/**
 * Every command but if. With `cards` null there is no go. Without `stacks` there is no
 * go to stack, and the commands are exactly the ones sessionArb has always drawn from.
 */
function runnableSimpleArb(cards: readonly string[] | null, stacks?: readonly string[]): fc.Arbitrary<S> {
  const varName = fc.mixedCase(fc.constantFrom(...VARIABLE_NAMES));
  const item = fc.oneof(
    someNameArb(BUTTON_NAMES).map((name) => ({ kind: 'button' as const, name })),
    someNameArb(FIELD_NAMES).map((name) => ({ kind: 'field' as const, name })),
  );
  const commands: fc.Arbitrary<S>[] = [
    fc.constantFrom(...EFFECTS).map((effect): S => ({ t: 'effect', effect })),
    fc
      .tuple(typedExprArb.value, fc.array(textArb, { maxLength: 3 }))
      .map(([prompt, labels]): S => ({ t: 'answer', prompt, labels })),
    typedExprArb.value.map((prompt): S => ({ t: 'ask', prompt })),
    fc
      .tuple(typedExprArb.value, fc.constantFrom<'into' | 'after' | 'before'>('into', 'after', 'before'), someNameArb(FIELD_NAMES))
      .map(([value, mode, field]): S => ({ t: 'putField', value, mode, field })),
    fc.tuple(typedExprArb.value, varName).map(([value, name]): S => ({ t: 'putVar', value, name })),
    fc
      .tuple(fc.constantFrom<'show' | 'hide'>('show', 'hide'), item)
      .map(([t, { kind, name }]): S => ({ t, kind, name })),
    typedExprArb.num.map((seconds): S => ({ t: 'wait', seconds })),
    fc.array(varName, { minLength: 1, maxLength: 2 }).map((names): S => ({ t: 'global', names })),
    fc.constantFrom(...HAUNTS.map((h) => h.kind)).map((kind): S => ({ t: 'haunt', kind })),
  ];
  if (cards) commands.push(runnableGoArb(cards));
  if (stacks) commands.push(runnableStackGoArb(stacks));
  return fc.oneof(...commands);
}

/** Commands with if blocks and else-if chains nested at most `depth` deep. */
function runnableStmtArb(cards: readonly string[] | null, depth: number, stacks?: readonly string[]): fc.Arbitrary<S> {
  const simple = runnableSimpleArb(cards, stacks);
  if (depth <= 0) return simple;
  const body = fc.array(runnableStmtArb(cards, depth - 1, stacks), { maxLength: 3 });
  const cond = typedExprArb.bool;
  const plainIf = fc.tuple(cond, body, body).map(([c, then, els]): S => ({ t: 'if', cond: c, then, else: els }));
  const chainIf = fc
    .tuple(cond, body, fc.array(fc.tuple(cond, body), { minLength: 1, maxLength: 2 }), fc.option(body))
    .map(([c, then, links, last]): S => chain(c, then, links, last));
  return fc.oneof(
    { weight: 4, arbitrary: simple },
    { weight: 1, arbitrary: plainIf },
    { weight: 1, arbitrary: chainIf },
  );
}

/** A mouseUp handler of 1 to 6 commands for these card names and, if given, these stack names. */
export function runnableScriptArb(cards: readonly string[], stacks?: readonly string[]): fc.Arbitrary<Sc> {
  return fc
    .array(runnableStmtArb(cards, 2, stacks), { minLength: 1, maxLength: 6 })
    .map((body): Sc => ({ handlers: [{ name: 'mouseUp', body }] }));
}

/**
 * openCard handlers that go on at once, so a go can start a chain of them up to the
 * depth limit (R14.4). Each has one go, so a chain stays a line and never fans out.
 */
const CHAINING_CARD_SCRIPTS: readonly string[] = [
  'on openCard\n  go to next card\nend openCard',
  '-- back again\non openCard\n  visual effect dissolve\n\n  go to prev card\nend openCard\n',
];

/** Generated openCard handlers have no go, for the same reason. */
const runnableOpenCardArb = fc
  .tuple(fc.array(runnableStmtArb(null, 1), { minLength: 1, maxLength: 4 }), fc.integer())
  .map(([body, seed]) => renderScript({ handlers: [{ name: 'openCard', body }] }, seed));

const sessionCardScriptArb: fc.Arbitrary<string> = fc.oneof(
  cardScriptArb.map((s) => s.script),
  fc.constantFrom(...CHAINING_CARD_SCRIPTS),
  runnableOpenCardArb,
);

/** Each of `arbs` or, one time in ten, nothing, in order. */
const mostOf = <T>(arbs: fc.Arbitrary<T>[]): fc.Arbitrary<T[]> =>
  fc
    .tuple(...arbs.map((a) => fc.option(a, { nil: undefined, freq: 10 })))
    .map((xs) => xs.filter((x): x is T => x !== undefined));

const fieldTextArb = fc.oneof(fc.constantFrom('', '0', '3', '-2', '2.5', ' 7 ', 'true'), textArb);

const cardItemsArb = fc.record({
  fields: mostOf(FIELD_NAMES.map((name) => fc.record({ name: fc.constant(name), text: fieldTextArb, visible: fc.boolean() }))),
  buttons: mostOf(BUTTON_NAMES.map((name) => fc.record({ name: fc.constant(name), visible: fc.boolean() }))),
});

/** Typed text, a card number or name for `go to card it`, a boolean, or Cancel. */
const replyArb = (cards: readonly string[]): fc.Arbitrary<Reply> =>
  fc.option(
    fc.oneof(textArb, fc.constantFrom('1', '2', ' 3 ', '-1', '2.5', 'true', 'false'), fc.mixedCase(fc.constantFrom(...cards))),
    { nil: null },
  );

const globalsArb: fc.Arbitrary<[string, Value][]> = fc.uniqueArray(
  fc.tuple(fc.constantFrom(...VARIABLE_NAMES.map((n) => n.toLowerCase())), fc.oneof(textArb, smallNumberArb)),
  { maxLength: 3, selector: ([key]) => key },
);

export interface Session {
  /**
   * sessionArb: one stack of 1 to 8 cards. stackSessionArb: 1 to 3 stacks of 1 to 3 cards each.
   * Either way, cards with names unique across the session, fields, buttons and scripts, the
   * current card (and stack), and the replies.
   */
  host: FakeHostInit | FakeStacksInit;
  /** The global store before the run, keys lower-cased. */
  globals: [string, Value][];
  /** The mouseUp script to run, rendered with random case, spacing, comments and blank lines. */
  source: string;
}

export const sessionArb: fc.Arbitrary<Session> = fc
  .uniqueArray(fc.tuple(cardNameArb, sessionCardScriptArb, cardItemsArb), {
    minLength: 1,
    maxLength: 8,
    selector: ([name]) => name.toLowerCase(),
  })
  .chain((entries) => {
    const names = entries.map(([name]) => name);
    const cards = entries.map(([name, script, items]): FakeCardInit => ({ name, script, ...items }));
    return fc
      .record({
        current: fc.integer({ min: 1, max: cards.length }),
        script: runnableScriptArb(names),
        seed: fc.integer(),
        replies: fc.array(replyArb(names), { maxLength: 4 }),
        globals: globalsArb,
      })
      .map(({ current, script, seed, replies, globals }): Session => ({
        host: { cards, current, replies },
        globals,
        source: renderScript(script, seed),
      }));
  });

// ---- sessions with several stacks (P3, P5; go-to-stack-command Requirement 9.7) -----
// sessionArb above stays as it is, so the fixed-seed coverage tests that sample it keep
// their meaning. These sessions add stacks, and go to stack in the run script and in card
// scripts. Card gos draw from every card name of the session, so the name of a card in
// another stack is a missing card.

/** An openCard handler that goes to a stack at once, so stack gos can chain to the depth limit (R14.4). */
const stackGoCardScriptArb = (stacks: readonly string[]): fc.Arbitrary<string> =>
  someNameArb(stacks).map((name) => `on openCard\n  go to stack "${name}"\nend openCard`);

export const stackSessionArb: fc.Arbitrary<Session> = fc
  .uniqueArray(letteredStackNameArb, { minLength: 1, maxLength: 3, selector: (name) => name.toLowerCase() })
  .chain((stackNames) =>
    fc.array(fc.integer({ min: 1, max: 3 }), { minLength: stackNames.length, maxLength: stackNames.length }).chain((sizes) => {
      const total = sizes.reduce((a, b) => a + b, 0);
      const script = fc.oneof(
        { weight: 3, arbitrary: sessionCardScriptArb },
        { weight: 1, arbitrary: stackGoCardScriptArb(stackNames) },
      );
      return fc
        .uniqueArray(fc.tuple(cardNameArb, script, cardItemsArb), {
          minLength: total,
          maxLength: total,
          selector: ([name]) => name.toLowerCase(),
        })
        .map((entries) => ({ stackNames, sizes, entries }));
    }),
  )
  .chain(({ stackNames, sizes, entries }) => {
    // One list of unique card names, cut into the stacks in order.
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
    const stacks = stackNames.map(
      (name, i): FakeStackInit => ({
        name,
        cards: entries
          .slice(starts[i], starts[i]! + sizes[i]!)
          .map(([cardName, script, items]): FakeCardInit => ({ name: cardName, script, ...items })),
      }),
    );
    const cardNames = entries.map(([name]) => name);
    return fc.integer({ min: 1, max: stacks.length }).chain((currentStack) =>
      fc
        .record({
          current: fc.integer({ min: 1, max: sizes[currentStack - 1]! }),
          script: runnableScriptArb(cardNames, stackNames),
          seed: fc.integer(),
          replies: fc.array(replyArb([...cardNames, ...stackNames]), { maxLength: 4 }),
          globals: globalsArb,
        })
        .map(({ current, script, seed, replies, globals }): Session => ({
          host: { stacks, currentStack, current, replies },
          globals,
          source: renderScript(script, seed),
        })),
    );
  });

/** Single-stack and multi-stack sessions, for P3 and P5. */
export const anySessionArb: fc.Arbitrary<Session> = fc.oneof(sessionArb, stackSessionArb);
