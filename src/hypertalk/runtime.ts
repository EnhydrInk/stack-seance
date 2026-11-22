// Runs handlers of the v1 HyperTalk subset (design.md, "Runtime").
// The runtime reaches the stack and the person only through ctx.host (R10.1). It has no clock,
// no randomness and no network (R13), so the same inputs always give the same run (P3).

import type { BinOp, Effect, Expr, GoTarget, HandlerName, Pos, Stmt } from './ast';
import { clampLine, lineCount, RuntimeAbort, runtimeError, type ScriptError } from './errors';
import type { CardRef, RunContext, RunResult, StackRef } from './host';
import { parseUnguarded } from './parser';
import { asBool, compare, quoteValue, toNumber, toStr, type Value } from './values';

/**
 * How many openCard handlers a chain of `go` commands may start one inside the other (R14.4).
 * The run the caller starts is depth 0, so a `go` in an openCard at depth 16 is an error.
 */
export const MAX_OPEN_CARD_DEPTH = 16;

/** The state of one handler run. Variable keys are lower-cased, because names ignore case (R1.8). */
export interface Frame {
  /** Variables of this run only (R8.1). `it` lives here unless it is declared global (R8.3). */
  locals: Map<string, Value>;
  /** Names declared with `global` so far in this run. They read and write ctx.globals (R8.2). */
  globalNames: Set<string>;
  /** Line of the statement being run, so an unexpected exception still names a line (R12.1). */
  line: number;
  /**
   * The effect the next `go` plays (R3.2). It lives in the frame, so it ends with the run
   * that set it (R3.5), and an openCard handler starts without one.
   */
  pendingEffect: Effect | undefined;
  /** 0 for the run the caller starts, one more for each openCard a `go` starts (R14.4). */
  depth: number;
}

/**
 * How a run ended. A failure keeps the line count of the script its error comes from,
 * which is another card's script when an openCard failed (R12.5), for the line guard.
 */
type Ran = { ok: true } | { ok: false; error: ScriptError; lines: number };

/** Stops the run with an error that an openCard handler of another card raised (R12.5). */
class OpenCardAbort {
  constructor(
    readonly error: ScriptError,
    /** Line count of the card script the error comes from. */
    readonly lines: number,
  ) {}
}

/**
 * Parses `source` and runs one of its handlers. A syntax error is returned as the result,
 * and a handler the script does not define does nothing (R1.7, R12.3).
 * Error lines are forced into the script they come from as a last guard (P5).
 */
export async function runHandler(source: string, handler: HandlerName, ctx: RunContext): Promise<RunResult> {
  const ran = await run(source, handler, ctx, 0);
  if (ran.ok) return ran;
  return { ok: false, error: { ...ran.error, line: clampLine(ran.error.line, ran.lines) } };
}

/**
 * runHandler without the line guard, here or in the parser. Not part of the public API:
 * the P5 property test runs against it so that the guard cannot hide a wrong line.
 */
export async function runHandlerUnguarded(source: string, handler: HandlerName, ctx: RunContext): Promise<RunResult> {
  const ran = await run(source, handler, ctx, 0);
  return ran.ok ? ran : { ok: false, error: ran.error };
}

/** Parses without the guard: runHandler guards every error once, syntax errors included. */
async function run(source: string, handler: HandlerName, ctx: RunContext, depth: number): Promise<Ran> {
  const failed = (error: ScriptError): Ran => ({ ok: false, error, lines: lineCount(source) });
  const parsed = parseUnguarded(source);
  if (!parsed.ok) return failed(parsed.error);
  const found = parsed.script.handlers.find((h) => h.name === handler);
  if (!found) return { ok: true };
  const frame: Frame = { locals: new Map(), globalNames: new Set(), line: found.pos.line, pendingEffect: undefined, depth };
  try {
    await executeAll(found.body, frame, ctx);
    return { ok: true };
  } catch (e) {
    if (e instanceof OpenCardAbort) return { ok: false, error: e.error, lines: e.lines };
    if (e instanceof RuntimeAbort) return failed(e.error);
    // A bug, or a host that throws or rejects: still an error on the line being run, never a throw.
    return failed(runtimeError(frame.line, exceptionMessage(e)));
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
    case 'effect':
      // A second effect before a go replaces the first (R3.4).
      frame.pendingEffect = stmt.effect;
      return;
    case 'go':
      await go(stmt, frame, ctx);
      return;
  }
}

type GoStmt = Extract<Stmt, { t: 'go' }>;
/** The targets that name a card of the current stack. */
type CardTarget = Exclude<GoTarget, { k: 'stack' }>;

