// What the app shows: every stack, and where the reader is. The host and the views read
// and change it; every change tells the listeners (the views redraw, autosave writes).

import type { CardRef } from '../hypertalk/index';
import type { ButtonDoc, CardDoc, FieldDoc, StackDoc, StackRef, StacksDoc } from './types';

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
