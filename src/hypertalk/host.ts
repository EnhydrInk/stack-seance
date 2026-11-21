// The only way the runtime reaches the stack and the person using it (R10.1).
// The host owns all card state. The runtime keeps no copy of it and never caches the
// current card, so there is one source of truth (design.md, "Host interface").

import type { Effect } from './ast';
import type { RuntimeError, SyntaxError } from './errors';
import type { HauntKind } from './tokens';
import type { Value } from './values';

/** A card as the host reports it. */
export interface CardRef {
  /** 1-based position in the stack. */
  index: number;
  id: string;
  name: string | null;
}

/**
 * Asynchronous only where a person or a timer is involved (dialogs, wait, haunts).
 * Every name lookup is case-insensitive (R1.8) and, for fields and buttons, happens on
 * the card that is current at the moment of the call (R2.6).
 */
export interface Host {
  cardCount(): number;
  currentCard(): CardRef;
  findCardByName(name: string): CardRef | undefined;
  /** undefined outside 1..cardCount. */
  cardAt(index: number): CardRef | undefined;
  /** Makes `card` the current card and plays `effect` with the change (R3.2). */
  goToCard(card: CardRef, effect?: Effect): void;

  /** Text of a field on the current card; undefined when there is no such field. */
  getField(name: string): string | undefined;
  /** Replaces the text of a field on the current card; false when there is no such field. */
  setField(name: string, text: string): boolean;
  /** false when the item is missing. Showing a visible item is not an error (R6.3). */
  setVisible(kind: 'button' | 'field', name: string, visible: boolean): boolean;

  /** Resolves with the label of the chosen button. `labels` is never empty: the runtime passes ['OK'] by default (R4.4). */
  answer(message: string, labels: string[]): Promise<string>;
  /** Resolves with the typed text, or null when the person cancels (R4.5). */
  ask(message: string): Promise<string | null>;

  /** Resolves after `seconds`. The runtime has no clock of its own (R7.2). */
  wait(seconds: number): Promise<void>;
  /**
   * Plays a haunt and resolves when the script may go on: at once, or when the
   * animation ends. The host picks (R15.2). It must not change the current card,
   * fields or visibility (R15.3).
   */
  haunt(kind: HauntKind): Promise<void>;
  /** Source text of a card's script, '' when it has none (R14.2). */
  getCardScript(card: CardRef): string;
}

export interface RunContext {
  host: Host;
  /** Shared by every handler run in the session (R8.2). Keys are lower-cased. */
  globals: Map<string, Value>;
  /** Id of the owner of the script being run. Errors from another card's script carry that card's id (R12.5). */
  scriptId: string;
}

export type RunResult = { ok: true } | { ok: false; error: RuntimeError | SyntaxError };
