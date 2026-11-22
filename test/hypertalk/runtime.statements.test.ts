// Task 8: running statements (put, show, hide, answer, ask, wait, if, haunts) and the
// top-level catch. Every test runs real source through runHandler against the fake host.

import { describe, it, expect } from 'vitest';
import type { RuntimeError } from '../../src/hypertalk/errors';
import type { RunResult } from '../../src/hypertalk/host';
import { runHandler } from '../../src/hypertalk/runtime';
import type { HauntKind } from '../../src/hypertalk/tokens';
import type { Value } from '../../src/hypertalk/values';
import { FakeHost, type FakeHostInit } from './helpers/fakeHost';
import { ONE_LINE_IF_REPRO_1 } from './helpers/ifShapes';
import { handlerSource, REPROS } from './helpers/lexMask';

const src = (...lines: string[]) => lines.join('\n');
/** Wraps lines in `on mouseUp … end mouseUp`, so the first given line is line 2. */
const inHandler = (...lines: string[]) => src('on mouseUp', ...lines.map((l) => `  ${l}`), 'end mouseUp');

/** One empty card unless the test says otherwise. */
const makeHost = (init: Partial<FakeHostInit> = {}) => new FakeHost({ cards: [{}], ...init });

async function run(source: string, host = makeHost(), globals = new Map<string, Value>()) {
  const result = await runHandler(source, 'mouseUp', { host, globals, scriptId: 'card-1' });
  return { result, host, globals };
}

function runtimeErrorOf(result: RunResult, what: string): RuntimeError {
  if (result.ok || result.error.kind !== 'runtime') {
    throw new Error(`expected a runtime error for ${what}, got ${JSON.stringify(result)}`);
  }
  return result.error;
}

