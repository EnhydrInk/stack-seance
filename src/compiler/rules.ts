// The Result_Rules and the Rule_Checker (Requirement 4; design.md, "rules.ts").
// The System_Prompt states the rules with the same RULES sentences, so the prompt and the
// checker cannot drift apart.

import { parse, type Script, type SyntaxError as ScriptSyntaxError } from '../hypertalk/index';
import type { CompileRequest } from './contract';
import type { RuleNumber } from './model';
import { englishNameProblems, findSameName, isAsciiText, looksNumeric, quote, sameName } from './names';
import { collectReferences, type Reference, type Target } from './references';
import { readReplyObject, type ReplyObject } from './schema';

export type { RuleNumber } from './model';

export const RULES: Readonly<Record<RuleNumber, string>> = {
  1: 'The script parses as HyperTalk of this subset.',
  2: 'The script is exactly one on mouseUp handler, with at least one statement.',
  3: 'Every go to card with a literal name names a card in cardNames or newCards, and every literal card number is a whole number from 1 to the number of cards in cardNames plus newCards.',
  4: 'Every name in newCards is used by a go to card in the script, is not in cardNames, is in newCards once, is a short English name, and does not look like a number.',
  5: 'Every go to stack with a literal name names a stack in stackNames.',
  6: 'Every field "<name>" is in fieldNames, and every button "<name>" is in buttonNames or is the label.',
  7: 'When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames.',
  8: 'After a go, the script names no field and no button, and after a go to stack it names no card.',
  9: 'skipped holds at most 10 phrases, each 1 to 60 printable ASCII characters with no space at either end.',
  10: 'The reply is one JSON object with hasButton, script, newCards, label and skipped; when hasButton is false, script and label are empty, newCards is empty, and skipped holds at least one phrase.',
};

/** One broken rule, with the part of the reply that breaks it (Requirement 4.12). */
export interface RuleReport { rule: RuleNumber; detail: string }

export type Accepted =
  | { kind: 'button'; label: string; script: string; newCards: string[]; skipped: string[] }
  | { kind: 'nothing'; skipped: string[] };

export type CheckResult = { ok: true; reply: Accepted } | { ok: false; reports: RuleReport[] };

const MAX_SKIPPED = 10;
const MAX_PHRASE = 60;

const SHAPE_REPORT = 'The reply is not one JSON object with the five fields hasButton, script, newCards, label and skipped.';
const UNUSED_NEW_CARD = 'is not the name of any go to card in the script';

/**
 * Checks one reply text against every Result_Rule for one request. Reports are sorted by rule
 * number and keep the order they were found in within a rule. An accepted reply holds the
 * reply's own strings and arrays, unchanged (Requirement 3.7).
 */
export function checkReply(request: CompileRequest, text: string): CheckResult {
  // Stage 1: the shape. A wrong shape is Rule 10 alone (Requirement 4.11).
  const reply = readReplyObject(text);
  if (!reply) return broken([{ rule: 10, detail: SHAPE_REPORT }]);

  // Stage 2: a Nothing_Reply.
  if (!reply.hasButton) {
    const shape = nothingReplyReports(reply);
    if (shape.length > 0) return broken(shape);
    const skipped = skippedReports(reply.skipped);
    return skipped.length > 0 ? broken(skipped) : { ok: true, reply: { kind: 'nothing', skipped: reply.skipped } };
  }

  // Stage 3: what needs no parse. Rule 4's problems per name are reported once the parse is done.
  const reports: RuleReport[] = [...labelReports(request, reply.label), ...skippedReports(reply.skipped)];
  const newCardProblems = reply.newCards.map((name, i) => unparsedNewCardProblems(request, reply.newCards, name, i));

  // Stage 4: the parse. A syntax error ends the check.
  const parsed = parse(reply.script);
  if (!parsed.ok) {
    reports.push(syntaxReport(reply.script, parsed.error));
  } else {
    // Stage 5: the parsed script, every handler of it.
    reports.push(...handlerReports(parsed.script));
    const references = collectReferences(parsed.script);
    reports.push(...referenceReports(request, reply, references));
    const used = references.flatMap((r) => (r.kind === 'cardName' ? [r.text] : []));
    reply.newCards.forEach((name, i) => {
      if (findSameName(used, name) === undefined) newCardProblems[i]!.push(UNUSED_NEW_CARD);
    });
  }
  reply.newCards.forEach((name, i) => {
    const problems = newCardProblems[i]!;
    if (problems.length > 0) reports.push({ rule: 4, detail: `The new card ${quote(name)} ${problems.join(' and ')}.` });
  });

  if (reports.length > 0) return broken(reports);
  const { label, script, newCards, skipped } = reply;
  return { ok: true, reply: { kind: 'button', label, script, newCards, skipped } };
}

