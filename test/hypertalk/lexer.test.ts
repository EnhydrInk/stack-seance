import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeUntilError } from '../../src/hypertalk/lexer';
import { clampLine, lineCount, type SyntaxError } from '../../src/hypertalk/errors';
import { isReserved } from '../../src/hypertalk/tokens';
import type { Token } from '../../src/hypertalk/tokens';

function lex(source: string): Token[] {
  const result = tokenize(source);
  if (!result.ok) throw new Error(`expected tokens, got error: ${JSON.stringify(result.error)}`);
  return result.tokens;
}

function lexError(source: string): SyntaxError {
  const result = tokenize(source);
  if (result.ok) throw new Error(`expected a syntax error for ${JSON.stringify(source)}`);
  return result.error;
}

/** `kind:text` for every token except the final eof. */
function shape(source: string): string[] {
  return lex(source)
    .filter((t) => t.kind !== 'eof')
    .map((t) => (t.kind === 'newline' ? 'NL' : `${t.kind}:${t.text}`));
}

describe('tokens', () => {
  it('reads words, numbers, strings and operators', () => {
    expect(shape('put 3.25 & "a b" into total')).toEqual([
      'word:put', 'number:3.25', 'op:&', 'string:"a b"', 'word:into', 'word:total',
    ]);
  });

  it('keeps the case of words as written', () => {
    expect(shape('On MouseUp')).toEqual(['word:On', 'word:MouseUp']);
  });

  it('reads words with digits, underscores and non-ASCII letters', () => {
    expect(shape('_tmp2 café Séance')).toEqual(['word:_tmp2', 'word:café', 'word:Séance']);
  });

  it('gives number tokens their value', () => {
    const [a, b] = lex('007 0.25');
    expect(a).toMatchObject({ kind: 'number', text: '007', value: 7 });
    expect(b).toMatchObject({ kind: 'number', text: '0.25', value: 0.25 });
  });

  it('reads two-character operators before one-character ones', () => {
    expect(shape('a&&b<=c>=d')).toEqual([
      'word:a', 'op:&&', 'word:b', 'op:<=', 'word:c', 'op:>=', 'word:d',
    ]);
    expect(shape('a & & b < c')).toEqual(['word:a', 'op:&', 'op:&', 'word:b', 'op:<', 'word:c']);
  });

  it('reads every operator of the subset', () => {
    expect(shape('( ) , & && + - * / < > <= >=')).toEqual([
      'op:(', 'op:)', 'op:,', 'op:&', 'op:&&', 'op:+', 'op:-', 'op:*', 'op:/', 'op:<', 'op:>', 'op:<=', 'op:>=',
    ]);
  });

  it('ends with one eof token', () => {
    const tokens = lex('go');
    expect(tokens.at(-1)).toMatchObject({ kind: 'eof', line: 1, column: 3 });
    expect(tokens.filter((t) => t.kind === 'eof')).toHaveLength(1);
  });
});

describe('R8.4 / R11.10 reserved words', () => {
  it('reserves keywords and the constants, case-insensitively', () => {
    for (const w of ['if', 'THEN', 'field', 'next', 'true', 'False']) expect(isReserved(w), w).toBe(true);
  });

  it('reserves stack in any case (go-to-stack-command Requirement 1.9)', () => {
    for (const w of ['stack', 'STACK', 'Stack']) expect(isReserved(w), w).toBe(true);
  });

  it('does not reserve it or ordinary names', () => {
    for (const w of ['it', 'IT', 'correct', 'room', 'mouseUp']) expect(isReserved(w), w).toBe(false);
  });
});

describe('R11.7 string literals', () => {
  it('stores the text between the quotes as the value', () => {
    const [s, e] = lex('"Hello, card 2!" ""');
    expect(s).toMatchObject({ kind: 'string', text: '"Hello, card 2!"', value: 'Hello, card 2!' });
    expect(e).toMatchObject({ kind: 'string', value: '' });
  });

  it('reports an unclosed string on its own line, at the opening quote', () => {
    const error = lexError('on mouseUp\n  put "hello into x\nend mouseUp');
    expect(error).toMatchObject({ kind: 'syntax', line: 2, column: 7 });
    expect(error.message).toContain('closing quote');
  });

  it('does not let a string run onto the next line', () => {
    expect(lexError('put "abc\ndef" into x')).toMatchObject({ line: 1, column: 5 });
  });

  it('reports an unclosed string at the end of the script', () => {
    expect(lexError('go\nanswer "bye')).toMatchObject({ line: 2, column: 8 });
  });
});

describe('unknown characters', () => {
  it('reports the line and column of the character', () => {
    const error = lexError('go\n  put 1 # 2 into x');
    expect(error).toMatchObject({ kind: 'syntax', line: 2, column: 9 });
    expect(error.message).toBe('unexpected character "#"');
  });

  it('names invisible characters by code point', () => {
    expect(lexError('put\u00A01 into x').message).toBe('unexpected character U+00A0');
    expect(lexError('go\rnext').message).toBe('unexpected character U+000D');
  });

  it('gives a hint for = and for curly or single quotes', () => {
    expect(lexError('if x = 1 then go').message).toContain('use "is" to compare');
    expect(lexError('answer \u201Chi\u201D').message).toContain('straight quotes');
    expect(lexError("answer 'hi'").message).toContain('double quotes');
  });

  it('rejects a number with a trailing or leading dot', () => {
    expect(lexError('wait 1. seconds')).toMatchObject({ line: 1, column: 7 });
    expect(lexError('wait .5 seconds')).toMatchObject({ line: 1, column: 6 });
  });
});

