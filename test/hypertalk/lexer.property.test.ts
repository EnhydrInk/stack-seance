import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tokenize, tokenizeUntilError, type LexResult } from '../../src/hypertalk/lexer';
import { lineCount } from '../../src/hypertalk/errors';
import { textBefore } from './helpers/lexMask';

// Characters that appear in scripts, plus a few that must be rejected.
const scriptChar = fc.constantFrom(
  ...'abcxyzIT_0123456789 \t"-&+*/<>(),.#=é\u00A0\u201C',
  '\n', '\r\n', '\r', '--', '&&', '<=', '>=',
);
const scriptText = fc.array(scriptChar, { maxLength: 80 }).map((parts) => parts.join(''));

describe('lexer properties (R12.1, R12.3)', () => {
  it('never throws, and every line it reports is inside the script', () => {
    fc.assert(
      fc.property(scriptText, (source) => {
        const n = lineCount(source);
        const result = tokenize(source);
        if (result.ok) {
          for (const t of result.tokens) {
            expect(t.line).toBeGreaterThanOrEqual(1);
            expect(t.line).toBeLessThanOrEqual(n);
            expect(t.column).toBeGreaterThanOrEqual(1);
          }
        } else {
          expect(Number.isInteger(result.error.line)).toBe(true);
          expect(result.error.line).toBeGreaterThanOrEqual(1);
          expect(result.error.line).toBeLessThanOrEqual(n);
          expect(result.error.column).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('gives the same result for CRLF and LF line breaks', () => {
    fc.assert(
      fc.property(scriptText, (source) => {
        const lf = source.replace(/\r/g, '');
        expect(tokenize(lf.replace(/\n/g, '\r\n'))).toEqual(tokenize(lf));
      }),
      { numRuns: 500 },
    );
  });
});

describe('tokenizeUntilError (lexer-error-masks-parse-error-fix, 3.7)', () => {
  /**
   * **Validates: Requirements 3.5, 3.7, 3.8, 3.9**
   */
  it('is tokenize before the wrapper, and stops with exactly the tokens before the first error', () => {
    fc.assert(
      fc.property(scriptText, (source) => {
        const { tokens, error } = tokenizeUntilError(source);
        const wrapped: LexResult = error ? { ok: false, error } : { ok: true, tokens };
        expect(tokenize(source)).toEqual(wrapped);
        if (error) {
          const before = tokenize(textBefore(source, error));
          expect(before.ok).toBe(true);
          if (before.ok) {
            expect(before.tokens.at(-1)?.kind).toBe('eof');
            expect(tokens).toEqual(before.tokens.slice(0, -1));
          }
        } else {
          expect(tokens.at(-1)?.kind).toBe('eof');
        }
      }),
      { numRuns: 1000 },
    );
  });
});
