// Token types and the keyword tables of the v1 HyperTalk subset.

export type Operator = '(' | ')' | ',' | '&' | '&&' | '+' | '-' | '*' | '/' | '<' | '>' | '<=' | '>=';

interface At {
  /** 1-based line. */
  line: number;
  /** 1-based column, counted in UTF-16 code units. */
  column: number;
}

export type Token =
  /** A word as written; compare keywords with `text.toLowerCase()`. */
  | (At & { kind: 'word'; text: string })
  | (At & { kind: 'number'; text: string; value: number })
  /** `text` includes the quotes, `value` does not. */
  | (At & { kind: 'string'; text: string; value: string })
  | (At & { kind: 'op'; text: Operator })
  | (At & { kind: 'newline'; text: '\n' })
  /** Always the last token. Its line is the last line of the script. */
  | (At & { kind: 'eof'; text: '' });

export type TokenKind = Token['kind'];

/**
 * The haunt statements (R15). This table is the only place in src/hypertalk that names
 * a creature (R15.4): the parser, printer and runtime all read it.
 * Rules for an entry (checked by a test): the first word is unique here and starts no
 * other statement, and no word is `it`, `true` or `false`.
 */
export const HAUNTS = [
  { words: ['release', 'bat'], kind: 'bat' },
  { words: ['howl'], kind: 'howl' },
  { words: ['summon', 'witch'], kind: 'witch' },
  { words: ['drop', 'spider'], kind: 'spider' },
] as const;

export type Haunt = (typeof HAUNTS)[number];
export type HauntKind = Haunt['kind'];

/** Every word the grammar uses as a keyword (lowercase), including every haunt word. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  ...HAUNTS.flatMap((h): readonly string[] => h.words),
  'on', 'end',
  'go', 'to', 'next', 'prev', 'first', 'last', 'card', 'stack',
  'visual', 'effect', 'dissolve', 'wipe', 'left', 'right', 'iris', 'open', 'close',
  'answer', 'with', 'or', 'ask',
  'put', 'into', 'after', 'before', 'field',
  'show', 'hide', 'button',
  'wait', 'second', 'seconds',
  'global',
  'if', 'then', 'else',
  'is', 'not', 'contains', 'and',
]);

/** The constants `true` and `false` (R11.10). */
export const CONSTANTS: ReadonlySet<string> = new Set(['true', 'false']);

/**
 * Words that cannot be variable names (R8.4): the keywords plus `true` and `false`.
 * `it` is not reserved; it is an ordinary variable (R8.3).
 */
export const RESERVED: ReadonlySet<string> = new Set([...KEYWORDS, ...CONSTANTS]);

export function isReserved(word: string): boolean {
  return RESERVED.has(word.toLowerCase());
}
