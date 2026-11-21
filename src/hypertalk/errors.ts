// Error types shared by the lexer, the parser and the runtime.
// Every error names a 1-based line in the script it comes from (R12.1).

/** A problem found while reading a script. Lines and columns are 1-based. */
export interface SyntaxError {
  kind: 'syntax';
  line: number;
  column: number;
  message: string;
  /** Set when the script belongs to another card than the one being run (R12.5). */
  scriptId?: string;
}

/** A problem found while running a script. */
export interface RuntimeError {
  kind: 'runtime';
  line: number;
  message: string;
  scriptId?: string;
}

export type ScriptError = SyntaxError | RuntimeError;

export function syntaxError(line: number, column: number, message: string): SyntaxError {
  return { kind: 'syntax', line, column, message };
}

export function runtimeError(line: number, message: string): RuntimeError {
  return { kind: 'runtime', line, message };
}

/**
 * Thrown inside the runtime to stop a handler run with an error (R12.3).
 * `runHandler` catches it and returns the error, so it never leaves the public API.
 */
export class RuntimeAbort {
  constructor(readonly error: RuntimeError) {}
}

/** Line breaks are `\n` or `\r\n` (glossary). Everything downstream sees `\n` only. */
export function normaliseLineBreaks(source: string): string {
  return source.replace(/\r\n/g, '\n');
}

/**
 * Number of lines in a script. A trailing line break does not start a new line.
 * An empty script counts as one empty line, so the range 1..lineCount is never empty.
 */
export function lineCount(source: string): number {
  const text = normaliseLineBreaks(source);
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').length;
}

/**
 * Last guard at the public boundary (P4, P5): forces a line into 1..count.
 * Correct code never needs it; tests assert that it never changes a value.
 */
export function clampLine(line: number, count: number): number {
  const max = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
  if (Number.isNaN(line)) return 1;
  return Math.min(max, Math.max(1, Math.floor(line)));
}
