// In-memory host for tests (R10.3): one or more stacks of cards, a queue of dialog replies
// and a log of every call, in order. clone() gives an independent copy for P3.
// Wait and haunts resolve at once; nothing here uses a timer.
//
// The card calls answer from the current stack (go-to-stack-command Requirement 6.5, 7.6), and
// `state` is that stack's cards and current card, so tests written for a single stack read it
// as before (design: "Fake host design").

import type { Effect } from '../../../src/hypertalk/ast';
import type { CardRef, Host, StackRef } from '../../../src/hypertalk/host';
import type { HauntKind } from '../../../src/hypertalk/tokens';

export interface FakeButton {
  name: string;
  visible: boolean;
}

export interface FakeField {
  name: string;
  text: string;
  visible: boolean;
}

export interface FakeCard {
  id: string;
  name: string | null;
  script: string;
  fields: FakeField[];
  buttons: FakeButton[];
}

/**
 * One stack's cards and its current card: everything a script can read or change there.
 * Plain data, so tests compare it with toEqual. `FakeHost.state` is the current stack's.
 */
export interface FakeStack {
  cards: FakeCard[];
  /** 1-based index of the current card. 1 in every stack that is not the current stack. */
  current: number;
}

/** One stack of the fake host. */
export interface FakeStackEntry {
  id: string;
  name: string;
  state: FakeStack;
}

/** The reply to the next dialog: a button label or typed text, or null for Cancel. */
export type Reply = string | null;

/** One entry per host call, with its arguments. */
export type HostCall =
  | { call: 'cardCount' }
  | { call: 'currentCard' }
  | { call: 'findCardByName'; name: string }
  | { call: 'cardAt'; index: number }
  | { call: 'goToCard'; index: number; id: string; effect?: Effect }
  | { call: 'getField'; name: string }
  | { call: 'setField'; name: string; text: string }
  | { call: 'setVisible'; kind: 'button' | 'field'; name: string; visible: boolean }
  | { call: 'answer'; message: string; labels: string[] }
  | { call: 'ask'; message: string }
  | { call: 'wait'; seconds: number }
  | { call: 'haunt'; kind: HauntKind }
  | { call: 'getCardScript'; id: string }
  | { call: 'findStackByName'; name: string }
  | { call: 'goToStack'; id: string; effect?: Effect };

export interface FakeCardInit {
  /**
   * Defaults to `card-<n>` in the cards form and to `<stack id>/card-<n>` in the stacks form,
   * where n is the 1-based position in its stack.
   */
  id?: string;
  name?: string | null;
  script?: string;
  /** Text defaults to '', visible to true. */
  fields?: { name: string; text?: string; visible?: boolean }[];
  buttons?: { name: string; visible?: boolean }[];
}

/** The single-stack form, unchanged (go-to-stack-command Requirement 7.2). */
export interface FakeHostInit {
  cards: FakeCardInit[];
  /** 1-based; defaults to 1. */
  current?: number;
  replies?: Reply[];
}

export interface FakeStackInit {
  /** Defaults to `stack-<n>`, where n is the 1-based position in `stacks`. */
  id?: string;
  name: string;
  /** At least one. A card without an id gets `<stack id>/card-<n>`, n its position in this stack. */
  cards: FakeCardInit[];
}

/** The form with several stacks (go-to-stack-command Requirement 7.3). */
export interface FakeStacksInit {
  stacks: FakeStackInit[];
  /** 1-based position in `stacks` of the starting stack; defaults to 1. */
  currentStack?: number;
  /** 1-based index of the starting card in that stack; defaults to 1. */
  current?: number;
  replies?: Reply[];
}

/** The stack a host built from `cards` alone holds (go-to-stack-command Requirement 7.2). */
export const DEFAULT_STACK: StackRef = { id: 'stack-1', name: 'Stack 1' };

