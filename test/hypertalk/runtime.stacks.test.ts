// go-to-stack-command Requirement 8.4 to 8.8: go to stack. Every test runs real source through
// runHandler against the fake host, and reads the moves from the host's stacks and call log.

import { describe, it, expect } from 'vitest';
import { runHandler } from '../../src/hypertalk/runtime';
import type { Value } from '../../src/hypertalk/values';
import { FakeHost, type FakeStackInit, type FakeStacksInit, type Reply } from './helpers/fakeHost';

const src = (...lines: string[]) => lines.join('\n');
const indent = (lines: string[]) => lines.map((l) => `  ${l}`);
/** Wraps lines in `on mouseUp … end mouseUp`, so the first given line is line 2. */
const inHandler = (...lines: string[]) => src('on mouseUp', ...indent(lines), 'end mouseUp');
/** Wraps lines in `on openCard … end openCard`, so the first given line is line 2. */
const onOpen = (...lines: string[]) => src('on openCard', ...indent(lines), 'end openCard');

const HOUSE_CARDS = ['Hall', 'Crypt', 'Attic', 'Lobby'];

interface Fixture extends Omit<FakeStacksInit, 'stacks'> {
  /** Names of the Home stack's cards; defaults to one card, Home. */
  homeCards?: string[];
  /** Card scripts by card id, such as `house/card-1`. */
  scripts?: Record<string, string>;
  /** Stacks after Home and the haunted house. */
  more?: FakeStackInit[];
}

/**
 * The Home stack (`home`: card Home, with button House and field note) and the Haunted House
 * stack (`house`: cards Hall, Crypt, Attic and Lobby, each with field note and button door).
 * Card ids are the defaults: `home/card-1`, `house/card-1` … `house/card-4`.
 */
function haunted({ homeCards = ['Home'], scripts = {}, more = [], ...init }: Fixture = {}): FakeHost {
  const cards = (stackId: string, names: string[], button: string) =>
    names.map((name, i) => ({
      name,
      script: scripts[`${stackId}/card-${i + 1}`] ?? '',
      fields: [{ name: 'note' }],
      buttons: [{ name: button }],
    }));
  return new FakeHost({
    stacks: [
      { id: 'home', name: 'Home', cards: cards('home', homeCards, 'House') },
      { id: 'house', name: 'Haunted House', cards: cards('house', HOUSE_CARDS, 'door') },
      ...more,
    ],
    ...init,
  });
}

async function run(source: string, host: FakeHost, globals = new Map<string, Value>()) {
  const result = await runHandler(source, 'mouseUp', { host, globals, scriptId: 'button-1' });
  return { result, host, globals };
}

/** The current stack's id and the current card's index. */
const where = (host: FakeHost) => ({ stack: host.stack().id, card: host.state.current });

/** Every move between stacks and cards, in order. */
const moves = (host: FakeHost) => host.log.filter((c) => c.call === 'goToStack' || c.call === 'goToCard');

const opened = (host: FakeHost) => host.log.flatMap((c) => (c.call === 'getCardScript' ? [c.id] : []));

const looked = (host: FakeHost) => host.log.flatMap((c) => (c.call === 'findStackByName' ? [c.name] : []));

