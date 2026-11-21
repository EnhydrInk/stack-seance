import { describe, it, expect } from 'vitest';
import type { Host } from '../../src/hypertalk/host';
import { HAUNTS } from '../../src/hypertalk/tokens';
import { FakeHost, type FakeHostInit } from './helpers/fakeHost';

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