/** Lets every pending promise callback run, so a test can see where a run is waiting. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('R5 / 8.1 put', () => {
  it('prepends with before, appends with after and replaces with into (R5.2)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'Note', text: 'b' }] }] });
    const { result } = await run(
      inHandler('put "a" before field "note"', 'put "c" after field "NOTE"', 'put "boo" into field "Note"'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(host.fieldText('note')).toBe('boo');
    expect(host.log).toEqual([
      { call: 'getField', name: 'note' },
      { call: 'setField', name: 'note', text: 'ab' },
      { call: 'getField', name: 'NOTE' },
      { call: 'setField', name: 'NOTE', text: 'abc' },
      { call: 'setField', name: 'Note', text: 'boo' },
    ]);
  });

  it('converts values to strings first (R5.2, R11.8)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'n' }] }] });
    expect((await run(inHandler('put 1 / 4 into field "n"', 'put 6 * 7 after field "n"'), host)).result).toEqual({ ok: true });
    expect(host.fieldText('n')).toBe('0.2542');
  });

  it('stores a negative number in a field and computes with it again (R11.4)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'score', text: '10' }] }] });
    const { result } = await run(
      inHandler('put 0 - 5 into field "score"', 'put field "score" + 1 into field "score"'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(host.fieldText('score')).toBe('-4');
    expect(host.log.filter((c) => c.call === 'setField')).toEqual([
      { call: 'setField', name: 'score', text: '-5' },
      { call: 'setField', name: 'score', text: '-4' },
    ]);
  });

  it('puts into a variable without converting, so a number stays a number (R5.1)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'out' }] }] });
    const { result, globals } = await run(
      inHandler('global total', 'put 2 * 3 into total', 'put total & "!" into field "out"'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(globals.get('total')).toBe(6);
    expect(host.fieldText('out')).toBe('6!');
  });

  it('reports a missing field on the put line in every mode, and keeps what ran before (R5.4, R12.3)', async () => {
    for (const mode of ['into', 'after', 'before']) {
      const host = makeHost({ cards: [{ fields: [{ name: 'here' }] }] });
      const { result } = await run(
        inHandler('put "x" into field "here"', `put 1 ${mode} field "gone"`, 'put "y" into field "here"'),
        host,
      );
      expect(runtimeErrorOf(result, mode), mode).toEqual({
        kind: 'runtime',
        line: 3,
        message: 'there is no field "gone" on this card',
      });
      expect(host.fieldText('here'), mode).toBe('x');
    }
  });

  it('looks for the field on the current card only (R5.4)', async () => {
    const host = makeHost({ cards: [{}, { fields: [{ name: 'score', text: '7' }] }] });
    const { result } = await run(inHandler('put 1 into field "score"'), host);
    expect(runtimeErrorOf(result, 'field on another card')).toMatchObject({ line: 2 });
    expect(host.fieldText('score', 2)).toBe('7');
  });
});

describe('R6 / 8.2 show and hide', () => {
  it('hides and shows buttons and fields on the current card, ignoring case (R6.1)', async () => {
    const host = makeHost({ cards: [{ buttons: [{ name: 'Door' }], fields: [{ name: 'Clue', visible: false }] }] });
    const { result } = await run(inHandler('hide button "door"', 'show field "CLUE"'), host);
    expect(result).toEqual({ ok: true });
    expect(host.isVisible('button', 'Door')).toBe(false);
    expect(host.isVisible('field', 'Clue')).toBe(true);
    expect(host.log).toEqual([
      { call: 'setVisible', kind: 'button', name: 'door', visible: false },
      { call: 'setVisible', kind: 'field', name: 'CLUE', visible: true },
    ]);
  });

  it('accepts showing a visible item and hiding a hidden one (R6.3)', async () => {
    const host = makeHost({ cards: [{ buttons: [{ name: 'door' }], fields: [{ name: 'clue', visible: false }] }] });
    const { result } = await run(inHandler('show button "door"', 'hide field "clue"'), host);
    expect(result).toEqual({ ok: true });
    expect(host.isVisible('button', 'door')).toBe(true);
    expect(host.isVisible('field', 'clue')).toBe(false);
  });

  it('reports a missing button or field on its line, and runs nothing after it (R6.2)', async () => {
    const cases: [string, string][] = [
      ['show button "gate"', 'there is no button "gate" on this card'],
      ['hide field "gate"', 'there is no field "gate" on this card'],
      // A button and a field are different things, even with the same name.
      ['hide field "door"', 'there is no field "door" on this card'],
      ['show button "note"', 'there is no button "note" on this card'],
    ];
    for (const [stmt, message] of cases) {
      const host = makeHost({ cards: [{ buttons: [{ name: 'door' }], fields: [{ name: 'note' }] }] });
      const { result } = await run(inHandler(stmt, 'hide button "door"'), host);
      expect(runtimeErrorOf(result, stmt), stmt).toEqual({ kind: 'runtime', line: 2, message });
      expect(host.isVisible('button', 'door'), stmt).toBe(true);
    }
  });
});

describe('R4 / 8.3 answer and ask', () => {
  it('shows an OK button when answer has no labels, and puts OK into it (R4.4)', async () => {
    const { result, host, globals } = await run(inHandler('global result', 'answer "The door creaks."', 'put it into result'));
    expect(result).toEqual({ ok: true });
    expect(host.log).toEqual([{ call: 'answer', message: 'The door creaks.', labels: ['OK'] }]);
    expect(globals.get('result')).toBe('OK');
  });

  it('passes the labels and puts the chosen one into it (R4.4)', async () => {
    const { result, host, globals } = await run(
      inHandler('global result', 'answer "A ghost!" with "Stay" or "Run" or "Hide"', 'put it into result'),
      makeHost({ replies: ['Run'] }),
    );
    expect(result).toEqual({ ok: true });
    expect(host.log).toEqual([{ call: 'answer', message: 'A ghost!', labels: ['Stay', 'Run', 'Hide'] }]);
    expect(globals.get('result')).toBe('Run');
  });

  it('converts the prompt to a string before it goes to the host (R4.6)', async () => {
    const { result, host } = await run(inHandler('answer 1 / 4', 'ask 6 * 7', 'answer 0 - 5 && "lives"'));
    expect(result).toEqual({ ok: true });
    expect(host.log).toEqual([
      { call: 'answer', message: '0.25', labels: ['OK'] },
      { call: 'ask', message: '42' },
      { call: 'answer', message: '-5 lives', labels: ['OK'] },
    ]);
  });

  it('puts the reply to ask into it (R4.5)', async () => {
    const { result, globals } = await run(
      inHandler('global result', 'ask "Your name?"', 'put it into result'),
      makeHost({ replies: ['Mona'] }),
    );
    expect(result).toEqual({ ok: true });
    expect(globals.get('result')).toBe('Mona');
  });

  it('makes it empty when ask is cancelled, even when it held a value (R4.5)', async () => {
    const { result, globals } = await run(
      inHandler('global result', 'put "old" into it', 'ask "Your name?"', 'put it into result'),
      makeHost({ replies: [null] }),
    );
    expect(result).toEqual({ ok: true });
    expect(globals.get('result')).toBe('');
  });
});

describe('R7 / 8.4 wait', () => {
  it('asks the host to wait that many seconds, as a number (R7.1, R7.2)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'delay', text: ' 0.5 ' }] }] });
    const { result } = await run(
      inHandler('wait 2 seconds', 'wait 1 second', 'wait field "delay" seconds', 'wait 0 seconds', 'wait 1 / 4 seconds'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(host.log.filter((c) => c.call === 'wait')).toEqual(
      [2, 1, 0.5, 0, 0.25].map((seconds) => ({ call: 'wait', seconds })),
    );
  });

  it('reports a value that is not a number, is negative or is not finite on the wait line (R7.3)', async () => {
    const big = `1${'0'.repeat(200)}`;
    const cases: [string, string][] = [
      ['"soon"', 'expected a number of seconds, but got "soon"'],
      ['nothing', 'expected a number of seconds, but got an empty value'],
      ['"1e3"', 'expected a number of seconds, but got "1e3"'],
      ['0 - 1', 'cannot wait a negative number of seconds (-1)'],
      ['field "delay"', 'cannot wait a negative number of seconds (-2)'],
      [`${big} * ${big}`, 'cannot wait Infinity seconds'],
      [`${big} * ${big} - ${big} * ${big}`, 'cannot wait NaN seconds'],
    ];
    for (const [expr, message] of cases) {
      const host = makeHost({ cards: [{ fields: [{ name: 'delay', text: '-2' }] }] });
      const { result } = await run(inHandler(`wait ${expr} seconds`, 'answer "done"'), host);
      expect(runtimeErrorOf(result, expr), expr).toEqual({ kind: 'runtime', line: 2, message });
      expect(host.log.filter((c) => c.call === 'wait' || c.call === 'answer'), expr).toEqual([]);
    }
  });
});

describe('R9 / 8.5 if and else running commands', () => {
  const door = inHandler(
    'if field "door" is "open" then', // line 2
    '  answer "Come in"',
    '  show button "Enter"',
    'else',
    '  hide button "Enter"',
    'end if',
  );
  const doorHost = (text: string) =>
    makeHost({ cards: [{ fields: [{ name: 'door', text }], buttons: [{ name: 'Enter', visible: false }] }] });

  it('runs the commands of the chosen branch and none of the other (R9.1)', async () => {
    const open = await run(door, doorHost('Open'));
    expect(open.result).toEqual({ ok: true });
    expect(open.host.log).toEqual([
      { call: 'getField', name: 'door' },
      { call: 'answer', message: 'Come in', labels: ['OK'] },
      { call: 'setVisible', kind: 'button', name: 'Enter', visible: true },
    ]);

    const shut = await run(door, doorHost('shut'));
    expect(shut.result).toEqual({ ok: true });
    expect(shut.host.log).toEqual([
      { call: 'getField', name: 'door' },
      { call: 'setVisible', kind: 'button', name: 'Enter', visible: false },
    ]);
  });

  it('runs neither branch when the condition is not true or false (R9.4)', async () => {
    const { result, host } = await run(inHandler('if field "door" then answer "a" else answer "b"'), doorHost('open'));
    expect(runtimeErrorOf(result, 'non-boolean if')).toEqual({
      kind: 'runtime',
      line: 2,
      message: 'expected true or false, but got "open"',
    });
    expect(host.log).toEqual([{ call: 'getField', name: 'door' }]);
  });

  it('runs commands in the one-line form, with and without else (R9.2)', async () => {
    const script = inHandler('if field "n" > 2 then answer "many" else answer "few"', 'if field "n" is 0 then answer "none"');
    for (const [n, said] of [['3', ['many']], ['1', ['few']], ['0', ['few', 'none']]] as const) {
      const { result, host } = await run(script, makeHost({ cards: [{ fields: [{ name: 'n', text: n }] }] }));
      expect(result, n).toEqual({ ok: true });
      expect(host.log.flatMap((c) => (c.call === 'answer' ? [c.message] : [])), n).toEqual(said);
    }
  });

  it('runs nested blocks (R9.3)', async () => {
    const script = inHandler(
      'global said',
      'put "" into said',
      'if field "door" is "open" then',
      '  if field "ghost" is "awake" then',
      '    put "boo" into said',
      '  else',
      '    put "snore" into said',
      '  end if',
      'else',
      '  put "knock" into said',
      'end if',
    );
    const cases = [['open', 'awake', 'boo'], ['open', 'asleep', 'snore'], ['shut', 'awake', 'knock']] as const;
    for (const [doorText, ghost, said] of cases) {
      const host = makeHost({ cards: [{ fields: [{ name: 'door', text: doorText }, { name: 'ghost', text: ghost }] }] });
      const { result, globals } = await run(script, host);
      expect(result).toEqual({ ok: true });
      expect(globals.get('said'), `${doorText}/${ghost}`).toBe(said);
    }
  });
});

describe('R12.1 / 8.6 unexpected exceptions', () => {
  it('turn a host method that throws into a runtime error on the line being run, keeping what ran before', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'note', text: 'quiet' }] }] });
    host.setVisible = () => {
      throw new Error('the card is locked');
    };
    const { result } = await run(
      inHandler('put "boo" into field "note"', 'hide field "note"', 'answer "after"'),
      host,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'runtime', line: 3, message: 'the card is locked' } });
    expect(host.fieldText('note')).toBe('boo');
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });

  it('turn a host promise that rejects into a runtime error on that line, for dialogs, wait and haunts', async () => {
    const dialog = makeHost();
    dialog.answer = async () => {
      throw new Error('the dialog was closed');
    };
    expect((await run(inHandler('put 1 into x', 'answer "hello"'), dialog)).result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 3, message: 'the dialog was closed' },
    });

    const timer = makeHost();
    timer.wait = () => Promise.reject(new Error('the clock stopped'));
    expect((await run(inHandler('wait 1 second'), timer)).result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: 'the clock stopped' },
    });

    const haunted = makeHost();
    haunted.haunt = () => Promise.reject(new Error('the animation failed'));
    expect((await run(inHandler('put 1 into x', 'put 2 into y', 'howl'), haunted)).result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 4, message: 'the animation failed' },
    });
  });

  it('name the line of the statement inside an if, or of the else if being tested', async () => {
    const inside = makeHost();
    inside.answer = () => Promise.reject(new Error('boom'));
    const block = inHandler('if true then', '  put "a" into x', '  answer "now"', 'end if');
    expect(runtimeErrorOf((await run(block, inside)).result, 'inside if')).toMatchObject({ line: 4, message: 'boom' });

    const condition = makeHost({ cards: [{ fields: [{ name: 'x' }] }] });
    condition.getField = () => {
      throw new Error('cannot read');
    };
    const chain = inHandler('if 1 is 2 then', '  put 1 into x', 'else if field "x" is 1 then', '  put 2 into x', 'end if');
    expect(runtimeErrorOf((await run(chain, condition)).result, 'else if')).toMatchObject({ line: 4, message: 'cannot read' });
  });

  it('use a thrown string as the message, and a general message for anything else', async () => {
    const thrown: [unknown, string][] = [
      ['out of ectoplasm', 'out of ectoplasm'],
      [new Error(''), 'this command failed unexpectedly'],
      [{ code: 13 }, 'this command failed unexpectedly'],
      [undefined, 'this command failed unexpectedly'],
    ];
    for (const [value, message] of thrown) {
      const host = makeHost();
      host.ask = () => Promise.reject(value);
      expect((await run(inHandler('ask "?"'), host)).result, message).toEqual({
        ok: false,
        error: { kind: 'runtime', line: 2, message },
      });
    }
  });
});

describe('R15 / 8.7 haunts', () => {
  const haunts: [string, HauntKind][] = [
    ['release bat', 'bat'],
    ['howl', 'howl'],
    ['summon witch', 'witch'],
    ['drop spider', 'spider'],
  ];

  it('call host.haunt exactly once with the kind of each haunt (R15.2)', async () => {
    for (const [line, kind] of haunts) {
      const { result, host } = await run(inHandler(line));
      expect(result, line).toEqual({ ok: true });
      expect(host.log, line).toEqual([{ call: 'haunt', kind }]);
    }
  });

  it('change no card, field, visibility, local, global or it (R15.3)', async () => {
    const init: FakeHostInit = {
      cards: [
        { name: 'Hall', fields: [{ name: 'note', text: 'quiet' }], buttons: [{ name: 'door' }] },
        {
          name: 'Crypt',
          fields: [{ name: 'note', text: 'boo' }, { name: 'clue', visible: false }],
          buttons: [{ name: 'door', visible: false }],
        },
      ],
      current: 2,
      replies: ['yes'],
    };
    const script = inHandler(
      'global g, seenX, seenG, seenIt',
      'put "boo" into g',
      'put 5 into x',
      'ask "Ready?"',
      ...haunts.map(([line]) => line),
      'put x into seenX',
      'put g into seenG',
      'put it into seenIt',
    );
    const { result, host, globals } = await run(script, makeHost(init));
    expect(result).toEqual({ ok: true });
    expect(host.state).toEqual(makeHost(init).state);
    expect([...globals]).toEqual([['g', 'boo'], ['seenx', 5], ['seeng', 'boo'], ['seenit', 'yes']]);
    expect(host.log).toEqual([
      { call: 'ask', message: 'Ready?' },
      ...haunts.map(([, kind]) => ({ call: 'haunt', kind })),
    ]);
  });

  it('hold the next statement until the host resolves the haunt (R15.2)', async () => {
    const host = makeHost({ cards: [{ fields: [{ name: 'note', text: 'quiet' }] }] });
    let release = () => {};
    host.haunt = (kind) => {
      host.log.push({ call: 'haunt', kind });
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    let finished = false;
    const running = run(inHandler('summon witch', 'put "after" into field "note"'), host).then((r) => {
      finished = true;
      return r;
    });

    await settle();
    expect(finished).toBe(false);
    expect(host.fieldText('note')).toBe('quiet');
    expect(host.log).toEqual([{ call: 'haunt', kind: 'witch' }]);

    release();
    expect((await running).result).toEqual({ ok: true });
    expect(host.fieldText('note')).toBe('after');
    expect(host.log).toEqual([
      { call: 'haunt', kind: 'witch' },
      { call: 'setField', name: 'note', text: 'after' },
    ]);
  });
});

describe('R12.3 / 2.4 a parse error found before a lexer error', () => {
  it.each(REPROS)('$name returns the parse error, calls the host for nothing and changes nothing', async ({ body, error }) => {
    const init: Partial<FakeHostInit> = {
      cards: [{ fields: [{ name: 'note', text: 'quiet' }], buttons: [{ name: 'door' }] }, { name: 'Crypt' }],
    };
    const { result, host } = await run(handlerSource('mouseUp', body), makeHost(init));
    expect(result).toEqual({ ok: false, error });
    expect(host.log).toEqual([]);
    expect(host.state).toEqual(makeHost(init).state);
  });
});

describe('R9 / 2.2 an else line right after a one-line if inside a block if', () => {
  it('Repro 1 returns the syntax error on line 4 and runs nothing: no host call, no dialog, same card', async () => {
    const init: Partial<FakeHostInit> = {
      cards: [{ fields: [{ name: 'key', text: 'iron' }, { name: 'door', text: 'open' }] }, { name: 'Hall' }],
    };
    const { result, host } = await run(ONE_LINE_IF_REPRO_1.source, makeHost(init));
    // One assertion, so a failure shows both what came back and what the host was asked to do.
    expect({ result, calls: host.log }).toEqual({ result: { ok: false, error: ONE_LINE_IF_REPRO_1.error }, calls: [] });
    expect(host.state.current).toBe(1);
    expect(host.state).toEqual(makeHost(init).state);
  });
});
