// Task 7: evaluating expressions, and variables (locals, globals, `it`).
// Results are read back through a global, so every test runs real source through runHandler.

import { describe, it, expect } from 'vitest';
import type { RuntimeError } from '../../src/hypertalk/errors';
import type { RunResult } from '../../src/hypertalk/host';
import { runHandler } from '../../src/hypertalk/runtime';
import type { Value } from '../../src/hypertalk/values';
import { FakeHost, type Reply } from './helpers/fakeHost';

const src = (...lines: string[]) => lines.join('\n');
/** Wraps lines in `on mouseUp … end mouseUp`, so the first given line is line 2. */
const inHandler = (...lines: string[]) => src('on mouseUp', ...lines.map((l) => `  ${l}`), 'end mouseUp');

interface Setup {
  fields?: { name: string; text: string }[];
  replies?: Reply[];
  globals?: [string, Value][];
}

async function run(source: string, setup: Setup = {}) {
  const host = new FakeHost({ cards: [{ fields: setup.fields ?? [] }], replies: setup.replies ?? [] });
  const globals = new Map<string, Value>(setup.globals ?? []);
  const result = await runHandler(source, 'mouseUp', { host, globals, scriptId: 'card-1' });
  return { result, host, globals };
}

function runtimeErrorOf(result: RunResult, what: string): RuntimeError {
  if (result.ok || result.error.kind !== 'runtime') {
    throw new Error(`expected a runtime error for ${what}, got ${JSON.stringify(result)}`);
  }
  return result.error;
}

/** `put <expr> into result` is line 3 of the script these two helpers run. */
const exprScript = (expr: string) => inHandler('global result', `put ${expr} into result`);

/** The value of an expression. */
async function value(expr: string, setup?: Setup): Promise<Value | undefined> {
  const { result, globals } = await run(exprScript(expr), setup);
  expect(result, expr).toEqual({ ok: true });
  return globals.get('result');
}

/** The runtime error an expression raises. */
async function failure(expr: string, setup?: Setup): Promise<RuntimeError> {
  return runtimeErrorOf((await run(exprScript(expr), setup)).result, expr);
}

async function expectValues(cases: [string, Value][], setup?: Setup) {
  for (const [expr, expected] of cases) expect(await value(expr, setup), expr).toBe(expected);
}

describe('R14.1 runHandler', () => {
  it('does nothing for a handler the script does not define (R1.7)', async () => {
    const { result, host } = await run(src('on openCard', '  ask "x"', 'end openCard'));
    expect(result).toEqual({ ok: true });
    expect(host.log).toEqual([]);
  });

  it('returns a syntax error instead of running anything (R12.3)', async () => {
    const { result, host } = await run(inHandler('ask "x"', 'put 1 into'));
    expect(result).toMatchObject({ ok: false, error: { kind: 'syntax', line: 3 } });
    expect(host.log).toEqual([]);
  });
});

describe('R11.3 & and &&', () => {
  it('joins without a space and with one space', async () => {
    await expectValues([
      ['"Haunted" & "House"', 'HauntedHouse'],
      ['"Haunted" && "House"', 'Haunted House'],
      ['"" && ""', ' '],
      ['"a" && "b" & "c"', 'a bc'],
    ]);
  });

  it('writes numbers the way JavaScript does (R11.8)', async () => {
    await expectValues([
      ['1 & 2', '12'],
      ['1 / 4 & ""', '0.25'],
      ['0 - 5 && "points"', '-5 points'],
    ]);
  });
});