describe('go-to-stack-command Requirement 3 / 8.4 finding the stack by name', () => {
  it('opens the named stack at its first card, with exactly these host calls (3.3, 4.1, 4.3, 4.4)', async () => {
    const { result, host } = await run(inHandler('go to stack "Haunted House"'), haunted());
    expect(result).toEqual({ ok: true });
    expect(host.stack()).toEqual({ id: 'house', name: 'Haunted House' });
    expect(host.state.current).toBe(1);
    expect(host.log).toEqual([
      { call: 'findStackByName', name: 'Haunted House' },
      { call: 'goToStack', id: 'house' },
      { call: 'getCardScript', id: 'house/card-1' },
    ]);
  });

  it('finds the stack ignoring case, and passes the name to the host as written (3.3, 3.4)', async () => {
    const { result, host } = await run(inHandler('go stack "haunted HOUSE"'), haunted());
    expect(result).toEqual({ ok: true });
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
    expect(looked(host)).toEqual(['haunted HOUSE']);

    // Spaces are kept too: the host gets the text unchanged and decides.
    const spaced = await run(inHandler('go to stack " Haunted House"'), haunted());
    expect(looked(spaced.host)).toEqual([' Haunted House']);
    expect(spaced.result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: 'there is no stack named " Haunted House"' },
    });
  });

  it('reads a number target as a stack name, never as a stack number (3.1, 3.2)', async () => {
    for (const target of ['3', '(1 + 2)', '"3"']) {
      const host = haunted({ more: [{ id: 'three', name: '3', cards: [{ name: 'Third' }] }] });
      const { result } = await run(inHandler(`go to stack ${target}`), host);
      expect(result, target).toEqual({ ok: true });
      expect(where(host), target).toEqual({ stack: 'three', card: 1 });
      // No card number is looked up on the way.
      expect(host.log, target).toEqual([
        { call: 'findStackByName', name: '3' },
        { call: 'goToStack', id: 'three' },
        { call: 'getCardScript', id: 'three/card-1' },
      ]);
    }

    // There are two stacks, but none is named "2".
    const { result, host } = await run(inHandler('go to stack 2'), haunted());
    expect(result).toEqual({ ok: false, error: { kind: 'runtime', line: 2, message: 'there is no stack named "2"' } });
    expect(host.log).toEqual([{ call: 'findStackByName', name: '2' }]);
  });

  it('reports a missing stack or an empty name on the go line, changes nothing and stops (3.5, 3.6, 3.8)', async () => {
    const cases: [string[], Reply[], string][] = [
      [['go to stack "Cellar"'], [], 'there is no stack named "Cellar"'],
      [['ask "Which stack?"', 'go to stack it'], ['the cellar'], 'there is no stack named "the cellar"'],
      [
        ['go to stack "The very long name of a stack that is not here"'],
        [],
        'there is no stack named "The very long name of a stack that is no…"',
      ],
      [['go to stack ""'], [], 'expected a stack name, but got an empty value'],
      [['ask "Which stack?"', 'go to stack it'], [''], 'expected a stack name, but got an empty value'],
      [['ask "Which stack?"', 'go to stack it'], [null], 'expected a stack name, but got an empty value'],
    ];
    for (const [lines, replies, message] of cases) {
      const what = `${lines.join('; ')} ${JSON.stringify(replies)}`;
      // Start in the house on card 3, so "unchanged" means more than the first card of the first stack.
      const host = haunted({ currentStack: 2, current: 3, replies });
      const { result } = await run(inHandler(...lines, 'answer "after"'), host);
      expect(result, what).toEqual({ ok: false, error: { kind: 'runtime', line: lines.length + 1, message } });
      expect(where(host), what).toEqual({ stack: 'house', card: 3 });
      expect(moves(host), what).toEqual([]);
      expect(opened(host), what).toEqual([]);
      expect(host.log.some((c) => c.call === 'answer'), what).toBe(false);
      // An empty name is an error before the host is asked.
      const empty = message.startsWith('expected a stack name');
      expect(looked(host).length, what).toBe(empty ? 0 : 1);
    }
  });

  it('reports an error in the target expression on the go line, before any host call (3.7, 3.8)', async () => {
    const host = haunted();
    const { result } = await run(inHandler('visual effect dissolve', 'go to stack (1 / 0)', 'answer "after"'), host);
    expect(result).toEqual({ ok: false, error: { kind: 'runtime', line: 3, message: 'cannot divide by zero' } });
    expect(where(host)).toEqual({ stack: 'home', card: 1 });
    expect(host.log).toEqual([]);
  });

  it('turns an exception in findStackByName or goToStack into an error on the go line', async () => {
    const lookup = haunted();
    lookup.findStackByName = () => {
      throw new Error('the stack list is not loaded');
    };
    expect((await run(inHandler('howl', 'go to stack "Haunted House"'), lookup)).result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 3, message: 'the stack list is not loaded' },
    });

    const move = haunted();
    move.goToStack = () => {
      throw new Error('the stack could not be opened');
    };
    expect((await run(inHandler('go to stack "Haunted House"', 'answer "after"'), move)).result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: 'the stack could not be opened' },
    });
    expect(where(move)).toEqual({ stack: 'home', card: 1 });
    expect(move.log.some((c) => c.call === 'answer')).toBe(false);
  });
});