export class FakeHost implements Host {
  /** Every stack, in the order given. The current one is stacks[currentStackIndex]. */
  readonly stacks: FakeStackEntry[];
  private currentStackIndex: number;
  /** Consumed from the front, by `answer` and `ask` alike. */
  replies: Reply[];
  readonly log: HostCall[] = [];

  constructor(init: FakeHostInit | FakeStacksInit) {
    const given = 'stacks' in init ? init : oneStack(init);
    if (given.stacks.length === 0) throw new Error('fake host: there must be at least one stack');
    const stacks = given.stacks.map((s, i): FakeStackEntry => {
      const id = s.id ?? `stack-${i + 1}`;
      if (s.cards.length === 0) throw new Error(`fake host: a stack needs at least one card ("${s.name}" has none)`);
      // Only the current stack has a current card other than 1 (design: "How approach A works").
      return { id, name: s.name, state: { cards: s.cards.map((c, j) => makeCard(c, `${id}/card-${j + 1}`)), current: 1 } };
    });
    unique(stacks.map((s) => s.id), 'stack ids');
    unique(stacks.map((s) => s.name.toLowerCase()), 'stack names, ignoring case,');
    unique(stacks.flatMap((s) => s.state.cards.map((c) => c.id)), 'card ids, across all stacks,');
    const currentStack = given.currentStack ?? 1;
    if (!Number.isInteger(currentStack) || currentStack < 1 || currentStack > stacks.length) {
      throw new Error(`fake host: current stack ${currentStack} is not in 1..${stacks.length}`);
    }
    const { state } = stacks[currentStack - 1]!;
    const current = given.current ?? 1;
    if (!Number.isInteger(current) || current < 1 || current > state.cards.length) {
      throw new Error(`fake host: current card ${current} is not in 1..${state.cards.length}`);
    }
    state.current = current;
    this.stacks = stacks;
    this.currentStackIndex = currentStack - 1;
    this.replies = [...(given.replies ?? [])];
  }

  /** The current stack's cards and current card: the same object as its entry's `state`. */
  get state(): FakeStack {
    return this.stacks[this.currentStackIndex]!.state;
  }

  /** An independent copy: same stack, same remaining replies, same log so far. */
  clone(): FakeHost {
    const copy = new FakeHost({ cards: structuredClone(this.state.cards), current: this.state.current, replies: this.replies });
    copy.log.push(...structuredClone(this.log));
    return copy;
  }

  // ---- Host ---------------------------------------------------------------------

  cardCount(): number {
    this.log.push({ call: 'cardCount' });
    return this.state.cards.length;
  }

  currentCard(): CardRef {
    this.log.push({ call: 'currentCard' });
    return this.ref(this.state.current);
  }

  findCardByName(name: string): CardRef | undefined {
    this.log.push({ call: 'findCardByName', name });
    const key = name.toLowerCase();
    const i = this.state.cards.findIndex((c) => c.name !== null && c.name.toLowerCase() === key);
    return i < 0 ? undefined : this.ref(i + 1);
  }

  cardAt(index: number): CardRef | undefined {
    this.log.push({ call: 'cardAt', index });
    const inRange = Number.isInteger(index) && index >= 1 && index <= this.state.cards.length;
    return inRange ? this.ref(index) : undefined;
  }

  goToCard(card: CardRef, effect?: Effect): void {
    this.log.push({ call: 'goToCard', index: card.index, id: card.id, ...(effect ? { effect } : {}) });
    this.cardOf(card);
    this.state.current = card.index;
  }

  getField(name: string): string | undefined {
    this.log.push({ call: 'getField', name });
    return this.fieldOnCurrent(name)?.text;
  }

  setField(name: string, text: string): boolean {
    this.log.push({ call: 'setField', name, text });
    const field = this.fieldOnCurrent(name);
    if (!field) return false;
    field.text = text;
    return true;
  }

  setVisible(kind: 'button' | 'field', name: string, visible: boolean): boolean {
    this.log.push({ call: 'setVisible', kind, name, visible });
    const item = kind === 'field' ? this.fieldOnCurrent(name) : this.buttonOnCurrent(name);
    if (!item) return false;
    item.visible = visible;
    return true;
  }

