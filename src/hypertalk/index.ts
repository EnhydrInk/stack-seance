// Public API of the HyperTalk interpreter. Everything the UI and the compiler use comes
// from here. parseUnguarded and runHandlerUnguarded stay internal: they exist so the
// P4 and P5 property tests can see past the line guard (design.md, "Errors").

export { parse, type ParseResult } from './parser';
export { print } from './printer';
export { runHandler } from './runtime';

export type {
  BinOp,
  Effect,
  Expr,
  GoTarget,
  Handler,
  HandlerName,
  IfStmt,
  NavTarget,
  Pos,
  Script,
  Stmt,
  WithoutPos,
} from './ast';
export type { RuntimeError, ScriptError, SyntaxError } from './errors';
export type { CardRef, Host, RunContext, RunResult } from './host';
export type { HauntKind } from './tokens';
export type { Value } from './values';
