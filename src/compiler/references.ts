// The walk over a parsed script for Rules 3, 4, 5, 6 and 8 (design.md, "references.ts").
// It uses only the AST types and positions of the interpreter's public API.

import type { Expr, Script, Stmt } from '../hypertalk/index';
import { looksNumeric } from './names';

/** A Literal_Target with its parentheses removed. */
export type Target = { lit: 'str'; value: string } | { lit: 'num'; value: number } | { lit: 'bool'; value: boolean };

/**
 * One name the script uses, with its script line. `afterGo` and `afterStackGo` are the line of
 * the first `go` (or `go to stack`) that some path runs before this point, when there is one.
 */
export type Reference =
  | { kind: 'cardName'; text: string; target: Target; line: number; afterStackGo?: number }
  | { kind: 'cardNumber'; value: number; target: Target; line: number; afterStackGo?: number }
  | { kind: 'stack'; text: string; target: Target; line: number }
  | { kind: 'field' | 'button'; name: string; line: number; afterGo?: number };

/** What the paths that reach a point have run so far. */
interface State {
  /** The line of the first `go` that some path has run. */
  go?: number;
  /** The line of the first `go to stack` that some path has run. */
  stackGo?: number;
}

/** Every reference of every handler, in source order. Each handler starts with a fresh state. */
export function collectReferences(script: Script): Reference[] {
  const found: Reference[] = [];
  for (const handler of script.handlers) walkList(handler.body, {}, found);
  return found;
}

function walkList(stmts: readonly Stmt[], state: State, found: Reference[]): State {
  return stmts.reduce((s, stmt) => walk(stmt, s, found), state);
}

function walk(stmt: Stmt, state: State, found: Reference[]): State {
  const line = stmt.pos.line;
  switch (stmt.t) {
    case 'if': {
      visit(stmt.cond, state, found);
      const then = walkList(stmt.then, state, found);
      const otherwise = walkList(stmt.else, state, found);
      return { go: earliest(then.go, otherwise.go), stackGo: earliest(then.stackGo, otherwise.stackGo) };
    }
    case 'go': {
      const target = stmt.target;
      if (target.k === 'card' || target.k === 'stack') {
        // The target is read before the move: `go to card field "dest"` reads this card's field.
        visit(target.expr, state, found);
        const lit = literal(target.expr);
        if (lit) found.push(target.k === 'card' ? cardReference(lit, line, state) : { kind: 'stack', text: literalText(lit), target: lit, line });
      }
      return {
        go: state.go ?? line,
        stackGo: target.k === 'stack' ? (state.stackGo ?? line) : state.stackGo,
      };
    }
    case 'putField':
      visit(stmt.value, state, found);
      found.push(nameReference('field', stmt.field, line, state));
      return state;
    case 'show':
    case 'hide':
      found.push(nameReference(stmt.kind, stmt.name, line, state));
      return state;
    case 'answer':
    case 'ask':
      visit(stmt.prompt, state, found);
      return state;
    case 'wait':
      visit(stmt.seconds, state, found);
      return state;
    case 'putVar':
      visit(stmt.value, state, found);
      return state;
    case 'effect':
    case 'global':
    case 'haunt':
      return state;
  }
}

/** Records every `field` node inside an expression. */
function visit(expr: Expr, state: State, found: Reference[]): void {
  switch (expr.t) {
    case 'field':
      found.push(nameReference('field', expr.name, expr.pos.line, state));
      return;
    case 'bin':
      visit(expr.left, state, found);
      visit(expr.right, state, found);
      return;
    case 'not':
      visit(expr.operand, state, found);
      return;
    case 'paren':
      visit(expr.inner, state, found);
      return;
    case 'str':
    case 'num':
    case 'bool':
    case 'var':
      return;
  }
}

function nameReference(kind: 'field' | 'button', name: string, line: number, state: State): Reference {
  return state.go === undefined ? { kind, name, line } : { kind, name, line, afterGo: state.go };
}

/**
 * A card number when the target is a number, or a string that Looks_Numeric (the runtime's
 * `toNumber` gives `Number(value)`, R2.3). Any other literal is a card name.
 */
function cardReference(target: Target, line: number, state: State): Reference {
  const after = state.stackGo === undefined ? {} : { afterStackGo: state.stackGo };
  if (target.lit === 'num') return { kind: 'cardNumber', value: target.value, target, line, ...after };
  if (target.lit === 'str' && looksNumeric(target.value)) {
    return { kind: 'cardNumber', value: Number(target.value), target, line, ...after };
  }
  return { kind: 'cardName', text: literalText(target), target, line, ...after };
}

/** The Literal_Target of a `go` target, with any parentheses around it removed. */
function literal(expr: Expr): Target | undefined {
  let e = expr;
  while (e.t === 'paren') e = e.inner;
  switch (e.t) {
    case 'str': return { lit: 'str', value: e.value };
    case 'num': return { lit: 'num', value: e.value };
    case 'bool': return { lit: 'bool', value: e.value };
    default: return undefined;
  }
}

/** Literal_Text: the string itself, `String(n)` for a number (R11.8), or `true` or `false`. */
export function literalText(target: Target): string {
  switch (target.lit) {
    case 'str': return target.value;
    case 'num': return String(target.value);
    case 'bool': return target.value ? 'true' : 'false';
  }
}

/** The smaller of two lines, or the one that is set. */
function earliest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
