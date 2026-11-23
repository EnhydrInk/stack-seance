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
}

export type CompileResponse =
  | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
  | { ok: false; error: 'nothing'; skipped: string[] }
  | { ok: false; error: 'limit'; scope: 'ip' | 'site' }
  | { ok: false; error: 'bad-request' }
  | { ok: false; error: 'unauthorized' }
  | { ok: false; error: 'model' };

/** What the compiler needs to know about the place a button grows. `except` is a button being recompiled. */
export function requestFor(model: Model, sentence: string, except?: string): CompileRequest {
  return {
    sentence,
    stackName: model.stack.name,
    cardNames: model.stack.cards.map((c) => c.name),
    cardName: model.card.name,
    fieldNames: model.card.fields.map((f) => f.name),
    buttonNames: model.card.buttons.filter((b) => b.id !== except).map((b) => b.name),
    stackNames: model.doc.stacks.map((s) => s.name),
  };
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
