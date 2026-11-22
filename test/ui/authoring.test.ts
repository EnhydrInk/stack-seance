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
