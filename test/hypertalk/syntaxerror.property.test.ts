import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse, parseUnguarded } from '../../src/hypertalk/parser';
import { lineCount } from '../../src/hypertalk/errors';
import { applyMutation, mutantArb, MUTATION_OPS, type Mutation } from './helpers/arbitraries';

describe('P4 error lines (R12.1, R12.4)', () => {
  it('P4 error lines: every syntax error in a mutated script names a line in 1..lineCount', () => {
    // Runs against parseUnguarded, so clampLine in parse cannot hide a wrong line.
    fc.assert(
      fc.property(mutantArb, ({ source }) => {
        const result = parseUnguarded(source);
        fc.pre(!result.ok);
        if (result.ok) return;
        const { line, column } = result.error;
        expect(Number.isInteger(line)).toBe(true);
        expect(line).toBeGreaterThanOrEqual(1);
        expect(line).toBeLessThanOrEqual(lineCount(source));
        expect(Number.isInteger(column)).toBe(true);
        expect(column).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  it('P4 error lines: parse and parseUnguarded agree, so the line guard never changes a value', () => {
    fc.assert(
      fc.property(mutantArb, ({ source }) => {
        expect(parse(source)).toEqual(parseUnguarded(source));
      }),
      { numRuns: 300 },
    );
  });
});

describe('mutation generator (P4)', () => {
  const sample = fc.sample(mutantArb, { numRuns: 1000, seed: 5 });

  it('at least 30% of generated mutants fail to parse', () => {
    const failed = sample.filter((m) => !parseUnguarded(m.source).ok).length;
    expect(failed / sample.length).toBeGreaterThanOrEqual(0.3);
  });

  it('uses every kind of mutation', () => {
    const used = new Set(sample.flatMap((m) => m.mutations.map((x) => x.op)));
    expect([...used].sort()).toEqual([...MUTATION_OPS].sort());
  });

  // Tokens of this source: on, mouseUp, \n, go, to, next, card, \n, end, mouseUp, \n
  const source = 'on mouseUp\n  go to next card\nend mouseUp\n';
  const cases: [Mutation, string][] = [
    [{ op: 'delete', at: 3 }, 'on mouseUp\n   to next card\nend mouseUp\n'],
    [{ op: 'delete', at: 13 }, 'on mouseUp  go to next card\nend mouseUp\n'], // 13 % 11 = 2: the first line break
    [{ op: 'duplicate', at: 4 }, 'on mouseUp\n  go to to next card\nend mouseUp\n'],
    [{ op: 'swap', at: 3, with: 8 }, 'on mouseUp\n   end  to next card\n go  mouseUp\n'],
    [{ op: 'replace', at: 6, text: '(' }, 'on mouseUp\n  go to next  ( \nend mouseUp\n'],
    [{ op: 'truncate', at: 20 }, 'on mouseUp\n  go to n'],
    [{ op: 'insertLine', at: 1, text: 'end if', crlf: false }, 'on mouseUp\nend if\n  go to next card\nend mouseUp\n'],
    [{ op: 'insertLine', at: 3, text: 'else', crlf: true }, 'on mouseUp\n  go to next card\nend mouseUp\nelse\r\n'],
  ];

  it.each(cases)('applies %j', (mutation, expected) => {
    expect(applyMutation(source, mutation)).toBe(expected);
  });

  it('appends an inserted line after a last line that has no line break', () => {
    expect(applyMutation('on mouseUp\nend mouseUp', { op: 'insertLine', at: 2, text: 'howl', crlf: true })).toBe(
      'on mouseUp\nend mouseUp\r\nhowl',
    );
  });

  it('leaves a script with no tokens unchanged, except for truncate and insertLine', () => {
    expect(applyMutation('', { op: 'delete', at: 0 })).toBe('');
    expect(applyMutation('  \t ', { op: 'swap', at: 0, with: 1 })).toBe('  \t ');
    expect(applyMutation('', { op: 'truncate', at: 9 })).toBe('');
    expect(applyMutation('', { op: 'insertLine', at: 9, text: 'else', crlf: false })).toBe('else\n');
  });
});
