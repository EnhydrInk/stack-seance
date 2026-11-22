// What the app shows: every stack, and where the reader is. The host and the views read
// and change it; every change tells the listeners (the views redraw, autosave writes).

import type { CardRef, StackRef } from '../hypertalk/index';
import type { ButtonDoc, CardDoc, FieldDoc, Rect, StackDoc, StacksDoc } from './types';

/** Where icons for new stacks go on the Home card: the second row. */
const HOME_SLOTS: [number, number][] = [
  [114, 212],
  [210, 212],
  [306, 212],
];

export type Change = 'content' | 'place';

/** Who owns a script: a card, or a button on a card. */
export type ScriptOwner =
  | { kind: 'card'; stack: StackDoc; card: CardDoc }
  | { kind: 'button'; stack: StackDoc; card: CardDoc; button: ButtonDoc };

export class Model {
  /** Index of the current stack in doc.stacks, and of the current card in it. */
  stackIndex = 0;
  cardIndex = 0;
  private listeners: ((change: Change) => void)[] = [];

  constructor(public doc: StacksDoc) {}

  onChange(listener: (change: Change) => void): void {
    this.listeners.push(listener);
  }

  changed(change: Change): void {
    for (const l of this.listeners) l(change);
  }

  get stack(): StackDoc {
    return this.doc.stacks[this.stackIndex]!;
  }

  get card(): CardDoc {
    return this.stack.cards[this.cardIndex]!;
  }

  cardRef(index: number): CardRef {
    const card = this.stack.cards[index]!;
    return { index: index + 1, id: card.id, name: card.name || null };
  }

  findCard(name: string): number {
    const lower = name.toLowerCase();
    return this.stack.cards.findIndex((c) => c.name.toLowerCase() === lower);
  }

  findStack(name: string): StackRef | undefined {
    const lower = name.toLowerCase();
    const s = this.doc.stacks.find((st) => st.name.toLowerCase() === lower);
    return s && { id: s.id, name: s.name };
  }

  /** Moves to a card of the current stack, by 0-based index. */
  goToCard(index: number): void {
    this.cardIndex = index;
    this.changed('place');
  }

  /** Makes a stack current at its first card. */
  goToStack(id: string): void {
    this.stackIndex = this.doc.stacks.findIndex((s) => s.id === id);
    this.cardIndex = 0;
    this.changed('place');
  }

  field(name: string): FieldDoc | undefined {
    const lower = name.toLowerCase();
    return this.card.fields.find((f) => f.name.toLowerCase() === lower);
  }

  button(name: string): ButtonDoc | undefined {
    const lower = name.toLowerCase();
    return this.card.buttons.find((b) => b.name.toLowerCase() === lower);
  }

  /** The card with this id, in any stack. */
  cardById(id: string): { stack: StackDoc; card: CardDoc } | undefined {
    for (const stack of this.doc.stacks) {
      const card = stack.cards.find((c) => c.id === id);
      if (card) return { stack, card };
    }
    return undefined;
  }

  /** The card or button whose script has this id. */
  owner(scriptId: string): ScriptOwner | undefined {
    for (const stack of this.doc.stacks) {
      for (const card of stack.cards) {
        if (card.id === scriptId) return { kind: 'card', stack, card };
        const button = card.buttons.find((b) => b.id === scriptId);
        if (button) return { kind: 'button', stack, card, button };
      }
    }
    return undefined;
  }

  /** Shows the card that owns a script (for the error notice and the back). */
  goToOwner(owner: ScriptOwner): void {
    this.stackIndex = this.doc.stacks.indexOf(owner.stack);
    this.cardIndex = owner.stack.cards.indexOf(owner.card);
    this.changed('place');
  }

  // ---- making things (the compiler, the + tool, New Stack)