describe('R11.4 arithmetic', () => {
  it('computes with numbers and gives numbers', async () => {
    await expectValues([
      ['1 + 2', 3],
      ['7 - 10', -3],
      ['6 * 7', 42],
      ['1 / 4', 0.25],
      ['0 - 5', -5],
    ]);
  });

  it('accepts strings that look like numbers, negative ones included', async () => {
    await expectValues([
      ['"3" + 4', 7],
      ['" 2 " * "3"', 6],
      ['"-5" + 1', -4],
      ['"2.5" - "-2.5"', 5],
    ]);
  });

  it('reads numbers from fields, where they are strings', async () => {
    expect(await value('field "score" + 1', { fields: [{ name: 'score', text: '41' }] })).toBe(42);
    expect(await value('field "Score" + 1', { fields: [{ name: 'score', text: '-5' }] })).toBe(-4);
    // As strings "-5" is after "-1"; as numbers it is before.
    expect(await value('field "score" < 0 - 1', { fields: [{ name: 'score', text: '-5' }] })).toBe('true');
  });

  it('reports anything else as a runtime error on its line', async () => {
    const cases: [string, string][] = [
      ['"abc" + 1', '"abc"'],
      ['1 - ""', 'an empty value'],
      ['true * 2', '"true"'],
      ['nothing + 1', 'an empty value'],
      ['"- 5" + 0', '"- 5"'],
      ['2 / "1e3"', '"1e3"'],
    ];
    for (const [expr, got] of cases) {
      const error = await failure(expr);
      expect(error, expr).toEqual({ kind: 'runtime', line: 3, message: expect.stringContaining(`but got ${got}`) });
    }
    expect((await failure('"abc" + 1')).message).toBe('expected a number for "+", but got "abc"');
  });

  it('reports division by zero', async () => {
    for (const expr of ['1 / 0', '0 / 0', '1 / (2 - 2)', '5 / "0"', '5 / " -0 "']) {
      expect(await failure(expr), expr).toEqual({ kind: 'runtime', line: 3, message: 'cannot divide by zero' });
    }
  });

  it('stops at the error line and keeps what ran before it (R12.3)', async () => {
    const { result, globals } = await run(
      inHandler('global result', 'put 1 into result', 'put result / 0 into result', 'put 2 into result'),
    );
    expect(runtimeErrorOf(result, 'division').line).toBe(4);
    expect(globals.get('result')).toBe(1);
  });
});

describe('R11.2 precedence', () => {
  it('binds * and / tighter than + and -, and both left to right', async () => {
    await expectValues([
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['10 - 4 - 3', 3],
      ['8 / 4 / 2', 1],
      ['10 - (4 - 3)', 9],
    ]);
  });

  it('binds + and - tighter than & and &&', async () => {
    await expectValues([
      ['1 + 2 & 3', '33'],
      ['"a" & 1 + 2', 'a3'],
      ['"n" && 2 * 3', 'n 6'],
    ]);
  });

  it('binds & tighter than comparison, comparison tighter than not, not tighter than and, and tighter than or', async () => {
    await expectValues([
      ['2 + 3 is 5', 'true'],
      ['"ab" & "c" is "abc"', 'true'],
      ['not 1 is 2', 'true'],
      ['not false and false', 'false'],
      ['true or false and false', 'true'],
      ['false and false or true', 'true'],
      ['not (true and false)', 'true'],
    ]);
  });
});

describe('R11.5 comparison', () => {
  it('compares as numbers when both sides look like numbers', async () => {
    await expectValues([
      ['"10" > "9"', 'true'],
      ['"2.0" is 2', 'true'],
      ['" 3 " is 3', 'true'],
      ['"007" is "7"', 'true'],
      ['"-2" < "-1"', 'true'],
      ['"-2" > "-10"', 'true'],
    ]);
  });

  it('compares as strings, ignoring case, otherwise', async () => {
    await expectValues([
      ['"10" > "9a"', 'false'],
      ['"abc" is "ABC"', 'true'],
      ['"apple" < "Banana"', 'true'],
      ['"Ghost" is not "ghost"', 'false'],
      ['"" is nothing', 'true'],
    ]);
  });

  it('has all six operators', async () => {
    await expectValues([
      ['2 < 3', 'true'],
      ['3 < 3', 'false'],
      ['3 > 2', 'true'],
      ['2 <= 2', 'true'],
      ['3 >= 4', 'false'],
      ['2 is 2', 'true'],
      ['2 is not 3', 'true'],
    ]);
  });
});

describe('R11.6 contains', () => {
  it('tests for a substring, ignoring case', async () => {
    await expectValues([
      ['"Haunted House" contains "HOUSE"', 'true'],
      ['"abc" contains "d"', 'false'],
      ['"a" contains "abc"', 'false'],
      ['"abc" contains ""', 'true'],
      ['123 contains 2', 'true'],
    ]);
  });
});

