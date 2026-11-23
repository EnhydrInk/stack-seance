// The interpreter's Host in the browser: every call reads or changes the model, and the
// stage shows it (card changes with their effect, dialogs, haunts).

import type { CardRef, Effect, HauntKind, Host, StackRef } from '../hypertalk/index';
import type { Model } from './model';
import type { ButtonDoc } from './types';

/** What the host needs from the screen. */
export interface Stage {
  /** Runs `change` (which moves the model to another card) and plays `effect` over it. */
  changeCard(change: () => void, effect?: Effect): void;
  /** Resolves when the card change on screen has finished. */
  settled(): Promise<void>;
  answer(message: string, labels: string[]): Promise<string>;
  ask(message: string): Promise<string | null>;
  /** Closes the open answer or ask dialog. */
  dismiss(): void;
  /** `from` is the button whose script is running, when there is one. */
  haunt(kind: HauntKind, from: ButtonDoc | undefined): Promise<void>;
}

/** What a stopped script's next host call throws; the runner shows no error for it. */
class StoppedError extends Error {
  constructor() {
    super('stopped');
  }
}

export class BrowserHost implements Host {
  /** The button whose mouseUp is running; a bat flies out of it. */
  origin: ButtonDoc | undefined;
  /** Set by stop(), cleared when a new run starts. */
  stopped = false;
  private endWait: (() => void) | undefined;

  /**
   * Ends the running script: a wait or an open dialog ends at once (the dialog's answer is not
   * used), and the next wait, dialog, haunt or move throws.
   */
  stop(): void {
    this.stopped = true;
    this.endWait?.();
    this.stage.dismiss();
  }

  private guard(): void {
    if (this.stopped) throw new StoppedError();
  }

  constructor(
    private readonly model: Model,
    private readonly stage: Stage,
  ) {}

  cardCount(): number {
    return this.model.stack.cards.length;
  }

  currentCard(): CardRef {
    return this.model.cardRef(this.model.cardIndex);
  }

  findCardByName(name: string): CardRef | undefined {
    const i = this.model.findCard(name);
    return i < 0 ? undefined : this.model.cardRef(i);
  }

  cardAt(index: number): CardRef | undefined {
    return index >= 1 && index <= this.cardCount() ? this.model.cardRef(index - 1) : undefined;
  }

  goToCard(card: CardRef, effect?: Effect): void {
    this.guard();
    this.stage.changeCard(() => this.model.goToCard(card.index - 1), effect);
  }

  findStackByName(name: string): StackRef | undefined {
    return this.model.findStack(name);
  }

  goToStack(stack: StackRef, effect?: Effect): CardRef {
    this.stage.changeCard(() => this.model.goToStack(stack.id), effect);
    return this.currentCard();
  }

  getField(name: string): string | undefined {
    return this.model.field(name)?.text;
  }

  setField(name: string, text: string): boolean {
    const field = this.model.field(name);
    if (!field) return false;
    field.text = text;
    this.model.changed('content');
    return true;
  }

  setVisible(kind: 'button' | 'field', name: string, visible: boolean): boolean {
    const item = kind === 'button' ? this.model.button(name) : this.model.field(name);
    if (!item) return false;
    item.visible = visible;
    this.model.changed('content');
    return true;
  }

  async answer(message: string, labels: string[]): Promise<string> {
    await this.stage.settled();
    this.guard();
    const choice = await this.stage.answer(message, labels);
    this.guard();
    return choice;
  }

  async ask(message: string): Promise<string | null> {
    await this.stage.settled();
    this.guard();
    const reply = await this.stage.ask(message);
    this.guard();
    return reply;
  }

  async wait(seconds: number): Promise<void> {
    await this.stage.settled();
    this.guard();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, seconds * 1000);
      this.endWait = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.endWait = undefined;
    this.guard();
  }

  async haunt(kind: HauntKind): Promise<void> {
    await this.stage.settled();
    this.guard();
    await this.stage.haunt(kind, this.origin);
  }

  getCardScript(card: CardRef): string {
    return this.model.cardById(card.id)?.card.script ?? '';
  }
}
