// Task 9: go, visual effects and openCard. Every test runs real source through runHandler
// against the fake host, and reads the moves from the host's state and call log.

import { describe, it, expect } from 'vitest';
import type { Effect } from '../../src/hypertalk/ast';
import type { RunResult } from '../../src/hypertalk/host';
import { runHandler } from '../../src/hypertalk/runtime';
import { HAUNTS } from '../../src/hypertalk/tokens';
import type { Value } from '../../src/hypertalk/values';
import { FakeHost, type FakeCardInit, type FakeHostInit, type Reply } from './helpers/fakeHost';
import { handlerSource, REPRO_1 } from './helpers/lexMask';

const src = (...lines: string[]) => lines.join('\n');
const indent = (lines: string[]) => lines.map((l) => `  ${l}`);
/** Wraps lines in `on mouseUp … end mouseUp`, so the first given line is line 2. */
const inHandler = (...lines: string[]) => src('on mouseUp', ...indent(lines), 'end mouseUp');
/** Wraps lines in `on openCard … end openCard`, so the first given line is line 2. */
const onOpen = (...lines: string[]) => src('on openCard', ...indent(lines), 'end openCard');

const NAMES = ['Hall', 'Crypt', 'Attic', 'Bell Tower'];

/** Cards named from NAMES, then Card 5, Card 6, …; `extra` adds to or overrides each card. */
function stack(count: number, init: Partial<FakeHostInit> = {}, extra: (i: number) => FakeCardInit = () => ({})) {
  const cards = Array.from({ length: count }, (_, i) => ({ name: NAMES[i] ?? `Card ${i + 1}`, ...extra(i + 1) }));
  return new FakeHost({ cards, ...init });
}

async function run(source: string, host: FakeHost, globals = new Map<string, Value>()) {
  const result = await runHandler(source, 'mouseUp', { host, globals, scriptId: 'button-1' });
  return { result, host, globals };
}

/** The index and effect of every move, in order. */
const moves = (host: FakeHost) =>
  host.log.flatMap((c) => (c.call === 'goToCard' ? [c.effect ? { to: c.index, effect: c.effect } : { to: c.index }] : []));

const opened = (host: FakeHost) => host.log.flatMap((c) => (c.call === 'getCardScript' ? [c.id] : []));

function errorOf(result: RunResult, what: string) {
  if (result.ok) throw new Error(`expected an error for ${what}`);
  return result.error;
}

describe('R2.1, R2.2 / 9.1 go next, prev, first and last', () => {
  it('moves from the current card, or to the first or last card (R2.1)', async () => {
    const cases: [string, number][] = [
      ['go to next card', 3],
      ['go prev card', 1],
      ['go to first card', 1],
      ['go last card', 4],
    ];
    for (const [stmt, to] of cases) {
      const { result, host } = await run(inHandler(stmt), stack(4, { current: 2 }));
      expect(result, stmt).toEqual({ ok: true });
      expect(host.state.current, stmt).toBe(to);
      expect(moves(host), stmt).toEqual([{ to }]);
    }
  });

  it('wraps from the last card to the first with next, and from the first to the last with prev (R2.2)', async () => {
    const next = await run(inHandler('go to next card'), stack(3, { current: 3 }));
    expect(next.host.state.current).toBe(1);
    const prev = await run(inHandler('go to prev card'), stack(3, { current: 1 }));
    expect(prev.host.state.current).toBe(3);

    // With one card, both wrap onto the same card, and it is opened again (R2.5).
    for (const stmt of ['go to next card', 'go to prev card']) {
      const { result, host } = await run(inHandler(stmt), stack(1));
      expect(result, stmt).toEqual({ ok: true });
      expect(moves(host), stmt).toEqual([{ to: 1 }]);
      expect(opened(host), stmt).toEqual(['card-1']);
    }
  });

  it('starts each go from where the last one left off', async () => {
    const { result, host } = await run(
      inHandler('go to next card', 'go to next card', 'go to next card', 'go to prev card'),
      stack(3),
    );
    expect(result).toEqual({ ok: true });
    expect(moves(host)).toEqual([{ to: 2 }, { to: 3 }, { to: 1 }, { to: 3 }]);
  });
});

