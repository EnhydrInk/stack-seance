import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  englishNameProblems,
  findSameName,
  isAsciiText,
  looksNumeric,
  quote,
  sameName,
} from '../../src/compiler/names';
import { looksNumeric as interpreterLooksNumeric } from '../../src/hypertalk/values';

describe('Same_Name', () => {
  it('sameName compares after toLowerCase', () => {
    expect(sameName('Attic', 'attic')).toBe(true);
    expect(sameName('ATTIC', 'Attic')).toBe(true);
    expect(sameName('Attic', 'Attic ')).toBe(false);
    expect(sameName('', '')).toBe(true);
  });

  it('findSameName gives the first matching entry, as written in the list', () => {
    expect(findSameName(['Gate', 'Hall', 'HALL'], 'hall')).toBe('Hall');
    expect(findSameName(['Gate', 'Hall'], 'Kitchen')).toBeUndefined();
    expect(findSameName([], 'Hall')).toBeUndefined();
  });

  it('findSameName never matches an empty entry', () => {
    expect(findSameName(['', 'Hall'], '')).toBeUndefined();
    expect(findSameName([''], '')).toBeUndefined();
    expect(findSameName(['', 'Hall'], 'hall')).toBe('Hall');
  });
});

describe('English_Name: englishNameProblems', () => {
  it('finds nothing wrong with a short English name', () => {
    for (const name of ['Kitchen', 'To the kitchen', "Witch's Kitchen", 'Room 3', 'a', 'x'.repeat(24), 'Go!']) {
      expect(englishNameProblems(name), name).toEqual([]);
    }
  });

  it('reports each problem alone', () => {
    expect(englishNameProblems('')).toEqual(['is empty']);
    expect(englishNameProblems('x'.repeat(25))).toEqual(['is 25 characters long, more than 24']);
    expect(englishNameProblems('Küche')).toEqual(['holds a character that is not printable ASCII']);
    expect(englishNameProblems('Tab\there')).toEqual(['holds a character that is not printable ASCII']);
    expect(englishNameProblems('123')).toEqual(['holds no letter']);
    expect(englishNameProblems('Say "hi"')).toEqual(['holds a double quote']);
    expect(englishNameProblems(' Kitchen')).toEqual(['starts or ends with a space']);
    expect(englishNameProblems('Kitchen ')).toEqual(['starts or ends with a space']);
  });

  it('gives only "is empty" for the empty string', () => {
    expect(englishNameProblems('')).toEqual(['is empty']);
  });

  it('reports combined problems in order', () => {
    expect(englishNameProblems('厨房')).toEqual(['holds a character that is not printable ASCII', 'holds no letter']);
    expect(englishNameProblems(' ')).toEqual(['holds no letter', 'starts or ends with a space']);
    expect(englishNameProblems('"')).toEqual(['holds no letter', 'holds a double quote']);
    expect(englishNameProblems(` ${'"'.repeat(24)}é`)).toEqual([
      'is 26 characters long, more than 24',
      'holds a character that is not printable ASCII',
      'holds no letter',
      'holds a double quote',
      'starts or ends with a space',
    ]);
    expect(englishNameProblems('Go to the kitchen and let a bat out')).toEqual(['is 35 characters long, more than 24']);
  });

  it('counts length in UTF-16 code units', () => {
    expect(englishNameProblems('👻'.repeat(12))).toEqual(['holds a character that is not printable ASCII', 'holds no letter']);
    expect(englishNameProblems('👻'.repeat(13))[0]).toBe('is 26 characters long, more than 24');
  });
});

describe('ASCII_Text: isAsciiText', () => {
  it('accepts U+0020 to U+007E and the empty string', () => {
    expect(isAsciiText('')).toBe(true);
    expect(isAsciiText(' ~')).toBe(true);
    expect(isAsciiText(Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).join(''))).toBe(true);
  });

  it('rejects control characters and anything past U+007E', () => {
    for (const s of ['\t', '\n', '\x1F', '\x7F', 'é', '\u3000', '你好', '👻']) {
      expect(isAsciiText(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe('Looks_Numeric agrees with the interpreter (R11.4)', () => {
  it('on a fixed list', () => {
    const expected: [string, boolean][] = [
      ['3', true], [' 007 ', true], ['-5', true], ['2.5', true], ['- 5', false],
      ['+1', false], ['.5', false], ['3.', false], ['1e3', false], ['', false],
    ];
    for (const [s, numeric] of expected) {
      expect(looksNumeric(s), JSON.stringify(s)).toBe(numeric);
      expect(interpreterLooksNumeric(s), JSON.stringify(s)).toBe(numeric);
    }
  });

  it('on 1,000 strings from a fixed-seed sample', () => {
    const space = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\u3000', '\u00A0'), { maxLength: 2 });
    const digits = fc.stringOf(fc.constantFrom('0', '1', '7', '9'), { minLength: 1, maxLength: 4 });
    // Numbers in the R11.4 form, and the same parts with one of them bent out of shape.
    const numberLike = fc
      .tuple(space, fc.constantFrom('', '-', '+', '- ', '--'), digits, fc.constantFrom('', '.', '.5', '.05', 'e3', '..5'), space)
      .map((parts) => parts.join(''));
    const scramble = fc.stringOf(fc.constantFrom('0', '1', '7', '-', '.', ' ', '\t', 'e', '+', 'a', '\u3000'), { maxLength: 8 });
    const strings = fc.oneof(
      { arbitrary: numberLike, weight: 5 },
      { arbitrary: scramble, weight: 1 },
      { arbitrary: fc.string(), weight: 1 },
      { arbitrary: fc.fullUnicodeString({ maxLength: 6 }), weight: 1 },
    );
    const sample = fc.sample(strings, {
      numRuns: 1000,
      seed: 42,
    });
    const numeric = sample.filter((s) => interpreterLooksNumeric(s)).length;
    expect(numeric, 'the sample holds both kinds').toBeGreaterThan(100);
    expect(sample.length - numeric, 'the sample holds both kinds').toBeGreaterThan(100);
    for (const s of sample) expect(looksNumeric(s), JSON.stringify(s)).toBe(interpreterLooksNumeric(s));
  });
});

describe('quote', () => {
  it('is JSON.stringify for values up to 80 code units', () => {
    expect(quote('Kitchen')).toBe('"Kitchen"');
    expect(quote('')).toBe('""');
    expect(quote('a'.repeat(80))).toBe(`"${'a'.repeat(80)}"`);
  });

  it('cuts a value of 81 code units to 80 plus …', () => {
    expect(quote('a'.repeat(81))).toBe(`"${'a'.repeat(80)}…"`);
    expect(quote(`${'a'.repeat(80)}bcdef`)).toBe(`"${'a'.repeat(80)}…"`);
  });

  it('escapes quotes and line breaks, so a report stays on one line', () => {
    expect(quote('say "hi"\nthen go')).toBe('"say \\"hi\\"\\nthen go"');
    expect(quote('  summon cat')).toBe('"  summon cat"');
  });

  it('keeps CJK text unescaped', () => {
    expect(quote('厨房')).toBe('"厨房"');
  });
});
