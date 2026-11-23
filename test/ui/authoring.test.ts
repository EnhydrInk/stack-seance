import { describe, expect, it } from 'vitest';
import { requestFor } from '../../src/ui/compile';
import { Model, copy, upgrade } from '../../src/ui/model';
import stacks from '../../src/ui/stacks.json';
import type { StacksDoc } from '../../src/ui/types';

const fresh = () => new Model(copy(stacks as StacksDoc));

describe('making things', () => {
  it('adds blank cards at the end of the current stack, each with a heading of its name', () => {
    const m = fresh();
    m.goToStack('haunted');
    m.addCards(['Kitchen', 'Cellar']);
    const names = m.stack.cards.map((c) => c.name);
    expect(names.slice(-2)).toEqual(['Kitchen', 'Cellar']);
    expect(m.stack.cards.at(-1)!.fields[0]!.text).toBe('Cellar');
  });

  it('grows cards and a button where the sentence was written, after the reader moved on', () => {
    const m = fresh();
    m.goToStack('haunted');
    const { stack, card } = m;
    m.goToStack('help');
    m.addCards(['Cellar'], stack);
    m.addButton({ name: 'To the cellar', rect: [0, 0, 10, 10], visible: true, sentence: '', script: '', style: 'roundrect' }, card);
    expect(stack.cards.at(-1)!.name).toBe('Cellar');
    expect(card.buttons.at(-1)!.name).toBe('To the cellar');
    expect(m.stack.cards.some((c) => c.name === 'Cellar')).toBe(false);
    expect(m.card.buttons.some((b) => b.name === 'To the cellar')).toBe(false);
  });

  it('grows a card only once when two compiles ask for the same new card', () => {
    const m = fresh();
    m.goToStack('haunted');
    const before = m.stack.cards.length;
    m.addCards(['Lantern']);
    m.addCards(['lantern', 'Lantern']);
    expect(m.stack.cards.length).toBe(before + 1);
  });

  it('gives a grown button a name no other button on its card has', () => {
    const m = fresh();
    m.goToStack('haunted');
    const taken = m.card.buttons[0]!;
    expect(m.freeButtonName('Nobody here')).toBe('Nobody here');
    expect(m.freeButtonName(taken.name.toUpperCase())).toBe(`${taken.name.toUpperCase()} 2`);
    expect(m.freeButtonName(taken.name, m.card, taken.id)).toBe(taken.name);
  });

  it('takes the stacks another tab saved and stays on the same card', () => {
    const m = fresh();
    m.goToStack('haunted');
    m.goToCard(1);
    const card = m.card.id;
    const other = fresh();
    other.addStack('North Post');
    m.adopt(copy(other.doc));
    expect(m.card.id).toBe(card);
    expect(m.doc.stacks.some((s) => s.name === 'North Post')).toBe(true);
  });

  it('gives stacks the reader made a pile of cards on Home, old saves too', () => {
    const m = fresh();
    m.addStack('Pumpkin Party');
    const home = m.doc.stacks[0]!.cards[0]!;
    expect(home.buttons.find((b) => b.name === 'Pumpkin Party')!.icon).toBe('cards');
    home.buttons.find((b) => b.name === 'Pumpkin Party')!.icon = 'sparkle';
    const up = upgrade(copy(m.doc), stacks as StacksDoc).stacks[0]!.cards[0]!.buttons;
    expect(up.find((b) => b.name === 'Pumpkin Party')!.icon).toBe('cards');
    expect(up.find((b) => b.id === 'b-home-new')!.icon).toBe('sparkle');
  });

  it('makes a new stack with one card and an icon on Home that goes to it', () => {
    const m = fresh();
    const s = m.addStack('Pumpkin Party');
    expect(s.cards).toHaveLength(1);
    const icon = m.doc.stacks[0]!.cards[0]!.buttons.find((b) => b.name === 'Pumpkin Party')!;
    expect(icon.script).toBe('on mouseUp\n  go to stack "Pumpkin Party"\nend mouseUp');
  });

  it('fills the free Home slots and then stops adding icons', () => {
    const m = fresh();
    for (const n of ['A', 'B', 'C', 'D']) m.addStack(n);
    const icons = m.doc.stacks[0]!.cards[0]!.buttons.filter((b) => ['A', 'B', 'C', 'D'].includes(b.name));
    expect(icons.map((b) => b.name)).toEqual(['A', 'B', 'C']);
    expect(new Set(icons.map((b) => b.rect.join())).size).toBe(3);
  });

  it('gives every new thing an id no other thing has', () => {
    const m = fresh();
    m.addCards(['X', 'Y']);
    m.addButton({ name: 'B', rect: [0, 0, 10, 10], visible: true, sentence: '', script: '', style: 'roundrect' });
    m.addField([0, 0, 10, 10]);
    const ids = m.doc.stacks.flatMap((s) => [s.id, ...s.cards.flatMap((c) => [c.id, ...c.fields.map((f) => f.id), ...c.buttons.map((b) => b.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('removes a button or a field of the current card', () => {
    const m = fresh();
    const f = m.addField([0, 0, 10, 10]);
    m.remove(f.id);
    expect(m.card.fields.some((x) => x.id === f.id)).toBe(false);
  });
});

describe('the compile request', () => {
  it('names the card, its fields and buttons, the stack and every stack, leaving out the button being recompiled', () => {
    const m = fresh();
    m.goToStack('haunted');
    const bell = m.card.buttons.find((b) => b.name === 'Ring the bell')!;
    const r = requestFor(m, 'go on', bell.id);
    expect(r).toMatchObject({ sentence: 'go on', stackName: 'Haunted House', cardName: 'Gate', fieldNames: ['sign'] });
    expect(r.cardNames).toEqual(['Gate', 'Hall', 'Attic', 'Garden']);
    expect(r.buttonNames).toEqual(['Enter', 'Home']);
    expect(r.stackNames).toEqual(['Home', 'Haunted House', 'Help']);
  });
});

describe('older saves', () => {
  it('turn the Home New Stack icon into the built-in button', () => {
    const old = copy(stacks as StacksDoc);
    const icon = old.stacks[0]!.cards[0]!.buttons.find((b) => b.id === 'b-home-new')!;
    delete icon.builtin;
    icon.script = 'on mouseUp\n  answer "Soon"\nend mouseUp';
    const up = upgrade(old, stacks as StacksDoc);
    const now = up.stacks[0]!.cards[0]!.buttons.find((b) => b.id === 'b-home-new')!;
    expect(now.builtin).toBe('new-stack');
    expect(now.script).toBe('');
  });
});