describe('go-to-stack-command Requirement 4.1, 4.2 / 8.5 the current stack and the visual effect', () => {
  it('opens the current stack at its first card when it is the target, and runs that card’s openCard (4.2)', async () => {
    const host = haunted({ currentStack: 2, current: 3, scripts: { 'house/card-1': onOpen('put "opened" into field "note"') } });
    const { result } = await run(inHandler('go to stack "Haunted House"'), host);
    expect(result).toEqual({ ok: true });
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
    expect(host.log).toEqual([
      { call: 'findStackByName', name: 'Haunted House' },
      { call: 'goToStack', id: 'house' },
      { call: 'getCardScript', id: 'house/card-1' },
      { call: 'setField', name: 'note', text: 'opened' },
    ]);
    expect([1, 2, 3, 4].map((i) => host.fieldText('note', i))).toEqual(['opened', '', '', '']);
  });

  it('plays the pending effect with goToStack, and not with a later go in the same handler (3.2, 4.1)', async () => {
    const host = haunted();
    const { result } = await run(inHandler('visual effect iris open', 'go to stack "Haunted House"', 'go to next card'), host);
    expect(result).toEqual({ ok: true });
    expect(moves(host)).toEqual([
      { call: 'goToStack', id: 'house', effect: 'irisOpen' },
      { call: 'goToCard', index: 2, id: 'house/card-2' },
    ]);
    expect(where(host)).toEqual({ stack: 'house', card: 2 });
  });

  it('drops the pending effect when the stack is missing, so no move ever plays it (3.7)', async () => {
    const host = haunted();
    const { result } = await run(inHandler('visual effect dissolve', 'go to stack "Cellar"'), host);
    expect(result).toEqual({ ok: false, error: { kind: 'runtime', line: 3, message: 'there is no stack named "Cellar"' } });
    expect(moves(host)).toEqual([]);

    // A later run starts without it (R3.5).
    await run(inHandler('go to stack "Haunted House"'), host);
    expect(moves(host)).toEqual([{ call: 'goToStack', id: 'house' }]);
  });
});

describe('go-to-stack-command Requirement 4.4, 4.7, 4.8, 4.9 / 8.6 the first card’s openCard', () => {
  it('runs the first card’s openCard with fresh locals and an empty it (4.4)', async () => {
    const host = haunted({ scripts: { 'house/card-1': onOpen('put "[" & x & it & "]" into field "note"') } });
    const { result } = await run(inHandler('put 5 into x', 'put "yes" into it', 'go to stack "Haunted House"'), host);
    expect(result).toEqual({ ok: true });
    expect(host.fieldText('note')).toBe('[]');
    expect(host.log.slice(-3)).toEqual([
      { call: 'goToStack', id: 'house' },
      { call: 'getCardScript', id: 'house/card-1' },
      { call: 'setField', name: 'note', text: '[]' },
    ]);
  });

  it('reports a runtime error in the first card’s openCard with that card’s id and line, keeps the move and stops (4.7, 4.9)', async () => {
    const hall = src('-- the hall', 'on openCard', '  put 1 into x', '  put x / 0 into y', 'end openCard');
    const host = haunted({ scripts: { 'house/card-1': hall } });
    const { result } = await run(inHandler('go to stack "Haunted House"', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 4, message: 'cannot divide by zero', scriptId: 'house/card-1' },
    });
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });

  it('reports a syntax error anywhere in the first card’s script the same way (4.7, 4.9, R14.3)', async () => {
    const hall = src('on openCard', '  howl', 'end openCard', 'on mouseUp', '  go to stack "Crypt" & 1', 'end mouseUp');
    const host = haunted({ scripts: { 'house/card-1': hall } });
    const { result } = await run(inHandler('go to stack "Haunted House"', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'syntax',
        line: 5,
        column: 23,
        message: 'put a calculated stack name in parentheses, for example go to stack ("Haunted" && "House")',
        scriptId: 'house/card-1',
      },
    });
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
    // Nothing of the hall's script runs, and nothing after the go.
    expect(host.log.some((c) => c.call === 'haunt' || c.call === 'answer')).toBe(false);
  });

  it('names the innermost card that failed when the first card’s openCard goes on (4.8)', async () => {
    const host = haunted({
      scripts: { 'house/card-1': onOpen('go to next card'), 'house/card-2': onOpen('hide button "ghost"') },
    });
    const { result } = await run(inHandler('go to stack "Haunted House"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: 'there is no button "ghost" on this card', scriptId: 'house/card-2' },
    });
    expect(where(host)).toEqual({ stack: 'house', card: 2 });
  });
});

