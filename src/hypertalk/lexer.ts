// Turns script text into tokens. Never throws: problems come back as a SyntaxError
// with the line and column where they were found (R12.1, R12.2, R12.3).

import { lineCount, normaliseLineBreaks, syntaxError, type SyntaxError } from './errors';
import type { Operator, Token } from './tokens';

export type LexResult = { ok: true; tokens: Token[] } | { ok: false; error: SyntaxError };

const WORD = /[\p{L}_][\p{L}\p{M}0-9_]*/uy;
const NUMBER = /[0-9]+(?:\.[0-9]+)?/y;
const TWO_CHAR_OPS: readonly Operator[] = ['&&', '<=', '>='];
const ONE_CHAR_OPS: readonly Operator[] = ['(', ')', ',', '&', '+', '-', '*', '/', '<', '>'];

export function tokenize(source: string): LexResult {
  const text = normaliseLineBreaks(source);
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const column = (at: number) => at - lineStart + 1;
  const fail = (at: number, message: string): LexResult => ({
    ok: false,
    error: syntaxError(line, column(at), message),
  });

  while (i < text.length) {
    const ch = text.charAt(i);

    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    if (ch === '\n') {
      tokens.push({ kind: 'newline', text: '\n', line, column: column(i) });
      i++;
      line++;
      lineStart = i;
      continue;
    }

    // `--` starts a comment that runs to the end of the line (R11.9).
    // The newline itself is kept, so line numbers do not change.
    if (ch === '-' && text.charAt(i + 1) === '-') {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? text.length : eol;
      continue;
    }

    // A string runs to the next `"` on the same line (R11.7). Strings are read
    // before comments can start, so `--` inside a string is plain text.
    if (ch === '"') {
      const close = text.indexOf('"', i + 1);
      const eol = text.indexOf('\n', i + 1);
      if (close === -1 || (eol !== -1 && eol < close)) {
        return fail(i, 'this string has no closing quote (") on this line');
      }
      tokens.push({
        kind: 'string',
        text: text.slice(i, close + 1),
        value: text.slice(i + 1, close),
        line,
        column: column(i),
      });
      i = close + 1;
      continue;
    }

    NUMBER.lastIndex = i;
    const num = NUMBER.exec(text);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) return fail(i, 'this number is too large');
      tokens.push({ kind: 'number', text: num[0], value, line, column: column(i) });
      i += num[0].length;
      continue;
    }

    WORD.lastIndex = i;
    const word = WORD.exec(text);
    if (word) {
      tokens.push({ kind: 'word', text: word[0], line, column: column(i) });
      i += word[0].length;
      continue;
    }

    const two = text.slice(i, i + 2);
    const op = TWO_CHAR_OPS.find((o) => o === two) ?? ONE_CHAR_OPS.find((o) => o === ch);
    if (op) {
      tokens.push({ kind: 'op', text: op, line, column: column(i) });
      i += op.length;
      continue;
    }

    return fail(i, unexpectedCharacter(text.codePointAt(i) ?? 0));
  }

  tokens.push({ kind: 'eof', text: '', ...endPosition(text) });
  return { ok: true, tokens };
}

/** Position just after the last character of the last line (glossary: a trailing break adds no line). */
function endPosition(text: string): { line: number; column: number } {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lastLineStart = body.lastIndexOf('\n') + 1;
  return { line: lineCount(text), column: body.length - lastLineStart + 1 };
}

const HINTS: Record<string, string> = {
  '=': 'use "is" to compare',
  '\u201C': 'use straight quotes (")',
  '\u201D': 'use straight quotes (")',
  "'": 'strings use double quotes (")',
  '\u2018': 'strings use double quotes (")',
  '\u2019': 'strings use double quotes (")',
};

function unexpectedCharacter(codePoint: number): string {
  const ch = String.fromCodePoint(codePoint);
  const shown = /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch)
    ? `"${ch}"`
    : `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  const hint = HINTS[ch];
  return hint ? `unexpected character ${shown}; ${hint}` : `unexpected character ${shown}`;
}