describe('R11.6 boolean operators', () => {
  it('follow the truth tables', async () => {
    for (const a of [true, false]) {
      for (const b of [true, false]) {
        expect(await value(`${a} and ${b}`)).toBe(String(a && b));
        expect(await value(`${a} or ${b}`)).toBe(String(a || b));
      }
      expect(await value(`not ${a}`)).toBe(String(!a));
    }
  });

  it('accept "true" and "false" in any case, and the results of comparisons', async () => {
    await expectValues([
      ['"TRUE" and "False"', 'false'],
      ['not "FALSE"', 'true'],
      ['1 < 2 and "a" is "A"', 'true'],
    ]);
  });

  it('report anything else as a runtime error on its line, even when the other side decides', async () => {
    const cases: [string, string][] = [
      ['1 and true', '1'],
      ['true or "yes"', '"yes"'],
      ['not 0', '0'],
      ['false and 5', '5'],
      ['true or nothing', 'an empty value'],
    ];
    for (const [expr, got] of cases) {
      expect(await failure(expr), expr).toEqual({
        kind: 'runtime',
        line: 3,
        message: `expected true or false, but got ${got}`,
      });
    }
  });
});

describe('R11.10 / 7.4 true and false', () => {
  it('evaluate to the strings "true" and "false"', async () => {
    await expectValues([
      ['true', 'true'],
      ['FALSE', 'false'],
      ['true is "TRUE"', 'true'],
      ['1 is 1', 'true'],
    ]);
  });

  const quiz = inHandler(
    'global branch',
    'ask "Is it a ghost?"',
    'put it is "yes" into correct',
    'if correct is true then',
    '  put "then" into branch',
    'else',
    '  put "else" into branch',
    'end if',
  );

  it('let a stored comparison drive an if', async () => {
    for (const [reply, branch] of [['yes', 'then'], ['YES', 'then'], ['no', 'else']] as const) {
      const { result, globals, host } = await run(quiz, { replies: [reply] });
      expect(result).toEqual({ ok: true });
      expect(globals.get('branch'), reply).toBe(branch);
      expect(host.log).toEqual([{ call: 'ask', message: 'Is it a ghost?' }]);
    }
  });
});

describe('R5.3 / R5.4 field expressions', () => {
  it('read the text of a field on the current card as a string, ignoring case', async () => {
    expect(await value('field "NOTE"', { fields: [{ name: 'note', text: '42' }] })).toBe('42');
  });

  it('report a missing field on its line', async () => {
    expect(await failure('field "score" + 1')).toEqual({
      kind: 'runtime',
      line: 3,
      message: 'there is no field "score" on this card',
    });
  });
});

describe('R8 variables', () => {
  it('read a variable that was never set as the empty string (R8.1)', async () => {
    expect(await value('nothing & "!"')).toBe('!');
    expect(await value('it')).toBe('');
  });

  it('ignore case in names (R1.8)', async () => {
    const { globals } = await run(inHandler('global result', 'put 2 into Score', 'put SCORE * 3 into result'));
    expect(globals.get('result')).toBe(6);
  });

  it('keep the value as it is, so a number stays a number', async () => {
    const { globals } = await run(inHandler('global result', 'put 0 - 5 into n', 'put n into result'));
    expect(globals.get('result')).toBe(-5);
  });

  it('keep locals to one run and out of the global store (R8.1)', async () => {
    const globals = new Map<string, Value>();
    const ctx = { host: new FakeHost({ cards: [{}] }), globals, scriptId: 'card-1' };
    expect(await runHandler(inHandler('put 5 into n'), 'mouseUp', ctx)).toEqual({ ok: true });
    expect(globals.size).toBe(0);
    expect(await runHandler(exprScript('n'), 'mouseUp', ctx)).toEqual({ ok: true });
    expect(globals.get('result')).toBe('');
  });

  it('store globals in the global store under lower-cased names (R8.2)', async () => {
    const { globals } = await run(inHandler('global Score, Lives', 'put 3 into SCORE', 'put 2 into lives'));
    expect([...globals]).toEqual([['score', 3], ['lives', 2]]);
  });

  it('read globals that are already in the store, and the empty string for one never set', async () => {
    const { globals } = await run(inHandler('global visits, ghost', 'put visits + 1 into visits', 'put ghost into ghost'), {
      globals: [['visits', 2]],
    });
    expect(globals.get('visits')).toBe(3);
    expect(globals.get('ghost')).toBe('');
  });

  it('make a name global only from the global statement on (R8.2)', async () => {
    const { globals } = await run(inHandler('put 1 into x', 'global x, result', 'put x into result'), {
      globals: [['x', 7]],
    });
    expect(globals.get('result')).toBe(7);
    expect(globals.get('x')).toBe(7);
  });

  it('share globals between handlers of different cards, and not locals with the same name', async () => {
    const globals = new Map<string, Value>();
    const host = new FakeHost({ cards: [{}, {}] });
    const first = src('on mouseUp', '  global g', '  put "boo" into g', '  put "local" into l', 'end mouseUp');
    const second = src('on openCard', '  global g, seen', '  put g && l into seen', 'end openCard');
    expect(await runHandler(first, 'mouseUp', { host, globals, scriptId: 'card-1' })).toEqual({ ok: true });
    expect(await runHandler(second, 'openCard', { host, globals, scriptId: 'card-2' })).toEqual({ ok: true });
    expect(globals.get('seen')).toBe('boo ');
  });

  it('treat it as an ordinary local that ask sets (R8.3)', async () => {
    const own = await run(inHandler('global result', 'put "x" into it', 'put it & "y" into result'));
    expect(own.globals.get('result')).toBe('xy');

    const asked = await run(inHandler('global result', 'ask "Name?"', 'put it into result'), { replies: ['Mona'] });
    expect(asked.globals.get('result')).toBe('Mona');
    expect(asked.globals.has('it')).toBe(false);

    const shared = await run(inHandler('global it', 'ask "Name?"'), { replies: ['Mona'] });
    expect(shared.globals.get('it')).toBe('Mona');
  });
});

