import { describe, it, expect } from 'vitest';
import type { Host, StackRef } from '../../src/hypertalk/host';
import { HAUNTS } from '../../src/hypertalk/tokens';
import { DEFAULT_STACK, FakeHost, type FakeHostInit, type FakeStacksInit } from './helpers/fakeHost';

const stack = (): FakeHostInit => ({
  cards: [
    {
      id: 'hall',
      name: 'Hall',
      script: 'on openCard\nend openCard\n',
      fields: [{ name: 'Score', text: '0' }],
      buttons: [{ name: 'Go' }],
    },
    { id: 'crypt', name: 'Crypt', fields: [{ name: 'score', text: '99' }, { name: 'note', visible: false }] },
    { id: 'attic' },
  ],
});

describe('R10.3 fake host', () => {
  it('implements the Host interface', () => {
    const host: Host = new FakeHost(stack());
    expect(host.cardCount()).toBe(3);
  });

  it('fills in defaults for ids, names, scripts, text and visibility', () => {
    const host = new FakeHost({ cards: [{}, { fields: [{ name: 'f' }], buttons: [{ name: 'b' }] }] });
    expect(host.state).toEqual({
      cards: [
        { id: 'card-1', name: null, script: '', fields: [], buttons: [] },
        { id: 'card-2', name: null, script: '', fields: [{ name: 'f', text: '', visible: true }], buttons: [{ name: 'b', visible: true }] },
      ],
      current: 1,
    });
  });

  it('rejects an empty stack, duplicate ids and a current card out of range', () => {
    expect(() => new FakeHost({ cards: [] })).toThrow();
    expect(() => new FakeHost({ cards: [{ id: 'a' }, { id: 'a' }] })).toThrow();
    expect(() => new FakeHost({ cards: [{}], current: 2 })).toThrow();
  });

  it('records every call, in order, with its arguments', async () => {
    const host = new FakeHost({ ...stack(), replies: ['Yes', 'Mona'] });
    host.cardCount();
    host.currentCard();
    host.findCardByName('crypt');
    const attic = host.cardAt(3);
    host.goToCard(attic!, 'dissolve');
    host.goToCard(host.cardAt(1)!);
    host.getField('score');
    host.setField('score', '1');
    host.setVisible('button', 'go', false);
    await host.answer('Ready?', ['Yes', 'No']);
    await host.ask('Name?');
    await host.wait(2);
    await host.haunt('howl');
    host.getCardScript(attic!);
    expect(host.log).toEqual([
      { call: 'cardCount' },
      { call: 'currentCard' },
      { call: 'findCardByName', name: 'crypt' },
      { call: 'cardAt', index: 3 },
      { call: 'goToCard', index: 3, id: 'attic', effect: 'dissolve' },
      { call: 'cardAt', index: 1 },
      { call: 'goToCard', index: 1, id: 'hall' },
      { call: 'getField', name: 'score' },
      { call: 'setField', name: 'score', text: '1' },
      { call: 'setVisible', kind: 'button', name: 'go', visible: false },
      { call: 'answer', message: 'Ready?', labels: ['Yes', 'No'] },
      { call: 'ask', message: 'Name?' },
      { call: 'wait', seconds: 2 },
      { call: 'haunt', kind: 'howl' },
      { call: 'getCardScript', id: 'attic' },
    ]);
    expect(host.log[6]).not.toHaveProperty('effect');
  });

  it('finds cards by name ignoring case, and by 1-based index', () => {
    const host = new FakeHost(stack());
    expect(host.findCardByName('CRYPT')).toEqual({ index: 2, id: 'crypt', name: 'Crypt' });
    expect(host.findCardByName('cellar')).toBeUndefined();
    expect(host.cardAt(3)).toEqual({ index: 3, id: 'attic', name: null });
    for (const index of [0, 4, -1, 1.5, NaN]) expect(host.cardAt(index), String(index)).toBeUndefined();
  });

  it('never matches a card without a name', () => {
    const host = new FakeHost({ cards: [{ name: null }, { name: 'null' }] });
    expect(host.findCardByName('null')?.index).toBe(2);
    expect(host.findCardByName('')).toBeUndefined();
  });

  it('resolves field and button names on the current card, ignoring case', () => {
    const host = new FakeHost(stack());
    expect(host.getField('SCORE')).toBe('0');
    expect(host.setField('score', '5')).toBe(true);
    expect(host.fieldText('Score')).toBe('5');
    expect(host.setVisible('button', 'GO', false)).toBe(true);
    expect(host.isVisible('button', 'go')).toBe(false);
  });

  it('reports missing fields and buttons without changing anything', () => {
    const host = new FakeHost(stack());
    const before = structuredClone(host.state);
    expect(host.getField('note')).toBeUndefined();
    expect(host.setField('note', 'x')).toBe(false);
    expect(host.setVisible('field', 'note', true)).toBe(false);
    expect(host.setVisible('field', 'Go', false)).toBe(false); // a button, not a field
    expect(host.state).toEqual(before);
  });

  it('treats showing a visible item as a plain success (R6.3)', () => {
    const host = new FakeHost(stack());
    expect(host.setVisible('field', 'score', true)).toBe(true);
    expect(host.isVisible('field', 'score')).toBe(true);
  });

  it('resolves names on the new card after goToCard (R2.6)', () => {
    const host = new FakeHost(stack());
    host.goToCard(host.findCardByName('crypt')!);
    expect(host.currentCard().index).toBe(2);
    expect(host.getField('score')).toBe('99');
    expect(host.setField('score', '100')).toBe(true);
    expect(host.fieldText('score', 1)).toBe('0');
    expect(host.fieldText('score', 2)).toBe('100');
  });

  it('throws on a card ref that does not match the stack', () => {
    const host = new FakeHost(stack());
    expect(() => host.goToCard({ index: 2, id: 'hall', name: 'Hall' })).toThrow();
    expect(() => host.getCardScript({ index: 9, id: 'x', name: null })).toThrow();
    expect(host.state.current).toBe(1);
  });

  it('returns card scripts as written', () => {
    const host = new FakeHost(stack());
    expect(host.getCardScript(host.cardAt(1)!)).toBe('on openCard\nend openCard\n');
    expect(host.getCardScript(host.cardAt(3)!)).toBe('');
  });
});