describe('R2.3, R2.4 / 9.2 go to card', () => {
  it('reads a number, or a string that looks like one, as a card number (R2.3)', async () => {
    const cases: [string[], number][] = [
      [['go to card 3'], 3],
      [['go card "3"'], 3],
      [['go to card " 2 "'], 2],
      [['go to card "004"'], 4],
      [['go to card "3.0"'], 3],
      [['go to card (1 + 2)'], 3],
      [['put 2 into n', 'go to card n'], 2],
      [['go to card field "dest"'], 4],
    ];
    for (const [lines, to] of cases) {
      const host = stack(4, {}, () => ({ fields: [{ name: 'dest', text: '4' }] }));
      const { result } = await run(inHandler(...lines), host);
      expect(result, lines.join('; ')).toEqual({ ok: true });
      expect(host.state.current, lines.join('; ')).toBe(to);
    }
  });

  it('goes to card 3 when ask replies 3 and the script says go to card it (R2.3)', async () => {
    const { result, host } = await run(inHandler('ask "Which room?"', 'go to card it'), stack(4, { replies: ['3'] }));
    expect(result).toEqual({ ok: true });
    expect(host.state.current).toBe(3);
    expect(host.log).toEqual([
      { call: 'ask', message: 'Which room?' },
      { call: 'cardCount' },
      { call: 'cardAt', index: 3 },
      { call: 'goToCard', index: 3, id: 'card-3' },
      { call: 'getCardScript', id: 'card-3' },
    ]);
  });

  it('reads any other string as a card name, ignoring case (R2.3, R1.8)', async () => {
    const cases: [string[], Reply[], number][] = [
      [['go to card "crypt"'], [], 2],
      [['go to card "ATTIC"'], [], 3],
      [['go to card ("bell" && "TOWER")'], [], 4],
      [['ask "Where?"', 'go to card it'], ['hall'], 1],
    ];
    for (const [lines, replies, to] of cases) {
      const { result, host } = await run(inHandler(...lines), stack(4, { current: 2, replies }));
      expect(result, lines.join('; ')).toEqual({ ok: true });
      expect(host.state.current, lines.join('; ')).toBe(to);
    }
  });

  it('takes a string that looks like a number as a number, even when a card has that name (R2.3)', async () => {
    const host = new FakeHost({ cards: [{ name: '2' }, { name: 'Two' }, { name: 'Three' }], current: 3 });
    expect((await run(inHandler('go to card "2"'), host)).result).toEqual({ ok: true });
    expect(host.state.current).toBe(2);
  });

  it('reports a target that is not a card on the go line, leaves the card where it was and stops (R2.4)', async () => {
    const cases: [string[], Reply[], string][] = [
      [['ask "Which room?"', 'go to card it'], ['2.5'], 'expected a whole card number, but got "2.5"'],
      [['go to card 2.5'], [], 'expected a whole card number, but got 2.5'],
      [['go to card "Cellar"'], [], 'there is no card named "Cellar"'],
      [['ask "Which room?"', 'go to card it'], ['the cellar'], 'there is no card named "the cellar"'],
      [['go to card 0'], [], 'there is no card 0: the stack has 4 cards'],
      [['go to card 5'], [], 'there is no card 5: the stack has 4 cards'],
      [['go to card (0 - 1)'], [], 'there is no card -1: the stack has 4 cards'],
      [['go to card " -2 "'], [], 'there is no card -2: the stack has 4 cards'],
      [['ask "Which room?"', 'go to card it'], [null], 'expected a card number or name, but got an empty value'],
    ];
    for (const [lines, replies, message] of cases) {
      const what = `${lines.join('; ')} ${JSON.stringify(replies)}`;
      const host = stack(4, { current: 2, replies });
      const { result } = await run(inHandler(...lines, 'answer "after"'), host);
      expect(result, what).toEqual({ ok: false, error: { kind: 'runtime', line: lines.length + 1, message } });
      expect(host.state.current, what).toBe(2);
      expect(moves(host), what).toEqual([]);
      expect(opened(host), what).toEqual([]);
      expect(host.log.some((c) => c.call === 'answer'), what).toBe(false);
    }
  });

  it('counts the cards in the message for a one-card stack (R2.4)', async () => {
    expect(errorOf((await run(inHandler('go to card 2'), stack(1))).result, 'card 2')).toMatchObject({
      line: 2,
      message: 'there is no card 2: the stack has 1 card',
    });
  });
});