/**
 * Moves to the target with the pending effect, then runs the new card's openCard (R2, R3, R14).
 * A target that does not exist is an error on the go line before anything changes, and it is
 * reported before the depth limit (R2.4, go-to-stack-command Requirement 3.6, 3.8). An error in
 * the openCard ends this run too, and the move is kept (R12.3, R12.5).
 */
async function go(stmt: GoStmt, frame: Frame, ctx: RunContext): Promise<void> {
  // The effect belongs to this go: played when it moves, dropped when it fails (R3.2, R3.3).
  const effect = frame.pendingEffect;
  frame.pendingEffect = undefined;
  const { target } = stmt;
  let card: CardRef;
  if (target.k === 'stack') {
    const stack = targetStack(target.expr, stmt.pos, frame, ctx);
    checkDepth(stmt.pos, frame);
    // Also when `stack` is the current stack: it opens at its first card (Requirement 4.2).
    card = ctx.host.goToStack(stack, effect);
  } else {
    card = targetCard(target, stmt.pos, frame, ctx);
    checkDepth(stmt.pos, frame);
    ctx.host.goToCard(card, effect);
  }
  await openCard(card, frame, ctx);
}

/**
 * The stack a `go to stack` names. The value is always a name, also when it is a number
 * (Requirement 3.2). The name goes to the host as it is, case and spaces kept (Requirement 3.3).
 */
function targetStack(expr: Expr, at: Pos, frame: Frame, ctx: RunContext): StackRef {
  const name = toStr(evaluate(expr, frame, ctx));
  if (name === '') fail(at, 'expected a stack name, but got an empty value');
  const stack = ctx.host.findStackByName(name);
  if (!stack) fail(at, `there is no stack named ${quoteValue(name)}`);
  return stack;
}

/** A go at depth 16 would start a 17th openCard, whichever kind of go it is (R14.4, Requirement 4.5, 4.6). */
function checkDepth(at: Pos, frame: Frame): void {
  if (frame.depth >= MAX_OPEN_CARD_DEPTH) {
    fail(at, `cannot go on: openCard handlers can chain at most ${MAX_OPEN_CARD_DEPTH} levels deep`);
  }
}

/**
 * Runs the openCard of the card a go just showed. Going to the current card or the current
 * stack still opens it (R2.5, Requirement 4.2). Fresh locals, the same globals (R14.2, Requirement 5.4).
 */
async function openCard(card: CardRef, frame: Frame, ctx: RunContext): Promise<void> {
  const opened = await run(
    ctx.host.getCardScript(card),
    'openCard',
    { host: ctx.host, globals: ctx.globals, scriptId: card.id },
    frame.depth + 1,
  );
  // The innermost card that failed names itself; outer levels pass its error on unchanged.
  if (!opened.ok) {
    throw new OpenCardAbort({ ...opened.error, scriptId: opened.error.scriptId ?? card.id }, opened.lines);
  }
}

/** The card a go target names. The host is asked each time; the runtime keeps no card state. */
function targetCard(target: CardTarget, at: Pos, frame: Frame, ctx: RunContext): CardRef {
  if (target.k === 'card') {
    const v = evaluate(target.expr, frame, ctx);
    // A number, or a string that looks like one, is a card number; any other string is a name (R2.3).
    const n = toNumber(v);
    if (n !== undefined) {
      if (!Number.isInteger(n)) fail(at, `expected a whole card number, but got ${quoteValue(v)}`);
      return cardNumber(n, ctx.host.cardCount(), at, ctx);
    }
    if (v === '') fail(at, 'expected a card number or name, but got an empty value');
    const named = ctx.host.findCardByName(toStr(v));
    if (!named) fail(at, `there is no card named ${quoteValue(v)}`);
    return named;
  }
  const count = ctx.host.cardCount();
  switch (target.k) {
    case 'first':
      return cardNumber(1, count, at, ctx);
    case 'last':
      return cardNumber(count, count, at, ctx);
    case 'next':
      // The last card wraps to the first, and the first to the last (R2.2).
      return cardNumber((ctx.host.currentCard().index % count) + 1, count, at, ctx);
    case 'prev': {
      const index = ctx.host.currentCard().index;
      return cardNumber(index === 1 ? count : index - 1, count, at, ctx);
    }
  }
}

function cardNumber(n: number, count: number, at: Pos, ctx: RunContext): CardRef {
  const card = n >= 1 && n <= count ? ctx.host.cardAt(n) : undefined;
  if (!card) fail(at, `there is no card ${quoteValue(n)}: the stack has ${count} card${count === 1 ? '' : 's'}`);
  return card;
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