describe('R10.3 fake host dialogs', () => {
  it('consumes one reply queue across answer and ask, in order', async () => {
    const host = new FakeHost({ ...stack(), replies: ['No', '3', null, ''] });
    expect(await host.answer('Ready?', ['Yes', 'No'])).toBe('No');
    expect(await host.ask('Which room?')).toBe('3');
    expect(await host.ask('Name?')).toBeNull();
    expect(await host.ask('Name?')).toBe('');
    expect(host.replies).toEqual([]);
  });

  it('answers with the first label when the reply is not a label or there is none', async () => {
    const host = new FakeHost({ ...stack(), replies: ['Maybe', null] });
    expect(await host.answer('Ready?', ['Yes', 'No'])).toBe('Yes');
    expect(await host.answer('Ready?', ['Yes', 'No'])).toBe('Yes');
    expect(await host.answer('Hello', ['OK'])).toBe('OK');
  });

  it('cancels ask when there are no replies left', async () => {
    const host = new FakeHost(stack());
    expect(await host.ask('Name?')).toBeNull();
  });

  it('rejects answer without labels, which the runtime never sends', async () => {
    const host = new FakeHost(stack());
    await expect(host.answer('Hi', [])).rejects.toThrow();
  });

  it('logs a copy of the labels', async () => {
    const host = new FakeHost(stack());
    const labels = ['A', 'B'];
    await host.answer('?', labels);
    labels.push('C');
    expect(host.log).toEqual([{ call: 'answer', message: '?', labels: ['A', 'B'] }]);
  });
});

