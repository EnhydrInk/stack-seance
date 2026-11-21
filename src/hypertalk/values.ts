// Values of the v1 HyperTalk subset and the conversions between them (design.md, "Values").
// A value is a string or a number. Booleans are the strings "true" and "false" (R11.6, R11.10).

import type { Pos } from './ast';
import { RuntimeAbort, runtimeError } from './errors';

export type Value = string | number;

/** Digits with an optional decimal part, surrounded by optional whitespace. No sign, no exponent. */
const NUMERIC = /^\s*\d+(\.\d+)?\s*$/;

/** Strings as they are; numbers the way JavaScript writes them, so 1/4 gives "0.25" (R11.8). */
export function toStr(v: Value): string {
  return typeof v === 'string' ? v : String(v);
}

/** True for a number, and for a string such as "3", " 007 " or "2.5" (R11.4, R11.5, R2.3). */
export function looksNumeric(v: Value): boolean {
  return typeof v === 'number' || NUMERIC.test(v);
}

/**
 * The number a value stands for, or undefined when it does not look numeric.
 * The caller reports the runtime error with its own line (R11.4).
 */
export function toNumber(v: Value): number | undefined {
  if (typeof v === 'number') return v;
  return NUMERIC.test(v) ? Number(v) : undefined;
}

/**
 * Orders two values: as numbers when both look numeric, otherwise as strings, ignoring case (R11.5).
 * Strings are ordered by UTF-16 code units, not by locale, so the result is the same on every machine.
 * NaN (for example from Infinity - Infinity) has no numeric order, so it falls back to the string order.
 */
export function compare(a: Value, b: Value): -1 | 0 | 1 {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y)) return order(x, y);
  return order(toStr(a).toLowerCase(), toStr(b).toLowerCase());
}

function order<T extends number | string>(x: T, y: T): -1 | 0 | 1 {
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Reads a condition, or an operand of `and`, `or` and `not`: "true" or "false" in any case.
 * Anything else stops the run with an error on the given line (R9.4, R11.6).
 */
export function asBool(v: Value, at: Pick<Pos, 'line'>): boolean {
  if (typeof v === 'string') {
    const word = v.toLowerCase();
    if (word === 'true') return true;
    if (word === 'false') return false;
  }
  throw new RuntimeAbort(runtimeError(at.line, `expected true or false, but got ${quoteValue(v)}`));
}

const QUOTE_LIMIT = 40;

/** A value as it appears in an error message: numbers as they print, strings quoted and shortened. */
export function quoteValue(v: Value): string {
  if (typeof v === 'number') return toStr(v);
  if (v === '') return 'an empty value';
  const chars = Array.from(v);
  return chars.length > QUOTE_LIMIT ? `"${chars.slice(0, QUOTE_LIMIT).join('')}…"` : `"${v}"`;
}
