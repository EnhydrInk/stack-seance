// Name helpers for the Result_Rules (design.md, "names.ts").

/** Most characters in an English_Name (glossary, Rules 4 and 7). */
export const ENGLISH_NAME_MAX = 24;

/** The longest a value is shown in a report before it is cut (`quote`). */
const QUOTE_LIMIT = 80;

/** Same_Name: equal after `toLowerCase()`, as the interpreter compares names (R1.8). */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The first non-empty entry of `list` that is the Same_Name as `name`. An empty entry never matches. */
export function findSameName(list: readonly string[], name: string): string | undefined {
  return list.find((entry) => entry !== '' && sameName(entry, name));
}

/**
 * Looks_Numeric, a copy of R11.4: optional spaces, an optional minus sign, digits, an optional
 * dot followed by digits, optional spaces. The interpreter does not export its own, so a test
 * checks that the two agree.
 */
export function looksNumeric(s: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(s);
}

/** ASCII_Text: every character is printable ASCII, U+0020 to U+007E. */
export function isAsciiText(s: string): boolean {
  return /^[\x20-\x7E]*$/.test(s);
}

/**
 * The parts of English_Name that `s` breaks, in a fixed order, worded to follow "The label …"
 * or "The new card …" in a report. An empty string gives only `is empty`.
 */
export function englishNameProblems(s: string): string[] {
  if (s === '') return ['is empty'];
  const problems: string[] = [];
  if (s.length > ENGLISH_NAME_MAX) problems.push(`is ${s.length} characters long, more than ${ENGLISH_NAME_MAX}`);
  if (!isAsciiText(s)) problems.push('holds a character that is not printable ASCII');
  if (!/[A-Za-z]/.test(s)) problems.push('holds no letter');
  if (s.includes('"')) problems.push('holds a double quote');
  if (s.startsWith(' ') || s.endsWith(' ')) problems.push('starts or ends with a space');
  return problems;
}

/**
 * A value as a report shows it: `JSON.stringify`, after cutting it to 80 code units plus `…`
 * when it is longer. The JSON escapes keep quotes and line breaks from breaking the report's line.
 */
export function quote(s: string): string {
  return JSON.stringify(s.length > QUOTE_LIMIT ? `${s.slice(0, QUOTE_LIMIT)}…` : s);
}