describe('R10.3 fake host clone (for P3)', () => {
  it('copies the stack, the remaining replies and the log', async () => {
    const host = new FakeHost({ ...stack(), replies: ['a', 'b'] });
    await host.ask('first?');
    host.goToCard(host.cardAt(2)!);
    const copy = host.clone();
    expect(copy).not.toBe(host);
    expect(copy.state).toEqual(host.state);
    expect(copy.replies).toEqual(['b']);
    expect(copy.log).toEqual(host.log);
  });

  it('gives a copy that changes independently of the original', async () => {
    const host = new FakeHost({ ...stack(), replies: ['a'] });
    const copy = host.clone();
    copy.setField('score', 'changed');
    copy.setVisible('button', 'go', false);
    copy.goToCard(copy.cardAt(3)!);
    expect(await copy.ask('?')).toBe('a');
    expect(host.state).toEqual(new FakeHost(stack()).state);
    expect(host.replies).toEqual(['a']);
    expect(host.log).toEqual([]);
  });

  it('gives equal logs and state when both copies get the same calls', async () => {
    const run = async (h: FakeHost) => {
      h.setField('score', String(Number(h.getField('score')) + 1));
      const reply = await h.answer('Go on?', ['Yes', 'No']);
      if (reply === 'No') h.goToCard(h.cardAt(2)!);
      await h.haunt('bat');
    };
    const host = new FakeHost({ ...stack(), replies: ['No'] });
    const copy = host.clone();
    await run(host);
    await run(copy);
    expect(copy.state).toEqual(host.state);
    expect(copy.log).toEqual(host.log);
  });
});

describe('R15.2 / R15.3 fake host haunts', () => {
  const kinds = HAUNTS.map((h) => h.kind);

  it.each(kinds)('logs exactly one haunt call for %s and changes no state', async (kind) => {
    const host = new FakeHost(stack());
    host.goToCard(host.cardAt(2)!);
    host.setVisible('field', 'note', true);
    const before = structuredClone(host.state);
    const logged = host.log.length;
    await host.haunt(kind);
    expect(host.log.slice(logged)).toEqual([{ call: 'haunt', kind }]);
    expect(host.state).toEqual(before);
  });

  it('resolves at once, without a timer', async () => {
    const host = new FakeHost(stack());
    let done = false;
    void host.haunt('spider').then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(true);
  });
});

// go-to-stack-command Requirement 7: the fake host holds stacks, and `state` is the current one's.

/** Home, the haunted house and a cellar. Most card ids and the cellar's id are the defaults. */
const stacks = (init: Partial<FakeStacksInit> = {}): FakeStacksInit => ({
  stacks: [
    { id: 'home', name: 'Home', cards: [{ name: 'Home', fields: [{ name: 'note', text: 'home' }] }] },
    {
      id: 'house',
      name: 'Haunted House',
      cards: [
        { name: 'Hall', script: 'on openCard\nend openCard\n', fields: [{ name: 'note', text: 'hall' }] },
        { id: 'crypt', name: 'Crypt', fields: [{ name: 'note', text: 'crypt' }] },
        { name: 'Attic' },
      ],
    },
    { name: 'Cellar', cards: [{}] },
  ],
  ...init,
});

const HOME: StackRef = { id: 'home', name: 'Home' };
const HOUSE: StackRef = { id: 'house', name: 'Haunted House' };
const CELLAR: StackRef = { id: 'stack-3', name: 'Cellar' };

/** A card with every default but its id. */
const plainCard = (id: string) => ({ id, name: null, script: '', fields: [], buttons: [] });