describe('R2.6 / 9.2a after a go', () => {
  it('resolves field, show and hide names on the new card for the rest of the handler', async () => {
    const host = stack(2, {}, (i) => ({
      fields: [{ name: 'note', text: `note ${i}` }],
      buttons: [{ name: 'door' }],
    }));
    const { result, globals } = await run(
      inHandler(
        'global seen',
        'put field "note" into was',
        'go to next card',
        'put was && "/" && field "note" into seen',
        'put "boo" into field "note"',
        'hide button "door"',
        'hide field "note"',
      ),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(globals.get('seen')).toBe('note 1 / note 2');
    expect([host.fieldText('note', 1), host.fieldText('note', 2)]).toEqual(['note 1', 'boo']);
    expect([host.isVisible('button', 'door', 1), host.isVisible('button', 'door', 2)]).toEqual([true, false]);
    expect([host.isVisible('field', 'note', 1), host.isVisible('field', 'note', 2)]).toEqual([true, false]);
  });

  it('carries on from the card that the new card’s openCard moved on to', async () => {
    const host = stack(3, {}, (i) => ({
      fields: [{ name: 'note' }],
      script: i === 2 ? onOpen('go to next card') : '',
    }));
    const { result } = await run(inHandler('go to next card', 'put "here" into field "note"'), host);
    expect(result).toEqual({ ok: true });
    expect(host.state.current).toBe(3);
    expect(moves(host)).toEqual([{ to: 2 }, { to: 3 }]);
    expect([1, 2, 3].map((i) => host.fieldText('note', i))).toEqual(['', '', 'here']);
  });
});

describe('R3 / 9.3 visual effects', () => {
  it('plays the effect with the next go only (R3.2)', async () => {
    const { result, host } = await run(
      inHandler('visual effect dissolve', 'go to next card', 'go to next card'),
      stack(3),
    );
    expect(result).toEqual({ ok: true });
    expect(moves(host)).toEqual([{ to: 2, effect: 'dissolve' }, { to: 3 }]);
  });

  it('passes each effect to the host (R3.1, R3.2)', async () => {
    const cases: [string, Effect][] = [
      ['dissolve', 'dissolve'],
      ['wipe left', 'wipeLeft'],
      ['wipe right', 'wipeRight'],
      ['iris open', 'irisOpen'],
      ['iris close', 'irisClose'],
    ];
    for (const [words, effect] of cases) {
      const { host } = await run(inHandler(`visual effect ${words}`, 'go to last card'), stack(2));
      expect(moves(host), words).toEqual([{ to: 2, effect }]);
    }
  });

  it('uses the second effect when two come before a go (R3.4)', async () => {
    const { host } = await run(inHandler('visual effect wipe left', 'visual effect iris close', 'go to next card'), stack(2));
    expect(moves(host)).toEqual([{ to: 2, effect: 'irisClose' }]);
  });

  it('does not play the effect when the go fails, and a later run starts without it (R3.3, R3.5)', async () => {
    const host = stack(3);
    const failed = await run(inHandler('visual effect dissolve', 'go to card 9'), host);
    expect(errorOf(failed.result, 'go to card 9')).toMatchObject({ line: 3 });
    expect(moves(host)).toEqual([]);

    await run(inHandler('go to next card'), host);
    expect(moves(host)).toEqual([{ to: 2 }]);
  });

  it('forgets an effect that no go used when the run ends (R3.5)', async () => {
    const host = stack(2);
    expect((await run(inHandler('visual effect iris open'), host)).result).toEqual({ ok: true });
    await run(inHandler('go to next card'), host);
    expect(moves(host)).toEqual([{ to: 2 }]);
  });

  it('keeps the effect of a handler and the effect of the openCard it starts apart (R3.2, R3.5)', async () => {
    // The effect goes with the go it comes before, not with a go in the next card's openCard.
    const outer = stack(3, {}, (i) => ({ script: i === 2 ? onOpen('go to next card') : '' }));
    await run(inHandler('visual effect dissolve', 'go to next card'), outer);
    expect(moves(outer)).toEqual([{ to: 2, effect: 'dissolve' }, { to: 3 }]);

    // An effect left over in an openCard does not reach the next go of the handler that started it.
    const inner = stack(3, {}, (i) => ({ script: i === 2 ? onOpen('visual effect wipe right') : '' }));
    await run(inHandler('go to next card', 'go to next card'), inner);
    expect(moves(inner)).toEqual([{ to: 2 }, { to: 3 }]);
  });

  it('still plays the effect when a haunt comes between it and the go (9.3a, R15.3)', async () => {
    for (const { words, kind } of HAUNTS) {
      const line = words.join(' ');
      const { result, host } = await run(inHandler('visual effect dissolve', line, 'go to next card'), stack(2));
      expect(result, line).toEqual({ ok: true });
      expect(host.log.filter((c) => c.call === 'haunt' || c.call === 'goToCard'), line).toEqual([
        { call: 'haunt', kind },
        { call: 'goToCard', index: 2, id: 'card-2', effect: 'dissolve' },
      ]);
    }
  });
});

describe('R2.5, R14 / 9.4 openCard', () => {
  it('runs the new card’s openCard after the move, with fresh locals and the same globals (R2.5, R14.2)', async () => {
    const card2 = onOpen('global visits', 'put visits & "*" into visits', 'put x & it into field "seen"');
    const host = stack(2, {}, (i) => (i === 2 ? { script: card2, fields: [{ name: 'seen', text: 'old' }] } : {}));
    const { result, globals } = await run(
      inHandler('global visits', 'put "!" into visits', 'put 5 into x', 'put "yes" into it', 'go to next card'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(globals.get('visits')).toBe('!*');
    // x and it were locals of the mouseUp run, so the openCard run does not see them.
    expect(host.fieldText('seen', 2)).toBe('');
    expect(host.log.filter((c) => ['goToCard', 'getCardScript', 'setField'].includes(c.call))).toEqual([
      { call: 'goToCard', index: 2, id: 'card-2' },
      { call: 'getCardScript', id: 'card-2' },
      { call: 'setField', name: 'seen', text: '' },
    ]);
  });

  it('runs openCard when the go stays on the current card (R2.5)', async () => {
    const host = stack(2, {}, (i) => ({ script: i === 1 ? onOpen('global opened', 'put opened & "1" into opened') : '' }));
    const { result, globals } = await run(
      inHandler('go to card 1', 'go to first card', 'go to card "hall"', 'go to prev card', 'go to next card'),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect(moves(host)).toEqual([{ to: 1 }, { to: 1 }, { to: 1 }, { to: 2 }, { to: 1 }]);
    expect(globals.get('opened')).toBe('1111');
  });

  it('does nothing more when the new card has no script or no openCard handler (R1.7)', async () => {
    const host = stack(3, {}, (i) => ({ script: i === 3 ? inHandler('answer "clicked"') : '' }));
    const { result } = await run(inHandler('go to next card', 'go to next card'), host);
    expect(result).toEqual({ ok: true });
    expect(opened(host)).toEqual(['card-2', 'card-3']);
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });

  it('reports a runtime error in the openCard with that card’s script id and line, keeps the move and stops (R12.3, R12.5)', async () => {
    const card2 = src('-- the crypt', 'on openCard', '  put 1 into x', '  put x / 0 into y', 'end openCard');
    const host = stack(3, {}, (i) => ({ script: i === 2 ? card2 : '' }));
    const { result } = await run(inHandler('go to next card', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 4, message: 'cannot divide by zero', scriptId: 'card-2' },
    });
    expect(host.state.current).toBe(2);
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });

  it('reports a syntax error anywhere in the new card’s script the same way (R14.3)', async () => {
    const card2 = src('on mouseUp', '  go nowhere', 'end mouseUp', 'on openCard', '  howl', 'end openCard');
    const host = stack(2, {}, (i) => ({ script: i === 2 ? card2 : '' }));
    const { result } = await run(inHandler('go to next card', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'syntax',
        line: 2,
        column: 6,
        message: 'expected next card, prev card, first card, last card or card … after "go"',
        scriptId: 'card-2',
      },
    });
    expect(host.state.current).toBe(2);
    expect(host.log.some((c) => c.call === 'haunt' || c.call === 'answer')).toBe(false);
  });

  // Expected to fail until the fix (task 3.2 removes .fails).
  it.fails('reports a parse error found before a lexer error in the new card’s openCard, with that card’s id (2.4, R12.5)', async () => {
    const host = stack(2, {}, (i) => ({ script: i === 2 ? handlerSource('openCard', REPRO_1.body) : '' }));
    const { result } = await run(inHandler('go to next card', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'syntax', line: 2, column: 13, message: 'expected a variable name after "into"', scriptId: 'card-2' },
    });
    // The move is kept, and nothing of card 2's script runs.
    expect(host.state.current).toBe(2);
    expect(host.log.at(-1)).toEqual({ call: 'getCardScript', id: 'card-2' });
    expect(host.log.filter((c) => c.call === 'getCardScript')).toHaveLength(1);
  });

  it('reports the first lexer error in the new card’s openCard, not a missing end, with that card’s id (3.4, R12.5)', async () => {
    const card2 = src('on mouseUp', '  go to next card', 'end mouseUp', 'on openCard', '  answer "x', 'end openCard');
    const host = stack(2, {}, (i) => ({ script: i === 2 ? card2 : '' }));
    const { result } = await run(inHandler('go to next card', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'syntax',
        line: 5,
        column: 10,
        message: 'this string has no closing quote (") on this line',
        scriptId: 'card-2',
      },
    });
    // The move is kept, and nothing of card 2's script runs.
    expect(host.state.current).toBe(2);
    expect(host.log.at(-1)).toEqual({ call: 'getCardScript', id: 'card-2' });
    expect(host.log.filter((c) => c.call === 'getCardScript')).toHaveLength(1);
  });

  it('names the card whose openCard failed when openCard handlers chain (R12.5)', async () => {
    const scripts: Record<number, string> = { 2: onOpen('go to next card'), 3: onOpen('hide button "ghost"') };
    const host = stack(3, {}, (i) => ({ script: scripts[i] ?? '' }));
    const { result } = await run(inHandler('go to next card'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: 'there is no button "ghost" on this card', scriptId: 'card-3' },
    });
    expect(host.state.current).toBe(3);
  });

  it('turns an exception in the openCard into an error on its line, with its script id (R12.1, R12.5)', async () => {
    const host = stack(2, {}, (i) => ({ script: i === 2 ? onOpen('put 1 into x', 'answer "boo"') : '' }));
    host.answer = () => Promise.reject(new Error('the dialog was closed'));
    const { result } = await run(inHandler('go to next card'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 3, message: 'the dialog was closed', scriptId: 'card-2' },
    });
  });
});

