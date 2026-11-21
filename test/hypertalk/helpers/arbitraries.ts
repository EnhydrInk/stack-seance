// fast-check generators for HyperTalk syntax trees, and a renderer that writes a tree
// as source text with random keyword case, spacing, comments and blank lines.
// Trees are valid by construction and have no positions.

import fc from 'fast-check';
import type { BinOp, Effect, Expr, HandlerName, IfStmt, NavTarget, Script, Stmt, WithoutPos } from '../../../src/hypertalk/ast';
import { HAUNTS, isReserved } from '../../../src/hypertalk/tokens';

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
  /** Force every `if` that fits on one line into one form. Default: random. */
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

  private block(stmts: S[], depth: number): void {
    for (const s of stmts) {
      if (s.t === 'if') this.ifStmt(s, depth);
      else this.emit(depth, this.simple(s));
    }
  }

  private ifStmt(s: I, depth: number): void {
    const [first] = s.then;
    const [elseFirst] = s.else;
    const fits =
      s.then.length === 1 && first!.t !== 'if' &&
      (s.else.length === 0 || (s.else.length === 1 && elseFirst!.t !== 'if'));
    const form = this.options.ifForm ?? 'random';
    if (fits && (form === 'oneLine' || (form === 'random' && this.chance(0.5)))) {
      const toks = [this.kw('if'), ...this.expr(s.cond), this.kw('then'), ...this.simple(first as Exclude<S, I>)];
      if (elseFirst) toks.push(this.kw('else'), ...this.simple(elseFirst as Exclude<S, I>));
      this.emit(depth, toks);
      return;
    }
    this.emit(depth, [this.kw('if'), ...this.expr(s.cond), this.kw('then')]);
    this.block(s.then, depth + 1);
    let tail = s;
    for (;;) {
      const only = tail.else.length === 1 ? tail.else[0] : undefined;
      if (only?.t === 'if' && this.chance(0.6)) {
        this.emit(depth, [this.kw('else'), this.kw('if'), ...this.expr(only.cond), this.kw('then')]);
        this.block(only.then, depth + 1);
        tail = only;
        continue;
      }
      // An explicit empty else gives the same tree as no else.
      if (tail.else.length > 0 || this.chance(0.15)) {
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
        return s.target.k === 'card'
          ? [kw('go'), ...to(), kw('card'), ...this.expr(s.target.expr, PRIMARY)]
          : [kw('go'), ...to(), kw(s.target.k), kw('card')];
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