  /**
   * Returns the label equal to the next reply. When the reply is not one of the labels,
   * or there are no replies left, returns the first label, like pressing Return.
   * So the runtime only ever receives a label a person could have clicked.
   */
  async answer(message: string, labels: string[]): Promise<string> {
    this.log.push({ call: 'answer', message, labels: [...labels] });
    const first = labels[0];
    if (first === undefined) throw new Error('fake host: answer needs at least one label');
    const reply = this.replies.shift();
    return labels.find((l) => l === reply) ?? first;
  }

  /** Returns the next reply. No replies left counts as Cancel. */
  async ask(message: string): Promise<string | null> {
    this.log.push({ call: 'ask', message });
    return this.replies.shift() ?? null;
  }

  async wait(seconds: number): Promise<void> {
    this.log.push({ call: 'wait', seconds });
  }

  /** Logs the kind and resolves at once. Changes no card, field or visibility state (R15.3). */
  async haunt(kind: HauntKind): Promise<void> {
    this.log.push({ call: 'haunt', kind });
  }

  getCardScript(card: CardRef): string {
    this.log.push({ call: 'getCardScript', id: card.id });
    return this.cardOf(card).script;
  }

  // ---- reads for tests (not host calls, so not logged) ----------------------------

  /** The current card, or the card at a 1-based index. */
  card(index = this.state.current): FakeCard {
    const card = this.state.cards[index - 1];
    if (!card) throw new Error(`fake host: no card at index ${index}`);
    return card;
  }

  /** Text of a field, on the current card unless an index is given. */
  fieldText(name: string, index = this.state.current): string | undefined {
    return findByName(this.card(index).fields, name)?.text;
  }

  isVisible(kind: 'button' | 'field', name: string, index = this.state.current): boolean | undefined {
    const card = this.card(index);
    return findByName(kind === 'field' ? card.fields : card.buttons, name)?.visible;
  }

  // ---- internals -------------------------------------------------------------------

  private ref(index: number): CardRef {
    const card = this.card(index);
    return { index, id: card.id, name: card.name };
  }

  /** The card a ref points at. A stale or made-up ref is a bug in the caller, so it throws. */
  private cardOf(ref: CardRef): FakeCard {
    const card = this.state.cards[ref.index - 1];
    if (!card || card.id !== ref.id) throw new Error(`fake host: no card "${ref.id}" at index ${ref.index}`);
    return card;
  }

  private fieldOnCurrent(name: string): FakeField | undefined {
    return findByName(this.card().fields, name);
  }

  private buttonOnCurrent(name: string): FakeButton | undefined {
    return findByName(this.card().buttons, name);
  }
}

/** Names compare case-insensitively (R1.8); the first match wins. */
function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const key = name.toLowerCase();
  return items.find((item) => item.name.toLowerCase() === key);
}

/** The cards form as one stack equal to DEFAULT_STACK, whose cards keep the ids `card-<n>` they always had. */
function oneStack(init: FakeHostInit): FakeStacksInit {
  const cards = init.cards.map((c, i): FakeCardInit => ({ ...c, id: c.id ?? `card-${i + 1}` }));
  return { stacks: [{ ...DEFAULT_STACK, cards }], current: init.current, replies: init.replies };
}

function makeCard(c: FakeCardInit, defaultId: string): FakeCard {
  return {
    id: c.id ?? defaultId,
    name: c.name ?? null,
    script: c.script ?? '',
    fields: (c.fields ?? []).map((f) => ({ name: f.name, text: f.text ?? '', visible: f.visible ?? true })),
    buttons: (c.buttons ?? []).map((b) => ({ name: b.name, visible: b.visible ?? true })),
  };
}

function unique(keys: string[], what: string): void {
  if (new Set(keys).size !== keys.length) throw new Error(`fake host: ${what} must be unique`);
}
