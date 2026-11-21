// Runs handlers of the v1 HyperTalk subset (design.md, "Runtime").
// The runtime reaches the stack and the person only through ctx.host (R10.1). It has no clock,
// no randomness and no network (R13), so the same inputs always give the same run (P3).

import type { BinOp, Expr, HandlerName, Pos, Stmt } from './ast';
import { RuntimeAbort, runtimeError } from './errors';
import type { RunContext, RunResult } from './host';
import { parse } from './parser';
import { asBool, compare, quoteValue, toNumber, toStr, type Value } from './values';

/** The variables of one handler run. Keys are lower-cased, because names ignore case (R1.8). */
export interface Frame {
  /** Variables of this run only (R8.1). `it` lives here unless it is declared global (R8.3). */
  locals: Map<string, Value>;
  /** Names declared with `global` so far in this run. They read and write ctx.globals (R8.2). */
  globalNames: Set<string>;
}

/**
 * Parses `source` and runs one of its handlers. A syntax error is returned as the result,
 * and a handler the script does not define does nothing (R1.7, R12.3).
 */
export async function runHandler(source: string, handler: HandlerName, ctx: RunContext): Promise<RunResult> {
  const parsed = parse(source);
  if (!parsed.ok) return parsed;
  const found = parsed.script.handlers.find((h) => h.name === handler);
  if (!found) return { ok: true };
  const frame: Frame = { locals: new Map(), globalNames: new Set() };
  try {
    await executeAll(found.body, frame, ctx);
    return { ok: true };
  } catch (e) {
    if (e instanceof RuntimeAbort) return { ok: false, error: e.error };
    // Task 8.6 turns unexpected exceptions into a runtime error on the current line.
    throw e;
  }
}

/** Runs statements in order. A runtime error stops the run and keeps what was done before it (R12.3). */
async function executeAll(stmts: readonly Stmt[], frame: Frame, ctx: RunContext): Promise<void> {
  for (const stmt of stmts) await execute(stmt, frame, ctx);
}

export async function execute(stmt: Stmt, frame: Frame, ctx: RunContext): Promise<void> {
  switch (stmt.t) {
    case 'putVar':
      setVariable(stmt.name, evaluate(stmt.value, frame, ctx), frame, ctx);
      return;
    case 'global':
      for (const name of stmt.names) frame.globalNames.add(name.toLowerCase());
      return;
    case 'ask': {
      const reply = await ctx.host.ask(toStr(evaluate(stmt.prompt, frame, ctx)));
      setVariable('it', reply ?? '', frame, ctx);
      return;
    }
    case 'if': {
      // An `else if` is a nested if in `else` that carries the line of its `else if` (R9.6),
      // so a condition that is not true or false is reported on that line (R9.4).
      const branch = asBool(evaluate(stmt.cond, frame, ctx), stmt.pos) ? stmt.then : stmt.else;
      await executeAll(branch, frame, ctx);
      return;
    }
    case 'go':
    case 'effect':
    case 'answer':
    case 'putField':
    case 'show':
    case 'hide':
    case 'wait':
    case 'haunt':
      // Implemented by tasks 8 and 9.
      return fail(stmt.pos, 'this command cannot run yet');
  }
}

/** The value of an expression. Errors name the line the expression is on (R12.1). */
export function evaluate(expr: Expr, frame: Frame, ctx: RunContext): Value {
  switch (expr.t) {
    case 'str':
    case 'num':
      return expr.value;
    case 'bool':
      return truth(expr.value);
    case 'var':
      return getVariable(expr.name, frame, ctx);
    case 'field': {
      const text = ctx.host.getField(expr.name);
      if (text === undefined) fail(expr.pos, `there is no field "${expr.name}" on this card`);
      return text;
    }
    case 'paren':
      return evaluate(expr.inner, frame, ctx);
    case 'not':
      return truth(!asBool(evaluate(expr.operand, frame, ctx), expr.pos));
    case 'bin':
      return binary(expr.op, evaluate(expr.left, frame, ctx), evaluate(expr.right, frame, ctx), expr.pos);
  }
}

/** Both operands are already evaluated, left first. `at` is the operator. */
function binary(op: BinOp, a: Value, b: Value, at: Pos): Value {
  switch (op) {
    case '&':
      return toStr(a) + toStr(b);
    case '&&':
      return `${toStr(a)} ${toStr(b)}`;
    case '+':
      return number(a, op, at) + number(b, op, at);
    case '-':
      return number(a, op, at) - number(b, op, at);
    case '*':
      return number(a, op, at) * number(b, op, at);
    case '/': {
      const x = number(a, op, at);
      const y = number(b, op, at);
      if (y === 0) fail(at, 'cannot divide by zero');
      return x / y;
    }
    case 'is':
      return truth(compare(a, b) === 0);
    case 'isNot':
      return truth(compare(a, b) !== 0);
    case '<':
      return truth(compare(a, b) < 0);
    case '>':
      return truth(compare(a, b) > 0);
    case '<=':
      return truth(compare(a, b) <= 0);
    case '>=':
      return truth(compare(a, b) >= 0);
    case 'contains':
      return truth(toStr(a).toLowerCase().includes(toStr(b).toLowerCase()));
    // No short cut: both sides run and both must be true or false, so `false and 5` is an error (R11.6).
    case 'and': {
      const x = asBool(a, at);
      const y = asBool(b, at);
      return truth(x && y);
    }
    case 'or': {
      const x = asBool(a, at);
      const y = asBool(b, at);
      return truth(x || y);
    }
  }
}

/** An operand of + - * /: a number, or a string that looks like one (R11.4). */
function number(v: Value, op: BinOp, at: Pos): number {
  const n = toNumber(v);
  if (n === undefined) fail(at, `expected a number for "${op}", but got ${quoteValue(v)}`);
  return n;
}

/** Comparisons, `contains`, `not`, `and`, `or` and the constants give the strings "true" and "false" (R11.6, R11.10). */
function truth(b: boolean): Value {
  return b ? 'true' : 'false';
}

/** ctx.globals once the name is declared global in this run, the locals otherwise (R8.1, R8.2). */
function scope(key: string, frame: Frame, ctx: RunContext): Map<string, Value> {
  return frame.globalNames.has(key) ? ctx.globals : frame.locals;
}

/** A variable that was never set is the empty string (R8.1). */
function getVariable(name: string, frame: Frame, ctx: RunContext): Value {
  const key = name.toLowerCase();
  return scope(key, frame, ctx).get(key) ?? '';
}

function setVariable(name: string, value: Value, frame: Frame, ctx: RunContext): void {
  const key = name.toLowerCase();
  scope(key, frame, ctx).set(key, value);
}

function fail(at: Pick<Pos, 'line'>, message: string): never {
  throw new RuntimeAbort(runtimeError(at.line, message));
}