function broken(reports: RuleReport[]): CheckResult {
  // Array.prototype.sort is stable, so reports keep their order within a rule.
  return { ok: false, reports: [...reports].sort((a, b) => a.rule - b.rule) };
}

// ---- Rule 10: a Nothing_Reply holds nothing but skipped phrases -----------------------

function nothingReplyReports(reply: ReplyObject): RuleReport[] {
  const problems: string[] = [];
  if (reply.script !== '') problems.push('hasButton is false, but script is not empty.');
  if (reply.label !== '') problems.push('hasButton is false, but label is not empty.');
  if (reply.newCards.length > 0) problems.push('hasButton is false, but newCards is not empty.');
  if (reply.skipped.length === 0) problems.push('hasButton is false, but skipped is empty.');
  return problems.map((detail) => ({ rule: 10, detail }));
}

// ---- Rule 9: skipped phrases --------------------------------------------------------

function skippedReports(skipped: readonly string[]): RuleReport[] {
  const reports: RuleReport[] = [];
  if (skipped.length > MAX_SKIPPED) {
    reports.push({ rule: 9, detail: `skipped holds ${skipped.length} phrases, more than ${MAX_SKIPPED}.` });
  }
  for (const phrase of skipped) {
    const problems = phraseProblems(phrase);
    if (problems.length > 0) reports.push({ rule: 9, detail: `The skipped phrase ${quote(phrase)} ${problems.join(' and ')}.` });
  }
  return reports;
}

function phraseProblems(phrase: string): string[] {
  if (phrase === '') return ['is empty'];
  const problems: string[] = [];
  if (phrase.length > MAX_PHRASE) problems.push(`is ${phrase.length} characters long, more than ${MAX_PHRASE}`);
  if (!isAsciiText(phrase)) problems.push('holds a character that is not printable ASCII');
  if (phrase.startsWith(' ') || phrase.endsWith(' ')) problems.push('starts or ends with a space');
  return problems;
}

// ---- Rule 7: the label --------------------------------------------------------------

function labelReports(request: CompileRequest, label: string): RuleReport[] {
  // A recompiled button keeps its label: only the same code units pass. readCompileRequest has
  // already checked the Request_Label (recompile-keeps-label, Requirement 5).
  if (request.label !== undefined) {
    if (label === request.label) return [];
    return [{ rule: 7, detail: `The label ${quote(label)} is not the label in the request, ${quote(request.label)}.` }];
  }
  const problems = englishNameProblems(label);
  const existing = findSameName(request.buttonNames, label);
  if (existing !== undefined) problems.push(`is already a button on this card, ${quote(existing)}`);
  return problems.length > 0 ? [{ rule: 7, detail: `The label ${quote(label)} ${problems.join(' and ')}.` }] : [];
}

// ---- Rule 4: new cards --------------------------------------------------------------

/** The parts of Rule 4 that need no parse, for `newCards[index]`. */
function unparsedNewCardProblems(request: CompileRequest, newCards: readonly string[], name: string, index: number): string[] {
  const problems = englishNameProblems(name);
  if (looksNumeric(name)) problems.push('looks like a number');
  const existing = findSameName(request.cardNames, name);
  if (existing !== undefined) problems.push(`is already a card in this stack, ${quote(existing)}`);
  // Reported on the second and later copies only.
  if (newCards.slice(0, index).some((earlier) => sameName(earlier, name))) problems.push('is in newCards more than once');
  return problems;
}

// ---- Rule 1: the parse --------------------------------------------------------------