describe('go-to-stack-command 7.1, 7.3, 7.4 fake host built from stacks', () => {
  it('gives stacks the ids stack-<n> and cards the ids <stack id>/card-<n> by default', () => {
    const host = new FakeHost({ stacks: [{ name: 'A', cards: [{}, {}] }, { name: 'B', cards: [{ name: 'Hall' }] }] });
    expect(host.stacks).toEqual([
      { id: 'stack-1', name: 'A', state: { cards: [plainCard('stack-1/card-1'), plainCard('stack-1/card-2')], current: 1 } },
      { id: 'stack-2', name: 'B', state: { cards: [{ ...plainCard('stack-2/card-1'), name: 'Hall' }], current: 1 } },
    ]);
  });

  it('keeps the stack and card ids it is given, and fills in the rest', () => {
    const host = new FakeHost(stacks());
    expect(host.stacks.map((s) => [s.id, s.name, s.state.cards.map((c) => c.id)])).toEqual([
      ['home', 'Home', ['home/card-1']],
      ['house', 'Haunted House', ['house/card-1', 'crypt', 'house/card-3']],
      ['stack-3', 'Cellar', ['stack-3/card-1']],
    ]);
  });

  it('starts in the first stack on its first card unless told otherwise', () => {
    const host = new FakeHost(stacks());
    expect(host.stack()).toEqual(HOME);
    expect(host.state.current).toBe(1);

    const inHouse = new FakeHost(stacks({ currentStack: 2, current: 3 }));
    expect(inHouse.stack()).toEqual(HOUSE);
    expect(inHouse.currentCard()).toEqual({ index: 3, id: 'house/card-3', name: 'Attic' });
    // Every other stack is on card 1.
    expect(inHouse.stacks.map((s) => s.state.current)).toEqual([1, 3, 1]);
  });

  it('makes state the same object as the current stack entry’s state', () => {
    const host = new FakeHost(stacks({ currentStack: 2 }));
    expect(host.state).toBe(host.stacks[1]!.state);
    host.state.current = 2;
    expect(host.stacks[1]!.state.current).toBe(2);
  });
});

describe('go-to-stack-command 7.2 fake host built from cards', () => {
  it('holds one stack equal to DEFAULT_STACK, whose state is host.state and whose cards keep the ids card-<n>', () => {
    const host = new FakeHost(stack());
    expect(host.stacks).toHaveLength(1);
    expect(host.stacks[0]).toMatchObject(DEFAULT_STACK);
    expect(host.stack()).toEqual(DEFAULT_STACK);
    expect(host.stacks[0]!.state).toBe(host.state);
    expect(host.state.cards.map((c) => c.id)).toEqual(['hall', 'crypt', 'attic']);

    const plain = new FakeHost({ cards: [{}, {}], current: 2 });
    expect(plain.state).toEqual({ cards: [plainCard('card-1'), plainCard('card-2')], current: 2 });
  });
});

describe('go-to-stack-command 7.5 fake host constructor errors', () => {
  const two = (init: Partial<FakeStacksInit>): FakeStacksInit => ({
    stacks: [{ name: 'A', cards: [{}, {}, {}] }, { name: 'B', cards: [{}] }],
    ...init,
  });
  const cases: [string, FakeStacksInit][] = [
    ['no stacks', { stacks: [] }],
    ['a stack with no cards', { stacks: [{ name: 'A', cards: [{}] }, { name: 'B', cards: [] }] }],
    ['two stacks with one id', { stacks: [{ id: 's', name: 'A', cards: [{}] }, { id: 's', name: 'B', cards: [{}] }] }],
    ['a given stack id equal to a default one', { stacks: [{ name: 'A', cards: [{}] }, { id: 'stack-1', name: 'B', cards: [{}] }] }],
    ['two stack names equal ignoring case', { stacks: [{ name: 'Attic', cards: [{}] }, { name: 'ATTIC', cards: [{}] }] }],
    ['a card id used in two stacks', { stacks: [{ name: 'A', cards: [{ id: 'c' }] }, { name: 'B', cards: [{ id: 'c' }] }] }],
    ['a card id used twice in one stack', { stacks: [{ name: 'A', cards: [{ id: 'c' }, { id: 'c' }] }] }],
    ['a given card id equal to a default one', { stacks: [{ name: 'A', cards: [{}] }, { name: 'B', cards: [{ id: 'stack-1/card-1' }] }] }],
    ['currentStack 0', two({ currentStack: 0 })],
    ['currentStack 3 for two stacks', two({ currentStack: 3 })],
    ['currentStack 1.5', two({ currentStack: 1.5 })],
    ['current beyond the starting stack’s cards', two({ currentStack: 2, current: 2 })],
    ['current 0', two({ current: 0 })],
  ];

  it.each(cases)('throws for %s', (_, init) => {
    expect(() => new FakeHost(init)).toThrow();
  });

  it('accepts the same stacks with a starting stack and card in range', () => {
    expect(new FakeHost(two({ currentStack: 2, current: 1 })).stack()).toEqual({ id: 'stack-2', name: 'B' });
    expect(new FakeHost(two({ currentStack: 1, current: 3 })).state.current).toBe(3);
  });
});

