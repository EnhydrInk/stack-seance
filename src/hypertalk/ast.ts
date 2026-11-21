// Syntax tree of the v1 HyperTalk subset.
// Names (variables, fields, buttons) are stored as written; compare them with toLowerCase().
// Keyword case is not stored.

/** 1-based position of the token a node starts at. */
export interface Pos {
  line: number;
  column: number;
}

export type HandlerName = 'mouseUp' | 'openCard';

export interface Script {
  handlers: Handler[];
}

export interface Handler {
  name: HandlerName;
  body: Stmt[];
  pos: Pos;
}

/**
 * Block and single-line `if` give the same node (R9.3). `else` is [] when absent.
 * An `else if` chain is a nested `if` as the only statement of `else` (R9.6).
 */
export interface IfStmt {
  t: 'if';
  cond: Expr;
  then: Stmt[];
  else: Stmt[];
  pos: Pos;
}

export type Stmt =
  | { t: 'go'; target: GoTarget; pos: Pos }
  | { t: 'effect'; effect: Effect; pos: Pos }
  | { t: 'answer'; prompt: Expr; labels: string[]; pos: Pos }
  | { t: 'ask'; prompt: Expr; pos: Pos }
  | { t: 'putField'; value: Expr; mode: 'into' | 'after' | 'before'; field: string; pos: Pos }
  | { t: 'putVar'; value: Expr; name: string; pos: Pos }
  | { t: 'show' | 'hide'; kind: 'button' | 'field'; name: string; pos: Pos }
  | { t: 'wait'; seconds: Expr; pos: Pos }
  | { t: 'global'; names: string[]; pos: Pos }
  | IfStmt;

export type NavTarget = 'next' | 'prev' | 'first' | 'last';

export type GoTarget = { k: NavTarget } | { k: 'card'; expr: Expr };

export type Effect = 'dissolve' | 'wipeLeft' | 'wipeRight' | 'irisOpen' | 'irisClose';

export type BinOp =
  | '&' | '&&'
  | '+' | '-' | '*' | '/'
  | 'is' | 'isNot' | '<' | '>' | '<=' | '>=' | 'contains'
  | 'and' | 'or';

export type Expr =
  | { t: 'str'; value: string; pos: Pos }
  | { t: 'num'; value: number; pos: Pos }
  /** The constants `true` and `false`; they evaluate to the strings "true" and "false" (R11.10). */
  | { t: 'bool'; value: boolean; pos: Pos }
  /** `it` is a var named "it" (R8.3). */
  | { t: 'var'; name: string; pos: Pos }
  | { t: 'field'; name: string; pos: Pos }
  /** `pos` is the operator token. */
  | { t: 'bin'; op: BinOp; left: Expr; right: Expr; pos: Pos }
  | { t: 'not'; operand: Expr; pos: Pos }
  | { t: 'paren'; inner: Expr; pos: Pos };

/** The same tree type with every `pos` field removed. */
export type WithoutPos<T> = T extends readonly (infer U)[]
  ? WithoutPos<U>[]
  : T extends object
    ? { [K in keyof T as K extends 'pos' ? never : K]: WithoutPos<T[K]> }
    : T;

/** Copies a tree without its positions, for comparing trees (P1, R9.3, R9.6). */
export function stripPositions<T>(node: T): WithoutPos<T> {
  if (Array.isArray(node)) return node.map((n: unknown) => stripPositions(n)) as WithoutPos<T>;
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'pos') out[key] = stripPositions(value);
    }
    return out as WithoutPos<T>;
  }
  return node as WithoutPos<T>;
}