describe('R14.4 / 9.4 openCard depth limit', () => {
  it('lets openCard handlers chain 16 levels deep', async () => {
    // Card 1's mouseUp opens card 2 (level 1); cards 2 to 16 each go on, so card 17 opens at level 16.
    const host = stack(17, {}, (i) => ({
      script: i === 17 ? onOpen('global reached', 'put "yes" into reached') : i > 1 ? onOpen('go to next card') : '',
    }));
    const { result, globals } = await run(inHandler('go to next card'), host);
    expect(result).toEqual({ ok: true });
    expect(host.state.current).toBe(17);
    expect(moves(host)).toHaveLength(16);
    expect(globals.get('reached')).toBe('yes');
  });

  it('stops the go that would open a 17th level with an error on its line, without moving', async () => {
    // Three cards that each go to the next one when opened: a loop. Level n opens card n % 3 + 1,
    // so level 16 is card 2, and its go is the one that fails.
    const loop = onOpen('put 1 into x', 'go to next card');
    const host = stack(3, {}, () => ({ script: loop }));
    const { result } = await run(inHandler('go to next card', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'runtime',
        line: 3,
        message: 'cannot go on: openCard handlers can chain at most 16 levels deep',
        scriptId: 'card-2',
      },
    });
    expect(moves(host)).toHaveLength(16);
    expect(opened(host)).toHaveLength(16);
    expect(host.state.current).toBe(2);
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });
});