describe('go-to-stack-command 7.7 fake host findStackByName', () => {
  it('finds a stack ignoring case, returns its name as stored, and logs every call', () => {
    const host = new FakeHost(stacks());
    expect(host.findStackByName('haunted HOUSE')).toEqual(HOUSE);
    expect(host.findStackByName('CELLAR')).toEqual(CELLAR);
    expect(host.findStackByName('Haunted')).toBeUndefined();
    expect(host.findStackByName('')).toBeUndefined();
    expect(host.log).toEqual([
      { call: 'findStackByName', name: 'haunted HOUSE' },
      { call: 'findStackByName', name: 'CELLAR' },
      { call: 'findStackByName', name: 'Haunted' },
      { call: 'findStackByName', name: '' },
    ]);
    // A lookup changes nothing.
    expect(host.stack()).toEqual(HOME);
  });
});

describe('go-to-stack-command 7.8, 7.9 fake host goToStack', () => {
  it('opens the stack at its first card, returns that card, and logs the id and the effect', () => {
    const host = new FakeHost(stacks());
    expect(host.goToStack(HOUSE, 'irisOpen')).toEqual({ index: 1, id: 'house/card-1', name: 'Hall' });
    expect(host.stack()).toEqual(HOUSE);
    expect(host.currentCard()).toEqual({ index: 1, id: 'house/card-1', name: 'Hall' });
    expect(host.goToStack(CELLAR)).toEqual({ index: 1, id: 'stack-3/card-1', name: null });
    expect(host.log).toEqual([
      { call: 'goToStack', id: 'house', effect: 'irisOpen' },
      { call: 'currentCard' },
      { call: 'goToStack', id: 'stack-3' },
    ]);
    expect(host.log[2]).not.toHaveProperty('effect');
  });

  it('resets the stack it leaves to card 1, so a later goToStack opens it at card 1', () => {
    const host = new FakeHost(stacks({ currentStack: 2, current: 3 }));
    host.goToStack(HOME);
    expect(host.stacks.map((s) => s.state.current)).toEqual([1, 1, 1]);
    expect(host.goToStack(HOUSE)).toEqual({ index: 1, id: 'house/card-1', name: 'Hall' });
  });

  it('opens the current stack at its first card when it is the target', () => {
    const host = new FakeHost(stacks({ currentStack: 2, current: 3 }));
    expect(host.goToStack(HOUSE)).toEqual({ index: 1, id: 'house/card-1', name: 'Hall' });
    expect(host.stack()).toEqual(HOUSE);
    expect(host.state.current).toBe(1);
  });

  const badRefs: [string, StackRef][] = [
    ['an unknown id', { id: 'attic', name: 'Attic' }],
    ['a known id with another stack’s name', { id: 'house', name: 'Home' }],
    ['a known id with its name in other case', { id: 'house', name: 'haunted house' }],
  ];

  it.each(badRefs)('throws for %s and changes nothing, with the call still logged', (_, ref) => {
    const host = new FakeHost(stacks({ currentStack: 2, current: 2 }));
    const before = structuredClone(host.stacks);
    expect(() => host.goToStack(ref, 'dissolve')).toThrow();
    expect(host.stack()).toEqual(HOUSE);
    expect(host.state.current).toBe(2);
    expect(host.stacks).toEqual(before);
    expect(host.log).toEqual([{ call: 'goToStack', id: ref.id, effect: 'dissolve' }]);
  });
});

