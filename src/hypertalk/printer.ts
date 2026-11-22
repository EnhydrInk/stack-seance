// Prints a syntax tree as canonical HyperTalk source (see design.md, "Printer").
// Used for the round-trip property and for normalising the compiler's output.
// Never used to show a card's script: comments are not in the tree and are lost here.
//
// Accepts trees with or without positions. Assumes the restrictions the parser
// guarantees: strings without `"` or line breaks, non-negative finite numbers,
// variable names that are not reserved words.

import type { BinOp, Effect, Expr, Handler, IfStmt, Script, Stmt, WithoutPos } from './ast';
import { HAUNTS, type HauntKind } from './tokens';

type P<T> = WithoutPos<T>;

const INDENT = '  ';

export function print(script: P<Script>): string {
  if (script.handlers.length === 0) return '';
  return script.handlers.map(printHandler).join('\n\n') + '\n';
}

function printHandler(handler: P<Handler>): string {
  return [`on ${handler.name}`, ...printBlock(handler.body, 1), `end ${handler.name}`].join('\n');
}

function printBlock(stmts: P<Stmt>[], depth: number): string[] {
  return stmts.flatMap((s) => printStmt(s, depth));
}

function printStmt(s: P<Stmt>, depth: number): string[] {
  if (s.t === 'if') return printIf(s, depth);
  return [INDENT.repeat(depth) + printSimple(s)];
}

const EFFECT_WORDS: Record<Effect, string> = {
  dissolve: 'dissolve',
  wipeLeft: 'wipe left',
  wipeRight: 'wipe right',
  irisOpen: 'iris open',
  irisClose: 'iris close',
};

/** A haunt prints as the words of its HAUNTS entry, lowercase, one space apart (R15). */
const HAUNT_TEXT: ReadonlyMap<HauntKind, string> = new Map(
  HAUNTS.map((h) => [h.kind, h.words.join(' ').toLowerCase()]),
);

function printSimple(s: Exclude<P<Stmt>, P<IfStmt>>): string {
  switch (s.t) {
    case 'haunt':
      return HAUNT_TEXT.get(s.kind)!;
    case 'go':
      switch (s.target.k) {
        case 'card':
        case 'stack':
          // The target is a primary expression: anything else is printed in parentheses (go-to-stack-command Requirement 2.2).
          return `go to ${s.target.k} ${printExpr(s.target.expr, PRIMARY)}`;
        default:
          return `go to ${s.target.k} card`;
      }
    case 'effect':
      return `visual effect ${EFFECT_WORDS[s.effect]}`;
    case 'answer': {
      const labels = s.labels.length ? ` with ${s.labels.map(quote).join(' or ')}` : '';
      return `answer ${printExpr(s.prompt)}${labels}`;
    }
    case 'ask':
      return `ask ${printExpr(s.prompt)}`;
    case 'putField':
      return `put ${printExpr(s.value)} ${s.mode} field ${quote(s.field)}`;
    case 'putVar':
      return `put ${printExpr(s.value)} into ${s.name}`;
    case 'show':
    case 'hide':
      return `${s.t} ${s.kind} ${quote(s.name)}`;
    case 'wait': {
      const one = s.seconds.t === 'num' && s.seconds.value === 1;
      return `wait ${printExpr(s.seconds)} ${one ? 'second' : 'seconds'}`;
    }
    case 'global':
      return `global ${s.names.join(', ')}`;
  }
}

/** Always the block form. An `else` that holds exactly one `if` prints as `else if` (R9.6). */
function printIf(s: P<IfStmt>, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const lines = [`${pad}if ${printExpr(s.cond)} then`, ...printBlock(s.then, depth + 1)];
  let tail = s;
  for (;;) {
    const only = tail.else.length === 1 ? tail.else[0] : undefined;
    if (only?.t === 'if') {
      lines.push(`${pad}else if ${printExpr(only.cond)} then`, ...printBlock(only.then, depth + 1));
      tail = only;
      continue;
    }
    if (tail.else.length > 0) lines.push(`${pad}else`, ...printBlock(tail.else, depth + 1));
    lines.push(`${pad}end if`);
    return lines;
  }
}

// ---- expressions ------------------------------------------------------------

// Precedence levels from R11.2, lowest first.
const OR = 1;
const AND = 2;
const NOT = 3;
const COMPARISON = 4;
const CONCAT = 5;
const ADDITIVE = 6;
const MULTIPLICATIVE = 7;
const PRIMARY = 8;

const BIN_LEVEL: Record<BinOp, number> = {
  or: OR,
  and: AND,
  is: COMPARISON, isNot: COMPARISON, '<': COMPARISON, '>': COMPARISON, '<=': COMPARISON, '>=': COMPARISON,
  contains: COMPARISON,
  '&': CONCAT, '&&': CONCAT,
  '+': ADDITIVE, '-': ADDITIVE,
  '*': MULTIPLICATIVE, '/': MULTIPLICATIVE,
};

function level(e: P<Expr>): number {
  if (e.t === 'bin') return BIN_LEVEL[e.op];
  if (e.t === 'not') return NOT;
  return PRIMARY;
}

/**
 * Prints `e` so that it parses back as `e` where an expression of at least
 * `min` level is expected, adding parentheses only where they are needed.
 */
function printExpr(e: P<Expr>, min = OR): string {
  const text = printBare(e);
  return level(e) < min ? `(${text})` : text;
}

function printBare(e: P<Expr>): string {
  switch (e.t) {
    case 'str': return quote(e.value);
    case 'num': return printNumber(e.value);
    case 'bool': return e.value ? 'true' : 'false';
    case 'var': return e.name;
    case 'field': return `field ${quote(e.name)}`;
    case 'paren': return `(${printExpr(e.inner)})`;
    // `not` takes a comparison or another `not` (R11.2).
    case 'not': return `not ${printExpr(e.operand, NOT)}`;
    case 'bin': {
      const lvl = BIN_LEVEL[e.op];
      // Left-associative: the right operand needs parentheses at the same level.
      // Comparisons do not chain, so a comparison needs them on either side.
      const leftMin = lvl === COMPARISON ? lvl + 1 : lvl;
      const op = e.op === 'isNot' ? 'is not' : e.op;
      return `${printExpr(e.left, leftMin)} ${op} ${printExpr(e.right, lvl + 1)}`;
    }
  }
}

function quote(text: string): string {
  return `"${text}"`;
}

/** `String(n)`, except that exponent forms such as 1e+21 are written out so the lexer can read them. */
function printNumber(n: number): string {
  const s = String(n);
  if (!s.includes('e')) return s;
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 });
}
