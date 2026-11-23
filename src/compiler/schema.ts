// The Reply_Schema and the Reply_Object (design.md, "schema.ts").
// The schema uses only what structured outputs support: every field required,
// `additionalProperties: false`, no unions, and no length, pattern or item-count keywords.
// Code checks those limits instead (Rules 4, 7 and 9). The properties are in the order the
// model should decide them, and no field asks for reasoning (Requirement 6.7).

export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    hasButton: { type: 'boolean', description: 'false only when nothing in the sentence can be done' },
    script:    { type: 'string',  description: 'one on mouseUp handler, lines joined with \\n; empty when hasButton is false' },
    newCards:  { type: 'array', items: { type: 'string' }, description: 'cards the script goes to by name that are not in cardNames' },
    label:     { type: 'string',  description: 'short English button label, 1 to 24 printable ASCII characters; empty when hasButton is false' },
    skipped:   { type: 'array', items: { type: 'string' }, description: 'short English phrases for what the subset cannot do' },
  },
  required: ['hasButton', 'script', 'newCards', 'label', 'skipped'],
  additionalProperties: false,
} as const;

export interface ReplyObject { hasButton: boolean; script: string; newCards: string[]; label: string; skipped: string[] }

const FIELDS = REPLY_SCHEMA.required;

/**
 * The reply object, or null when the text is not one JSON object with exactly the five fields
 * and their types. A null gives one Rule 10 report that does not name a field: with structured
 * outputs, a wrong shape comes from a cut-off or damaged response.
 */
export function readReplyObject(text: string): ReplyObject | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || !FIELDS.every((f) => Object.hasOwn(value, f))) return null;

  const { hasButton, script, newCards, label, skipped } = value as Record<string, unknown>;
  if (typeof hasButton !== 'boolean' || typeof script !== 'string' || typeof label !== 'string') return null;
  if (!isStringArray(newCards) || !isStringArray(skipped)) return null;
  return { hasButton, script, newCards, label, skipped };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