describe('go-to-stack-command 7.6, 7.10 fake host card calls after goToStack', () => {
  it('answers every card, field and button call from the new current stack', () => {
    const host = new FakeHost(stacks());
    host.goToStack(HOUSE);
    expect(host.cardCount()).toBe(3);
    expect(host.currentCard()).toEqual({ index: 1, id: 'house/card-1', name: 'Hall' });
    expect(host.findCardByName('CRYPT')).toEqual({ index: 2, id: 'crypt', name: 'Crypt' });
    expect(host.findCardByName('home')).toBeUndefined();
    expect(host.cardAt(3)).toEqual({ index: 3, id: 'house/card-3', name: 'Attic' });
    expect(host.cardAt(4)).toBeUndefined();
    expect(host.getCardScript(host.cardAt(1)!)).toBe('on openCard\nend openCard\n');
    expect(host.getField('NOTE')).toBe('hall');
    expect(host.setField('note', 'boo')).toBe(true);
    expect(host.fieldText('note')).toBe('boo');
    expect(host.stacks[0]!.state.cards[0]!.fields[0]!.text).toBe('home');
    host.goToCard(host.cardAt(2)!);
    expect(host.getField('note')).toBe('crypt');
    expect(host.setVisible('field', 'note', false)).toBe(true);
    expect(host.isVisible('field', 'note')).toBe(false);
    expect(host.isVisible('field', 'note', 1)).toBe(true);
  });

  it('throws on a card ref kept from the stack it left, and stays where it is', () => {
    const host = new FakeHost(stacks());
    const homeCard = host.currentCard();
    host.goToStack(HOUSE);
    expect(() => host.goToCard(homeCard)).toThrow();
    expect(() => host.getCardScript(homeCard)).toThrow();
    expect(host.stack()).toEqual(HOUSE);
    expect(host.state.current).toBe(1);
  });
});

describe('go-to-stack-command 7.12 fake host stack()', () => {
  it('reads the current stack without logging a call', () => {
    const host = new FakeHost(stacks({ currentStack: 3 }));
    expect(host.stack()).toEqual(CELLAR);
    host.goToStack(HOME);
    expect(host.stack()).toEqual(HOME);
    expect(host.log).toEqual([{ call: 'goToStack', id: 'home' }]);
  });
});

describe('go-to-stack-command 7.11 fake host clone with several stacks', () => {
  it('copies every stack, the current stack and card, the remaining replies and the log after a goToStack', async () => {
    const host = new FakeHost({ ...stacks(), replies: ['a', 'b'] });
    await host.ask('first?');
    host.goToStack(HOUSE, 'dissolve');
    host.goToCard(host.cardAt(2)!);
    host.setField('note', 'changed');
    const copy = host.clone();
    expect(copy).not.toBe(host);
    expect(copy.stacks).toEqual(host.stacks);
    expect(copy.stack()).toEqual(HOUSE);
    expect(copy.state).toEqual(host.state);
    expect(copy.state.current).toBe(2);
    expect(copy.replies).toEqual(['b']);
    expect(copy.log).toEqual(host.log);
  });

  it('gives a copy that changes independently of the original', async () => {
    const host = new FakeHost({ ...stacks(), replies: ['a'] });
    host.goToStack(HOUSE);
    const stacksBefore = structuredClone(host.stacks);
    const logBefore = structuredClone(host.log);
    const copy = host.clone();
    copy.goToCard(copy.cardAt(2)!);
    copy.setField('note', 'changed');
    copy.goToStack(HOME);
    copy.setField('note', 'also changed');
    expect(await copy.ask('?')).toBe('a');
    expect(host.stacks).toEqual(stacksBefore);
    expect(host.stack()).toEqual(HOUSE);
    expect(host.state.current).toBe(1);
    expect(host.replies).toEqual(['a']);
    expect(host.log).toEqual(logBefore);
  });
});