  /** A new id, unique across every stack, card, field and button. */
  newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** A blank card whose only content is a heading with its name. */
  blankCard(name: string): CardDoc {
    return {
      id: this.newId('card'),
      name,
      script: '',
      fields: [{ id: this.newId('field'), name: 'heading', text: name, rect: [24, 18, 410, 30], visible: true, style: 'heading' }],
      buttons: [],
    };
  }

  /** Adds blank cards to the end of the current stack. */
  addCards(names: string[]): void {
    for (const name of names) this.stack.cards.push(this.blankCard(name));
    if (names.length) this.changed('content');
  }

  addButton(button: Omit<ButtonDoc, 'id'>): ButtonDoc {
    const b: ButtonDoc = { id: this.newId('button'), ...button };
    this.card.buttons.push(b);
    this.changed('content');
    return b;
  }

  addField(rect: Rect): FieldDoc {
    const taken = new Set(this.card.fields.map((f) => f.name.toLowerCase()));
    let n = 1;
    while (taken.has(`text ${n}`)) n++;
    const f: FieldDoc = { id: this.newId('field'), name: `text ${n}`, text: '', rect, visible: true, style: 'plain' };
    this.card.fields.push(f);
    this.changed('content');
    return f;
  }

  /** Removes a button or field of the current card. */
  remove(id: string): void {
    this.card.buttons = this.card.buttons.filter((b) => b.id !== id);
    this.card.fields = this.card.fields.filter((f) => f.id !== id);
    this.changed('content');
  }

  /**
   * A new stack with one blank card, plus an icon for it on the Home card when a slot is free
   * (every stack is also in the Go menu). Returns the new stack.
   */
  addStack(name: string): StackDoc {
    const stack: StackDoc = { id: this.newId('stack'), name, cards: [this.blankCard('Card 1')] };
    this.doc.stacks.push(stack);
    const home = this.doc.stacks.find((s) => s.id === 'home')?.cards[0];
    const free = home && HOME_SLOTS.find(([x, y]) => !home.buttons.some((b) => b.rect[0] === x && b.rect[1] === y));
    if (home && free) {
      home.buttons.push({
        id: this.newId('button'),
        name,
        rect: [free[0], free[1], 84, 84],
        visible: true,
        sentence: `Clicking this opens the ${name} stack.`,
        script: `on mouseUp\n  go to stack "${name}"\nend mouseUp`,
        style: 'icon',
        icon: 'sparkle',
      });
    }
    this.changed('content');
    return stack;
  }

  /** Replaces everything, for reset and loading a save. */
  replace(doc: StacksDoc): void {
    this.doc = doc;
    this.stackIndex = Math.max(0, this.doc.stacks.findIndex((s) => s.id === 'home'));
    this.cardIndex = 0;
    this.changed('content');
    this.changed('place');
  }
}

export function copy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Brings a save made by an older version up to date: built-in stacks it lacks are added (so a
 * new stack never goes missing), and the Home New Stack icon becomes the built-in button it is now.
 */
export function upgrade(doc: StacksDoc, defaults: StacksDoc): StacksDoc {
  const next = withMissingStacks(doc, defaults);
  const icon = next.stacks.find((s) => s.id === 'home')?.cards[0]?.buttons.find((b) => b.id === 'b-home-new');
  const fresh = defaults.stacks.find((s) => s.id === 'home')?.cards[0]?.buttons.find((b) => b.id === 'b-home-new');
  if (icon && fresh && !icon.builtin) Object.assign(icon, { builtin: fresh.builtin, script: fresh.script, sentence: fresh.sentence });
  return next;
}

/** A save made before a built-in stack existed gets that stack added, so a new stack never goes missing. */
export function withMissingStacks(doc: StacksDoc, defaults: StacksDoc): StacksDoc {
  const have = new Set(doc.stacks.map((s) => s.id));
  return { ...doc, stacks: [...doc.stacks, ...defaults.stacks.filter((s) => !have.has(s.id)).map(copy)] };
}