function syntaxReport(script: string, error: ScriptSyntaxError): RuleReport {
  const lineText = script.replace(/\r\n/g, '\n').split('\n')[error.line - 1] ?? '';
  return {
    rule: 1,
    detail: `Line ${error.line}, column ${error.column}: ${error.message}. The line is ${quote(lineText)}.`,
  };
}

// ---- Rule 2: one mouseUp handler with a statement -----------------------------------

function handlerReports(script: Script): RuleReport[] {
  const reports: RuleReport[] = [];
  const count = script.handlers.length;
  if (count === 0) reports.push({ rule: 2, detail: 'The script has no handler.' });
  if (count > 1) reports.push({ rule: 2, detail: `The script has ${count} handlers.` });
  for (const handler of script.handlers) {
    const line = handler.pos.line;
    if (handler.name !== 'mouseUp') {
      reports.push({ rule: 2, detail: `Line ${line}: the handler is ${handler.name}, not mouseUp.` });
    } else if (handler.body.length === 0) {
      reports.push({ rule: 2, detail: `Line ${line}: the mouseUp handler has no statements.` });
    }
  }
  return reports;
}

// ---- Rules 3, 5, 6 and 8: the names the script uses ---------------------------------

function referenceReports(request: CompileRequest, reply: ReplyObject, references: readonly Reference[]): RuleReport[] {
  const reports: RuleReport[] = [];
  const cardCount = request.cardNames.length + reply.newCards.length;
  for (const ref of references) {
    switch (ref.kind) {
      case 'cardName':
        if (findSameName(request.cardNames, ref.text) === undefined && findSameName(reply.newCards, ref.text) === undefined) {
          reports.push({ rule: 3, detail: `Line ${ref.line}: go to card ${shown(ref.target)} names no card in cardNames or newCards.` });
        }
        reports.push(...afterStackGo(ref));
        break;
      case 'cardNumber':
        if (!Number.isInteger(ref.value) || ref.value < 1 || ref.value > cardCount) {
          reports.push({
            rule: 3,
            detail: `Line ${ref.line}: go to card ${shown(ref.target)} is not a whole card number from 1 to ${cardCount}.`,
          });
        }
        reports.push(...afterStackGo(ref));
        break;
      case 'stack':
        if (findSameName(request.stackNames, ref.text) === undefined) {
          reports.push({ rule: 5, detail: `Line ${ref.line}: go to stack ${shown(ref.target)} names no stack in stackNames.` });
        }
        break;
      case 'field':
        if (findSameName(request.fieldNames, ref.name) === undefined) {
          reports.push({ rule: 6, detail: `Line ${ref.line}: field ${quote(ref.name)} is not in fieldNames.` });
        }
        reports.push(...afterGo(ref));
        break;
      case 'button':
        if (findSameName([...request.buttonNames, reply.label], ref.name) === undefined) {
          reports.push({ rule: 6, detail: `Line ${ref.line}: button ${quote(ref.name)} is not in buttonNames and is not the label.` });
        }
        reports.push(...afterGo(ref));
        break;
    }
  }
  return reports;
}

function afterGo(ref: Extract<Reference, { kind: 'field' | 'button' }>): RuleReport[] {
  if (ref.afterGo === undefined) return [];
  return [{
    rule: 8,
    detail: `Line ${ref.line}: ${ref.kind} ${quote(ref.name)} comes after the go on line ${ref.afterGo}, so it would be looked up on another card.`,
  }];
}

function afterStackGo(ref: Extract<Reference, { kind: 'cardName' | 'cardNumber' }>): RuleReport[] {
  if (ref.afterStackGo === undefined) return [];
  return [{
    rule: 8,
    detail: `Line ${ref.line}: go to card ${shown(ref.target)} comes after the go to stack on line ${ref.afterStackGo}, so it would be looked up in another stack.`,
  }];
}

/** A target as a report shows it: a string quoted, a number or a constant as written. */
function shown(target: Target): string {
  switch (target.lit) {
    case 'str': return quote(target.value);
    case 'num': return String(target.value);
    case 'bool': return target.value ? 'true' : 'false';
  }
}
