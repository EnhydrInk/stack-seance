// The contract with the UI (requirements.md, "Contract with the UI"). The two contract
// types are copied from there exactly; a type test pins them (Requirement 1.2). The optional
// `label` comes from the recompile-keeps-label spec, whose "Contract change" section gives it.
// The request checks live here, not in the Worker, so the UI can import the same limits.
// The Content-Type and body size checks are about HTTP and stay in worker/src/handle.ts.

import { findSameName } from './names';

export interface CompileRequest {
  sentence: string;                 // 1..500 characters
  stackName: string;                // the current stack
  cardNames: string[];              // every card of the current stack, in order
  cardName: string;                 // the card the button goes on
  fieldNames: string[];             // fields on that card
  buttonNames: string[];            // other buttons on that card
  stackNames: string[];             // every stack, for go to stack
  label?: string;                   // when recompiling: the button's current label, which the reply keeps
}

export type CompileResponse =
  | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
  | { ok: false; error: 'nothing'; skipped: string[] }          // 422: nothing in the sentence can be done
  | { ok: false; error: 'limit'; scope: 'ip' | 'site' }         // 429: daily limit reached
  | { ok: false; error: 'bad-request' }                         // 400: the request does not match CompileRequest
  | { ok: false; error: 'unauthorized' }                        // 401: no valid Cloudflare Access token while Access is required
  | { ok: false; error: 'model' };                              // 502: the model failed or never produced a valid result

/** What `compile` returns: the three answers that come from the compiler, not from the Worker. */
export type CompileOutcome =
  | Extract<CompileResponse, { ok: true }>
  | { ok: false; error: 'nothing'; skipped: string[] }
  | { ok: false; error: 'model' };

/**
 * Lengths in UTF-16 code units (the JavaScript `length`), list sizes in entries (Requirement 2.3,
 * 2.4). `label` is the longest Request_Label (recompile-keeps-label, Requirement 2.2).
 */
export const REQUEST_LIMITS = { sentence: 500, names: 100, nameLength: 100, label: 24 } as const;

const NAME_LISTS = ['cardNames', 'fieldNames', 'buttonNames', 'stackNames'] as const;

/**
 * The request with only the CompileRequest fields, or null for a bad request (Requirement 2.2 to 2.6).
 * The lists are new arrays, and fields the contract does not define are dropped, so nothing
 * else reaches the User_Message.
 */
export function readCompileRequest(value: unknown): CompileRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;

  const { sentence, stackName, cardName } = body;
  if (typeof sentence !== 'string' || typeof stackName !== 'string' || typeof cardName !== 'string') return null;
  // `\s` covers Unicode white space, so a sentence of U+3000 full-width spaces is blank too.
  if (sentence.length < 1 || sentence.length > REQUEST_LIMITS.sentence || !/\S/.test(sentence)) return null;
  if (!fitsName(stackName) || !fitsName(cardName)) return null;

  const lists: Partial<Record<(typeof NAME_LISTS)[number], string[]>> = {};
  for (const key of NAME_LISTS) {
    const list = readNameList(body[key]);
    if (!list) return null;
    lists[key] = list;
  }
  const { cardNames, fieldNames, buttonNames, stackNames } = lists as Record<(typeof NAME_LISTS)[number], string[]>;
  const request: CompileRequest = { sentence, stackName, cardNames, cardName, fieldNames, buttonNames, stackNames };

  // A request without a label is read exactly as before (recompile-keeps-label, Requirement 2.1).
  const { label } = body;
  if (label === undefined) return request;
  return isRequestLabel(label, buttonNames) ? { ...request, label } : null;
}

/**
 * A Request_Label: a string of 1 to 24 code units that is not blank and is not the Same_Name as
 * another button on the card. It is not checked for English: it comes from an earlier reply or
 * from a built-in button (recompile-keeps-label, Requirement 2).
 */
function isRequestLabel(value: unknown, buttonNames: readonly string[]): value is string {
  return typeof value === 'string'
    && value.length >= 1 && value.length <= REQUEST_LIMITS.label
    && /\S/.test(value)
    && findSameName(buttonNames, value) === undefined;
}

function fitsName(name: string): boolean {
  return name.length <= REQUEST_LIMITS.nameLength;
}

/** A copy of the list, or null unless it is an array of at most 100 strings of at most 100 code units. */
function readNameList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > REQUEST_LIMITS.names) return null;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !fitsName(entry)) return null;
    names.push(entry);
  }
  return names;
}
