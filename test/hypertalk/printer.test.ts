import { describe, it, expect } from 'vitest';
import { parse } from '../../src/hypertalk/parser';
import { print } from '../../src/hypertalk/printer';
import { stripPositions, type Script } from '../../src/hypertalk/ast';

const src = (...lines: string[]) => lines.join('\n');

function ok(source: string): Script {
  const result = parse(source);
  if (!result.ok) throw new Error(`expected a tree, got ${JSON.stringify(result.error)}`);
  return result.script;
}

const reprint = (source: string) => print(ok(source));

/** Prints the body of a mouseUp handler and returns the indented lines. */
const bodyLines = (...lines: string[]) =>
  reprint(src('on mouseUp', ...lines, 'end mouseUp')).split('\n').slice(1, -2);

describe('printer canonical form', () => {
  it('prints nothing for an empty script', () => {
    expect(print({ handlers: [] })).toBe('');
  });

  it('separates handlers with one blank line and ends with a line break', () => {
    expect(reprint('ON MOUSEUP\n  go next card\nend MouseUp\n\n\n\non openCard\nend openCard')).toBe(
      'on mouseUp\n  go to next card\nend mouseUp\n\non openCard\nend openCard\n',
    );
  });

  it('normalises keyword case, spacing and comments, and keeps names as written', () => {
    expect(bodyLines('  PUT   "A -- b"  &&Field "Name"  INTO   Total -- note')).toEqual([
      '  put "A -- b" && field "Name" into Total',
    ]);
  });

  it('prints every simple statement', () => {
    expect(bodyLines(
      'go prev card',
      'go card "Kitchen"',
      'visual effect wipe left',
      'answer "Pick" with "A" or "B"',
      'answer it',
      'ask "Which room?"',
      'put 1 after field "Log"',
      'put "x" into answer_2',
      'hide button "Next"',
      'show field "Note"',
      'wait 1 seconds',
      'wait 2 second',
      'global a,b',
    )).toEqual([
      '  go to prev card',
      '  go to card "Kitchen"',
      '  visual effect wipe left',
      '  answer "Pick" with "A" or "B"',
      '  answer it',
      '  ask "Which room?"',
      '  put 1 after field "Log"',
      '  put "x" into answer_2',
      '  hide button "Next"',
      '  show field "Note"',
      '  wait 1 second',
      '  wait 2 seconds',
      '  global a, b',
    ]);
  });

  it('prints one-line ifs in the block form, indented two spaces per level', () => {
    expect(bodyLines('if a then go next card else go prev card')).toEqual([
      '  if a then',
      '    go to next card',
      '  else',
      '    go to prev card',
      '  end if',
    ]);
  });

  it('prints an else that holds one if as else if', () => {
    expect(bodyLines(
      'if n is 1 then',
      '  answer "one"',
      'else',
      '  if n is 2 then answer "two" else answer "many"',
      'end if',
    )).toEqual([
      '  if n is 1 then',
      '    answer "one"',
      '  else if n is 2 then',
      '    answer "two"',
      '  else',
      '    answer "many"',
      '  end if',
    ]);
  });

  it('prints true and false in lowercase, and keeps "true" as a string', () => {
    expect(bodyLines('put TRUE is "true" into x')).toEqual(['  put true is "true" into x']);
  });

  it('keeps the parentheses that were written', () => {
    expect(bodyLines('put ((1)) + (2 * 3) into x')).toEqual(['  put ((1)) + (2 * 3) into x']);
  });

  it('writes exponent-form numbers out in full', () => {
    expect(bodyLines('put 1000000000000000000000 + 0.0000001 into x')).toEqual([
      '  put 1000000000000000000000 + 0.0000001 into x',
    ]);
  });
});

describe('R15 printing haunts', () => {
  const cases = [
    ['bat', 'release bat'],
    ['howl', 'howl'],
    ['witch', 'summon witch'],
    ['spider', 'drop spider'],
  ] as const;

  it('prints each kind as its words in lowercase, and parses back to the same node', () => {
    for (const [kind, words] of cases) {
      const printed = print({ handlers: [{ name: 'mouseUp', body: [{ t: 'haunt', kind }] }] });
      expect(printed).toBe(`on mouseUp\n  ${words}\nend mouseUp\n`);
      expect(stripPositions(ok(printed).handlers[0]!.body)).toEqual([{ t: 'haunt', kind }]);
    }
  });

  it('normalises the case of haunt words', () => {
    expect(bodyLines('RELEASE Bat', 'if x then Summon WITCH')).toEqual([
      '  release bat',
      '  if x then',
      '    summon witch',
      '  end if',
    ]);
  });
});

describe('printer parentheses for trees not made by the parser', () => {
  const v = (name: string) => ({ t: 'var', name }) as const;
  const bin = (op: '+' | '-' | '*' | 'is' | '<' | 'and' | 'or', left: object, right: object) =>
    ({ t: 'bin', op, left, right }) as never;
  const put = (value: never) => print({ handlers: [{ name: 'mouseUp', body: [{ t: 'putVar', value, name: 'x' }] }] });
  const line = (value: never) => put(value).split('\n')[1]!.trim();

  it('adds parentheses only where precedence or associativity needs them', () => {
    expect(line(bin('*', bin('+', v('a'), v('b')), v('c')))).toBe('put (a + b) * c into x');
    expect(line(bin('+', v('a'), bin('*', v('b'), v('c'))))).toBe('put a + b * c into x');
    expect(line(bin('-', v('a'), bin('-', v('b'), v('c'))))).toBe('put a - (b - c) into x');
    expect(line(bin('-', bin('-', v('a'), v('b')), v('c')))).toBe('put a - b - c into x');
    expect(line(bin('<', bin('<', v('a'), v('b')), v('c')))).toBe('put (a < b) < c into x');
    expect(line(bin('and', bin('or', v('a'), v('b')), v('c')))).toBe('put (a or b) and c into x');
  });

  it('protects not from the comparison around it', () => {
    const not = (operand: object) => ({ t: 'not', operand }) as never;
    expect(line(bin('is', v('a'), not(v('b'))))).toBe('put a is (not b) into x');
    expect(line(bin('is', not(v('a')), v('b')))).toBe('put (not a) is b into x');
    expect(line(not(bin('and', v('a'), v('b'))))).toBe('put not (a and b) into x');
    expect(line(not(bin('is', v('a'), v('b'))))).toBe('put not a is b into x');
  });

  it('puts a calculated go target in parentheses', () => {
    const script = { handlers: [{ name: 'mouseUp' as const, body: [{ t: 'go' as const, target: { k: 'card' as const, expr: bin('+', v('n'), { t: 'num', value: 1 }) } }] }] };
    const printed = print(script);
    expect(printed).toContain('go to card (n + 1)');
    expect(parse(printed).ok).toBe(true);
  });

  it('gives back the same tree when the parser reads printed output', () => {
    const source = src(
      'on mouseUp',
      '  if not (a and b) is c or d contains "x" then',
      '    put (1 - (2 - 3)) * 4 & "y" into z',
      '  end if',
      'end mouseUp',
    );
    expect(stripPositions(ok(reprint(source)))).toEqual(stripPositions(ok(source)));
  });
});
