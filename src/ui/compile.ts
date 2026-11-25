// The UI side of the compiler: POST /api/compile on the same host. The request and the reply
// are the contract in the compiler spec (.kiro/specs/sentence-compiler); the Worker is built in Kiro.

import type { Model } from './model';

/** The longest sentence the compiler takes. */
export const MAX_SENTENCE = 500;

/** The longest stack, card, field or button name the compiler takes. */
export const MAX_NAME = 100;

export interface CompileRequest {
  sentence: string;
  stackName: string;
  cardNames: string[];
  cardName: string;
  fieldNames: string[];
  buttonNames: string[];
  stackNames: string[];
  /** When recompiling: the button's label, which the reply keeps. */
  label?: string;
}

export type CompileResponse =
  | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
  | { ok: false; error: 'nothing'; skipped: string[] }
  | { ok: false; error: 'limit'; scope: 'ip' | 'site' }
  | { ok: false; error: 'bad-request' }
  | { ok: false; error: 'unauthorized' }
  | { ok: false; error: 'model' };

/** The longest label the compiler writes, and so the longest it keeps on a recompile. */
export const MAX_LABEL = 24;

/** What the compiler needs to know about the place a button grows: the current card, or, for
 * `except`, a button being recompiled, its own card. That button is left out of the other
 * buttons, and it keeps its label when the compiler could have written that label itself. */
export function requestFor(model: Model, sentence: string, except?: string): CompileRequest {
  const owner = except === undefined ? undefined : model.owner(except);
  const kept = owner?.kind === 'button' ? owner : undefined;
  const stack = kept?.stack ?? model.stack;
  const card = kept?.card ?? model.card;
  const buttonNames = card.buttons.filter((b) => b.id !== except).map((b) => b.name);
  // A stack's icon is named after the stack, and a second grow of a taken label gets a number:
  // those names can be longer than a label, or taken twice. The compiler names those afresh.
  const label = kept?.button.name;
  const keeps = label !== undefined && label.length <= MAX_LABEL && /\S/.test(label)
    && !buttonNames.some((n) => n.toLowerCase() === label.toLowerCase());
  return {
    sentence,
    stackName: stack.name,
    cardNames: stack.cards.map((c) => c.name),
    cardName: card.name,
    fieldNames: card.fields.map((f) => f.name),
    buttonNames,
    stackNames: model.doc.stacks.map((s) => s.name),
    ...(keeps ? { label } : {}),
  };
}

/** True when the reader changed the script by hand since the spirits last wrote it. */
export function editedByHand(button: { script: string; compiled?: string }): boolean {
  return button.compiled !== undefined && button.script !== button.compiled;
}

/** Anything that is not a reply in the contract (no Worker, a network error) counts as a failed séance. */
export async function compileSentence(request: CompileRequest): Promise<CompileResponse> {
  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'same-origin',
    });
    const reply = (await res.json()) as CompileResponse;
    return typeof reply === 'object' && reply !== null && 'ok' in reply ? reply : { ok: false, error: 'model' };
  } catch {
    return { ok: false, error: 'model' };
  }
}
