// lexer-error-masks-parse-error-fix, Property 1 (design: "Correctness Properties"): when the
// parser finds a parse error in the tokens before the first lexer error, that parse error is
// reported, by parse, by runHandler, and by another card's openCard started by a go.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { SyntaxError } from '../../src/hypertalk/errors';
import { tokenize } from '../../src/hypertalk/lexer';
import { parse, parseUnguarded } from '../../src/hypertalk/parser';
import { runHandler } from '../../src/hypertalk/runtime';
import { FakeHost } from './helpers/fakeHost';
import { isBefore, maskedParseErrorArb, otherLineEnding, textBefore, type MaskedParseError } from './helpers/lexMask';

/**
 * The generator checks: the source has a lexer error L, the twin lexes and fails to parse
 * on the target line, before L. Returns L and the twin's error, the expected result.
 */
function checkShape({ source, twin, targetLine }: MaskedParseError): { lexError: SyntaxError; expected: SyntaxError } {
  const lexed = tokenize(source);
  if (lexed.ok) throw new Error(`generator: no lexer error in\n${source}`);
  expect(tokenize(twin).ok, 'generator: the twin lexes').toBe(true);
  const parsed = parseUnguarded(twin);
  if (parsed.ok) throw new Error(`generator: the twin parses\n${twin}`);
  expect(parsed.error.line, 'generator: the twin fails on the target line').toBe(targetLine);
  expect(isBefore(parsed.error, lexed.error), 'generator: the twin error comes before L').toBe(true);
  return { lexError: lexed.error, expected: parsed.error };
}

// Expected to fail until the fix (task 3.2 removes .fails).
describe('Property 1: a parse error found before the first lexer error is reported (2.1, 2.2, 2.3)', () => {
  it.fails('parse and parseUnguarded report the twin’s parse error, with either line break', () => {
    fc.assert(
      fc.property(maskedParseErrorArb, (shape) => {
        const { lexError, expected } = checkShape(shape);
        // The text before L has no lexer error, and gives the same error as the twin.
        expect(parseUnguarded(textBefore(shape.source, lexError))).toEqual({ ok: false, error: expected });

        const result = parseUnguarded(shape.source);
        expect(result).toEqual({ ok: false, error: expected });
        expect(parse(shape.source)).toEqual(result);
        expect(parseUnguarded(otherLineEnding(shape.source))).toEqual(result);
      }),
      { numRuns: 300 },
    );
  });
});

// Expected to fail until the fix (task 3.2 removes .fails).
describe('Property 1: running a script with a parse error found before a lexer error (2.4)', () => {
  const GO_NEXT = 'on mouseUp\n  go to next card\nend mouseUp';

  it.fails('runHandler returns the parse error and calls the host for nothing', async () => {
    await fc.assert(
      fc.asyncProperty(maskedParseErrorArb, async (shape) => {
        const { expected } = checkShape(shape);
        const host = new FakeHost({ cards: [{}] });
        const ran = await runHandler(shape.source, shape.handler, { host, globals: new Map(), scriptId: 'button-1' });
        expect(ran).toEqual({ ok: false, error: expected });
        expect(host.log).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it.fails('another card’s openCard returns the parse error with that card’s id, and runs nothing of its script', async () => {
    const openCardArb = maskedParseErrorArb.filter((s) => s.handler === 'openCard');
    await fc.assert(
      fc.asyncProperty(openCardArb, async (shape) => {
        const { expected } = checkShape(shape);
        const host = new FakeHost({ cards: [{ script: GO_NEXT }, { script: shape.source }] });
        const ran = await runHandler(GO_NEXT, 'mouseUp', { host, globals: new Map(), scriptId: 'card-1' });
        expect(ran).toEqual({ ok: false, error: { ...expected, scriptId: 'card-2' } });
        expect(host.state.current).toBe(2);
        expect(host.log.at(-1)).toEqual({ call: 'getCardScript', id: 'card-2' });
        expect(host.log.filter((c) => c.call === 'getCardScript')).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });
});
