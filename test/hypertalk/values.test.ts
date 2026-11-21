import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { asBool, compare, looksNumeric, quoteValue, toNumber, toStr, type Value } from '../../src/hypertalk/values';
import { RuntimeAbort, type RuntimeError } from '../../src/hypertalk/errors';

/** The runtime error asBool raises for `v`, as reported on line `line`. */
function boolError(v: Value, line = 7): RuntimeError {
  try {
    asBool(v, { line });
  } catch (e) {
    if (e instanceof RuntimeAbort) return e.error;
    throw e;
  }
  throw new Error(`expected ${JSON.stringify(v)} to be rejected`);
}

describe('R11.8 toStr', () => {
  it('keeps strings as they are', () => {
    expect(toStr('')).toBe('');
    expect(toStr(' 007 ')).toBe(' 007 ');
  });

  it('writes numbers the way JavaScript does', () => {
    expect(toStr(1 / 4)).toBe('0.25');
    expect(toStr(3)).toBe('3');
    expect(toStr(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(toStr(-0)).toBe('0');
    expect(toStr(1e21)).toBe('1e+21');
  });
});

describe('R11.4 looksNumeric and toNumber', () => {
  it('accepts numbers and strings of digits with an optional minus sign and decimal part', () => {
    for (const [v, n] of [
      [3, 3], [0.25, 0.25], [-5, -5], ['3', 3], ['007', 7], ['3.50', 3.5], [' 3 ', 3], ['\t2\n', 2], ['0', 0],
      ['-1', -1], ['-007', -7], [' -3.50 ', -3.5],
    ] as const) {
      expect(looksNumeric(v), JSON.stringify(v)).toBe(true);
      expect(toNumber(v), JSON.stringify(v)).toBe(n);
    }
  });

  it('rejects everything else, and toNumber gives undefined for it', () => {
    for (const v of [
      '', ' ', 'abc', '3 4', '3.', '.5', '+1', '1e3', '0x10', 'Infinity', 'NaN', '1,5', '٣',
      '-', '- 5', '--5', '-.5', '-5.', '5-', '-+5', '−5' /* U+2212 minus sign */, '-Infinity', '-1e3',
    ]) {
      expect(looksNumeric(v), JSON.stringify(v)).toBe(false);
      expect(toNumber(v), JSON.stringify(v)).toBeUndefined();
    }
  });

  it('reads back every number that toStr writes without an exponent', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e20, max: 1e20, noNaN: true }).filter((n) => !toStr(n).includes('e')),
        (n) => toNumber(toStr(n)) === n,
      ),
      { numRuns: 300 },
    );
  });
});

describe('R11.5 compare', () => {
  it('compares as numbers when both sides look numeric', () => {
    expect(compare('10', '9')).toBe(1);
    expect(compare(9, '10')).toBe(-1);
    expect(compare(2, '2.0')).toBe(0);
    expect(compare(' 3', 3)).toBe(0);
    expect(compare('007', '7')).toBe(0);
  });

  it('compares as strings, ignoring case, otherwise', () => {
    expect(compare('abc', 'ABC')).toBe(0);
    expect(compare('apple', 'Banana')).toBe(-1);
    expect(compare('Zebra', 'apple')).toBe(1);
    expect(compare('', 'a')).toBe(-1);
  });

  it('uses the string order when only one side looks numeric', () => {
    // As numbers 10 > 9; as strings "10" < "9a".
    expect(compare('10', '9a')).toBe(-1);
    expect(compare(10, 'ten')).toBe(-1);
  });

  it('falls back to the string order for NaN', () => {
    expect(compare(NaN, NaN)).toBe(0);
    expect(compare(NaN, 1)).toBe(1);
  });

  it('is antisymmetric and gives only -1, 0 or 1', () => {
    const valueArb: fc.Arbitrary<Value> = fc.oneof(
      fc.double({ noNaN: true }),
      fc.constantFrom('3', ' 3 ', '3.0', '10', '9a', 'abc', 'ABC', '', 'true', 'TRUE'),
      fc.string({ maxLength: 4 }),
    );
    fc.assert(
      fc.property(valueArb, valueArb, (a, b) => {
        const ab = compare(a, b);
        expect([-1, 0, 1]).toContain(ab);
        expect(compare(b, a)).toBe(-ab || 0);
      }),
      { numRuns: 500 },
    );
  });
});

// 6.1a: a score below zero is stored in a field as "-5" and must still count as a number.
describe('R11.4 / R11.5 negative values read back as strings', () => {
  it('reads a minus sign before the digits as part of the number', () => {
    expect(looksNumeric('-5')).toBe(true);
    expect(toNumber(' -2.5 ')).toBe(-2.5);
  });

  it('compares negative strings as numbers', () => {
    expect(compare('-2', '-10')).toBe(1);
    // The string order gives 1 for the pair above as well. These pairs come out
    // differently as strings, so they show that the numeric order is the one used.
    expect(compare('-2', '-1')).toBe(-1);
    expect(compare('-1', '-2')).toBe(1);
    expect(compare('-2', '-2.0')).toBe(0);
    expect(compare(-2, ' -2 ')).toBe(0);
  });
});

describe('R11.6 / R9.4 asBool', () => {
  it('accepts true and false in any case', () => {
    expect(asBool('true', { line: 1 })).toBe(true);
    expect(asBool('TRUE', { line: 1 })).toBe(true);
    expect(asBool('False', { line: 1 })).toBe(false);
  });

  it('rejects anything else with a runtime error on the given line', () => {
    for (const v of ['yes', '', ' true', 'true ', '1', 1, 0]) {
      const error = boolError(v, 7);
      expect(error, JSON.stringify(v)).toMatchObject({ kind: 'runtime', line: 7 });
      expect(error.message).toMatch(/^expected true or false, but got /);
    }
  });

  it('names the value it got in the message', () => {
    expect(boolError('yes').message).toBe('expected true or false, but got "yes"');
    expect(boolError(3).message).toBe('expected true or false, but got 3');
    expect(boolError('').message).toBe('expected true or false, but got an empty value');
  });
});

describe('quoteValue', () => {
  it('shortens long strings to 40 characters', () => {
    expect(quoteValue('x'.repeat(41))).toBe(`"${'x'.repeat(40)}…"`);
    expect(quoteValue('x'.repeat(40))).toBe(`"${'x'.repeat(40)}"`);
  });

  it('does not split a character made of two code units', () => {
    expect(quoteValue('👻'.repeat(41))).toBe(`"${'👻'.repeat(40)}…"`);
  });
});