describe('R9.4 / R9.6 / 7.5 if and else if at runtime', () => {
  const chain = (second: string) =>
    inHandler(
      'global n, taken', //       line 2
      'put "" into taken', //     line 3
      'if n is 1 then', //        line 4
      '  put taken & "a" into taken',
      `else if ${second} then`, // line 6
      '  put taken & "b" into taken',
      'else if n < 10 then', //   line 8
      '  put taken & "c" into taken',
      'else',
      '  put taken & "d" into taken',
      'end if',
    );

  it('runs only the first branch whose condition is true, and the final else when none is', async () => {
    for (const [n, taken] of [[1, 'a'], [3, 'b'], ['3', 'b'], [7, 'c'], [12, 'd']] as const) {
      const { result, globals } = await run(chain('n < 5'), { globals: [['n', n]] });
      expect(result, String(n)).toEqual({ ok: true });
      expect(globals.get('taken'), String(n)).toBe(taken);
    }
  });

  it('reports a condition that is not true or false on the line of its else if', async () => {
    const { result, globals } = await run(chain('n'), { globals: [['n', 'maybe']] });
    expect(runtimeErrorOf(result, 'else if n')).toEqual({
      kind: 'runtime',
      line: 6,
      message: 'expected true or false, but got "maybe"',
    });
    expect(globals.get('taken')).toBe('');
  });

  it('does not evaluate the conditions after the branch that runs', async () => {
    const { result, globals } = await run(chain('n'), { globals: [['n', 1]] });
    expect(result).toEqual({ ok: true });
    expect(globals.get('taken')).toBe('a');
  });

  it('reports a condition that is not true or false on the line of the if (R9.4)', async () => {
    const block = await run(inHandler('global n', 'if n then', '  put 1 into n', 'end if'), { globals: [['n', 'yes']] });
    expect(runtimeErrorOf(block.result, 'block if')).toMatchObject({ line: 3, message: 'expected true or false, but got "yes"' });

    const oneLine = await run(inHandler('put 1 into x', 'if x then put 2 into x'));
    expect(runtimeErrorOf(oneLine.result, 'one-line if')).toMatchObject({ line: 3, message: 'expected true or false, but got 1' });
  });

  it('runs the one-line form with its else', async () => {
    const script = inHandler('global n, result', 'if n < 2 then put "small" into result else put "big" into result');
    expect((await run(script, { globals: [['n', 1]] })).globals.get('result')).toBe('small');
    expect((await run(script, { globals: [['n', 5]] })).globals.get('result')).toBe('big');
  });
});