describe('R12 line numbers', () => {
  const lf = 'on mouseUp\n  go to next card\nend mouseUp\n';

  it('gives every token its line and column', () => {
    const go = lex(lf).find((t) => t.text === 'go');
    expect(go).toMatchObject({ line: 2, column: 3 });
    const end = lex(lf).find((t) => t.text === 'end');
    expect(end).toMatchObject({ line: 3, column: 1 });
  });

  it('gives CRLF scripts the same tokens, lines and columns as LF scripts', () => {
    expect(lex(lf.replace(/\n/g, '\r\n'))).toEqual(lex(lf));
  });

  it('names the right line for an error in a CRLF script', () => {
    expect(lexError('on mouseUp\r\n  go\r\n  put "x into y\r\nend mouseUp')).toMatchObject({ line: 3, column: 7 });
  });

  it('does not count a trailing line break as a line', () => {
    expect(lineCount('go')).toBe(1);
    expect(lineCount('go\n')).toBe(1);
    expect(lineCount('go\r\n')).toBe(1);
    expect(lineCount('go\n\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('')).toBe(1);
  });

  it('puts the eof token on the last line, also after a trailing line break', () => {
    expect(lex('go\nnext\n').at(-1)).toMatchObject({ kind: 'eof', line: 2, column: 5 });
    expect(lex('').at(-1)).toMatchObject({ kind: 'eof', line: 1, column: 1 });
  });

  it('keeps every token line inside the script', () => {
    const source = '\n\non mouseUp -- hi\n\n  answer "a"\nend mouseUp\n\n';
    const n = lineCount(source);
    for (const t of lex(source)) {
      expect(t.line).toBeGreaterThanOrEqual(1);
      expect(t.line).toBeLessThanOrEqual(n);
    }
  });
});

describe('R11.9 comments', () => {
  it('ignores a comment at the end of a line', () => {
    expect(shape('go to next card -- onward')).toEqual(['word:go', 'word:to', 'word:next', 'word:card']);
  });

  it('treats a comment-only line as a blank line', () => {
    expect(shape('-- start here\ngo')).toEqual(['NL', 'word:go']);
    expect(lex('-- start here\ngo').find((t) => t.text === 'go')).toMatchObject({ line: 2, column: 1 });
  });

  it('does not change the line numbers of later lines', () => {
    const tokens = lex('on mouseUp\n  -- first a greeting\n  answer "hi" -- say hi\n  go to next card\nend mouseUp');
    expect(tokens.find((t) => t.text === 'answer')).toMatchObject({ line: 3, column: 3 });
    expect(tokens.find((t) => t.text === 'go')).toMatchObject({ line: 4, column: 3 });
    expect(tokens.find((t) => t.text === 'end')).toMatchObject({ line: 5, column: 1 });
  });

  it('keeps -- inside a string as part of the string', () => {
    expect(shape('put "a -- b" into x')).toEqual(['word:put', 'string:"a -- b"', 'word:into', 'word:x']);
  });

  it('ignores characters inside a comment that would be errors elsewhere', () => {
    expect(shape('go -- # = \u201Cé\u201D "unclosed')).toEqual(['word:go']);
  });

  it('ends a comment at the end of the script without a line break', () => {
    expect(shape('go --')).toEqual(['word:go']);
  });

  it('starts a comment at -- even without spaces, and keeps a single - as minus', () => {
    expect(shape('a--b')).toEqual(['word:a']);
    expect(shape('5 - 3')).toEqual(['number:5', 'op:-', 'number:3']);
  });

  it('names the right line for an error after a comment', () => {
    expect(lexError('-- greet the user\nput "hi into x')).toMatchObject({ line: 2, column: 5 });
    expect(lexError('go -- "fine here\n  #')).toMatchObject({ line: 2, column: 3 });
  });
});

describe('tokenizeUntilError (lexer-error-masks-parse-error-fix)', () => {
  it('returns the tokens read before the first error, with no eof, and the error', () => {
    expect(tokenizeUntilError('on mouseUp\n  put 1 into "x')).toEqual({
      tokens: [
        { kind: 'word', text: 'on', line: 1, column: 1 },
        { kind: 'word', text: 'mouseUp', line: 1, column: 4 },
        { kind: 'newline', text: '\n', line: 1, column: 11 },
        { kind: 'word', text: 'put', line: 2, column: 3 },
        { kind: 'number', text: '1', value: 1, line: 2, column: 7 },
        { kind: 'word', text: 'into', line: 2, column: 9 },
      ],
      error: { kind: 'syntax', line: 2, column: 14, message: 'this string has no closing quote (") on this line' },
    });
  });

  it('returns no tokens when the error is the first character', () => {
    expect(tokenizeUntilError('=')).toEqual({
      tokens: [],
      error: { kind: 'syntax', line: 1, column: 1, message: 'unexpected character "="; use "is" to compare' },
    });
  });

  it('returns the same tokens as tokenize for a valid script, ending with eof', () => {
    const source = 'on mouseUp\n  answer "a -- b" -- = #\n  go to next card\nend mouseUp\n';
    const result = tokenizeUntilError(source);
    expect(result.error).toBeUndefined();
    expect(result.tokens).toEqual(lex(source));
    expect(result.tokens.at(-1)).toMatchObject({ kind: 'eof' });
  });
});

describe('clampLine', () => {
  it('leaves lines inside the script unchanged', () => {
    expect(clampLine(1, 3)).toBe(1);
    expect(clampLine(3, 3)).toBe(3);
  });

  it('forces lines outside the script into 1..count', () => {
    expect(clampLine(0, 3)).toBe(1);
    expect(clampLine(-4, 3)).toBe(1);
    expect(clampLine(9, 3)).toBe(3);
    expect(clampLine(Number.NaN, 3)).toBe(1);
    expect(clampLine(Number.POSITIVE_INFINITY, 3)).toBe(3);
    expect(clampLine(2, 0)).toBe(1);
  });
});