describe('go-to-stack-command Requirement 4.5, 4.6 / 8.7 the openCard depth limit', () => {
  const DEPTH_MESSAGE = 'cannot go on: openCard handlers can chain at most 16 levels deep';

  it('stops a chain of stack gos at level 16 with an error on that go line, after 16 goToStack calls (4.5)', async () => {
    // Level n opens the house when n is odd and Home when n is even, so level 16 is Home.
    const host = haunted({
      scripts: {
        'home/card-1': onOpen('put 1 into x', 'go to stack "Haunted House"'),
        'house/card-1': onOpen('go to stack "Home"'),
      },
    });
    const { result } = await run(inHandler('go to stack "Haunted House"', 'answer "after"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 3, message: DEPTH_MESSAGE, scriptId: 'home/card-1' },
    });
    expect(moves(host)).toHaveLength(16);
    expect(moves(host).every((c) => c.call === 'goToStack')).toBe(true);
    // The go at level 16 still finds its stack: a missing target is reported before the depth limit.
    expect(looked(host)).toHaveLength(17);
    expect(opened(host)).toHaveLength(16);
    expect(where(host)).toEqual({ stack: 'home', card: 1 });
    expect(host.log.some((c) => c.call === 'answer')).toBe(false);
  });

  it('counts stack gos and card gos in one depth, so a mixed chain stops after 16 moves in total (4.6)', async () => {
    // Home's card goes to the house; the hall goes to the next card; the crypt goes back to Home.
    // Levels cycle hall, crypt, Home, so level 16 is the hall, and its go to the next card fails.
    const host = haunted({
      scripts: {
        'home/card-1': onOpen('go to stack "Haunted House"'),
        'house/card-1': onOpen('go to next card'),
        'house/card-2': onOpen('go to stack "Home"'),
      },
    });
    const { result } = await run(inHandler('go to stack "Haunted House"'), host);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 2, message: DEPTH_MESSAGE, scriptId: 'house/card-1' },
    });
    expect(moves(host)).toHaveLength(16);
    expect(moves(host).filter((c) => c.call === 'goToStack')).toHaveLength(11);
    expect(moves(host).filter((c) => c.call === 'goToCard')).toHaveLength(5);
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
  });
});

describe('go-to-stack-command Requirement 5.1, 5.4 / 8.7 after a stack go', () => {
  it('runs the rest of the handler on the new stack’s card, and leaves the old card alone (5.1)', async () => {
    const host = haunted();
    const { result } = await run(inHandler('go to stack "Haunted House"', 'put "here" into field "note"'), host);
    expect(result).toEqual({ ok: true });
    expect(where(host)).toEqual({ stack: 'house', card: 1 });
    expect(host.fieldText('note')).toBe('here');
    expect(host.stacks[0]!.state.cards[0]!.fields).toEqual([{ name: 'note', text: '', visible: true }]);
  });

  it('shares globals between a button on Home and the first card’s openCard of the house, but not locals (5.4)', async () => {
    const hall = onOpen('global visits', 'put visits & "2" into visits', 'put "[" & x & "]" into field "note"');
    const host = haunted({ scripts: { 'house/card-1': hall } });
    const { result, globals } = await run(
      inHandler(
        'global visits',
        'put "1" into visits',
        'put "local" into x',
        'go to stack "Haunted House"',
        'put visits after field "note"',
      ),
      host,
    );
    expect(result).toEqual({ ok: true });
    expect([...globals]).toEqual([['visits', '12']]);
    // The hall read x as '' and the handler then read the global the hall had changed.
    expect(host.fieldText('note')).toBe('[]12');
  });
});
