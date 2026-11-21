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
  /** Line of the statement being run, so an unexpected exception still names a line (R12.1). */
  line: number;
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
  const frame: Frame = { locals: new Map(), globalNames: new Set(), line: found.pos.line };
  try {
    await executeAll(found.body, frame, ctx);
    return { ok: true };
  } catch (e) {
    if (e instanceof RuntimeAbort) return { ok: false, error: e.error };
    // A bug, or a host that throws or rejects: still an error on the line being run, never a throw.
    return { ok: false, error: runtimeError(frame.line, exceptionMessage(e)) };
  }
}

function exceptionMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return text || 'this command failed unexpectedly';
}

/** Runs statements in order. A runtime error stops the run and keeps what was done before it (R12.3). */
async function executeAll(stmts: readonly Stmt[], frame: Frame, ctx: RunContext): Promise<void> {
  for (const stmt of stmts) await execute(stmt, frame, ctx);
}

export async function execute(stmt: Stmt, frame: Frame, ctx: RunContext): Promise<void> {
  frame.line = stmt.pos.line;
  switch (stmt.t) {
    case 'putVar':
      setVariable(stmt.name, evaluate(stmt.value, frame, ctx), frame, ctx);
      return;
    case 'putField':
      putField(stmt, toStr(evaluate(stmt.value, frame, ctx)), ctx);
      return;
    case 'global':
      for (const name of stmt.names) frame.globalNames.add(name.toLowerCase());
      return;
    case 'show':
    case 'hide':
      // Showing a visible item or hiding a hidden one is fine; only a missing item is an error (R6.2, R6.3).
      if (!ctx.host.setVisible(stmt.kind, stmt.name, stmt.t === 'show')) {
        fail(stmt.pos, `there is no ${stmt.kind} "${stmt.name}" on this card`);
      }
      return;
    case 'answer': {
      const message = toStr(evaluate(stmt.prompt, frame, ctx));
      const labels = stmt.labels.length > 0 ? [...stmt.labels] : ['OK'];
      setVariable('it', await ctx.host.answer(message, labels), frame, ctx);
      return;
    }
    case 'ask': {
      const reply = await ctx.host.ask(toStr(evaluate(stmt.prompt, frame, ctx)));
      setVariable('it', reply ?? '', frame, ctx);
      return;
    }
    case 'wait':
      await ctx.host.wait(seconds(evaluate(stmt.seconds, frame, ctx), stmt.pos));
      return;
    case 'haunt':
      // Only the host call: no frame, card, field or visibility change, so a pending effect survives too (R15.2, R15.3).
      await ctx.host.haunt(stmt.kind);
      return;
    case 'if': {
      // An `else if` is a nested if in `else` that carries the line of its `else if` (R9.6),
      // so a condition that is not true or false is reported on that line (R9.4).
      const branch = asBool(evaluate(stmt.cond, frame, ctx), stmt.pos) ? stmt.then : stmt.else;
      await executeAll(branch, frame, ctx);
      return;
    }
    case 'go':
    case 'effect':
      // Implemented by task 9.
      return fail(stmt.pos, 'this command cannot run yet');
  }
}

/** `into` replaces the text, `after` appends, `before` prepends (R5.2). A missing field is an error (R5.4). */
function putField(stmt: Extract<Stmt, { t: 'putField' }>, text: string, ctx: RunContext): void {
  let next = text;
  if (stmt.mode !== 'into') {
    const old = ctx.host.getField(stmt.field);
    if (old === undefined) noField(stmt.pos, stmt.field);
    next = stmt.mode === 'after' ? old + text : text + old;
  }
  if (!ctx.host.setField(stmt.field, next)) noField(stmt.pos, stmt.field);
}

/** The duration of `wait`: a number, or a string that looks like one, finite and not negative (R7.3). */
function seconds(v: Value, at: Pos): number {
  const n = toNumber(v);
  if (n === undefined) fail(at, `expected a number of seconds, but got ${quoteValue(v)}`);
  if (!Number.isFinite(n)) fail(at, `cannot wait ${quoteValue(n)} seconds`);
  if (n < 0) fail(at, `cannot wait a negative number of seconds (${quoteValue(n)})`);
  return n;
}

function noField(at: Pos, name: string): never {
  return fail(at, `there is no field "${name}" on this card`);
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
      if (text === undefined) noField(expr.pos, expr.name);
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
