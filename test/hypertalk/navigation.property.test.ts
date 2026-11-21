// Task 9.5: property P2 (navigation). A mouseUp handler runs one go on a generated stack,
// and the result must be one of P2's three outcomes, at the card a small model expects.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineCount } from '../../src/hypertalk/errors';
import type { RunResult } from '../../src/hypertalk/host';
import { runHandler } from '../../src/hypertalk/runtime';
import { FakeHost } from './helpers/fakeHost';
import { goScript, navCaseArb, type GenStack, type GoCase } from './helpers/arbitraries';

/** The three outcomes P2 allows. */
type Outcome =
  /** No error, and the current card is `card`. */
  | { k: 'moved'; card: number }
  /** A runtime error on the go line, and the card did not change. */
  | { k: 'goFailed' }
  /** The go moved to `card`, and that card's openCard failed. */
  | { k: 'openCardFailed'; card: number };

/**
 * Where the go lands, worked out from the stack alone (R2.2, R2.3, R2.4).
 * undefined when the target is not a card. Written apart from the runtime on purpose.
 */
function expectedCard(stack: GenStack, target: GoCase): number | undefined {
  const count = stack.cards.length;
  const card = (n: number) => (Number.isInteger(n) && n >= 1 && n <= count ? n : undefined);
  switch (target.k) {
    case 'nav':
      return {
        next: stack.current === count ? 1 : stack.current + 1,
        prev: stack.current === 1 ? count : stack.current - 1,
        first: 1,
        last: count,
      }[target.nav];
    case 'number':
      return card(target.n);
    case 'numericString':
      return target.whole ? card(target.n) : undefined;
    case 'name': {
      const i = stack.cards.findIndex((c) => c.name.toLowerCase() === target.name.toLowerCase());
      return i < 0 ? undefined : i + 1;
    }
  }
}

function expectedOutcome(stack: GenStack, target: GoCase): Outcome {
  const card = expectedCard(stack, target);
  if (card === undefined) return { k: 'goFailed' };
  const { kind } = stack.cards[card - 1]!;
  return kind === 'runtimeError' || kind === 'syntaxError' ? { k: 'openCardFailed', card } : { k: 'moved', card };
}

/** Which of the three outcomes a run had. Fails the test when it had none of them. */
function observedOutcome(result: RunResult, host: FakeHost, before: number, goLine: number): Outcome {
  const now = host.state.current;
  expect(Number.isInteger(now) && now >= 1 && now <= host.state.cards.length).toBe(true);
  if (result.ok) return { k: 'moved', card: now };
  const { error } = result;
  if (error.scriptId === undefined) {
    // The error comes from the script that was run, so it is the go itself.
    expect(error).toMatchObject({ kind: 'runtime', line: goLine });
    expect(now).toBe(before);
    expect(host.log.filter((c) => c.call === 'goToCard')).toEqual([]);
    return { k: 'goFailed' };
  }
  // The error comes from the new card's script: its id, and a line inside that script.
  const card = host.card(now);
  expect(error.scriptId).toBe(card.id);
  expect(Number.isInteger(error.line)).toBe(true);
  expect(error.line).toBeGreaterThanOrEqual(1);
  expect(error.line).toBeLessThanOrEqual(lineCount(card.script));
  return { k: 'openCardFailed', card: now };
}

async function runCase(stack: GenStack, target: GoCase) {
  const { source, replies, goLine } = goScript(target);
  const host = new FakeHost({ cards: stack.cards, current: stack.current, replies });
  const result = await runHandler(source, 'mouseUp', { host, globals: new Map(), scriptId: 'button-1' });
  return { result, host, goLine, outcome: observedOutcome(result, host, stack.current, goLine) };
}

describe('P2 navigation (R2, R12.3, R12.5, R14)', () => {
  it('P2 navigation: every go ends in one of the three outcomes, at the card the model expects', async () => {
    await fc.assert(
      fc.asyncProperty(navCaseArb, async ({ stack, target }) => {
        const { result, outcome } = await runCase(stack, target);
        expect(outcome).toEqual(expectedOutcome(stack, target));
        if (outcome.k === 'openCardFailed' && !result.ok) {
          // The generator knows which line of the card's script is broken.
          const card = stack.cards[outcome.card - 1]!;
          expect(result.error).toMatchObject({
            kind: card.kind === 'syntaxError' ? 'syntax' : 'runtime',
            line: card.errorLine,
          });
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('P2 examples', () => {
  const plain = (n: number, current: number): GenStack => ({
    cards: Array.from({ length: n }, (_, i) => ({ name: `Room${'abcdefghij'[i]}`, script: '', kind: 'empty' as const })),
    current,
  });

  it('next card on the last card wraps to the first', async () => {
    expect((await runCase(plain(3, 3), { k: 'nav', nav: 'next' })).outcome).toEqual({ k: 'moved', card: 1 });
  });

  it('prev card on the first card wraps to the last', async () => {
    expect((await runCase(plain(3, 1), { k: 'nav', nav: 'prev' })).outcome).toEqual({ k: 'moved', card: 3 });
  });

  it('a go to a missing card fails on its line and leaves the card unchanged', async () => {
    for (const target of [
      { k: 'number', n: 4 },
      { k: 'numericString', text: '2.5', n: 2, whole: false, via: 'ask' },
      { k: 'name', name: 'Cellar 1', via: 'literal' },
    ] satisfies GoCase[]) {
      const { result, outcome, host } = await runCase(plain(3, 2), target);
      expect(outcome, JSON.stringify(target)).toEqual({ k: 'goFailed' });
      expect(host.state.current).toBe(2);
      expect(result).toMatchObject({ ok: false, error: { line: goScript(target).goLine } });
    }
  });

  it('an error in the openCard of the new card keeps the move', async () => {
    const stack = plain(3, 1);
    stack.cards[1] = { name: 'Crypt', script: 'on openCard\n  howl\n  hide button "door"\nend openCard', kind: 'runtimeError', errorLine: 3 };
    stack.cards[2] = { name: 'Attic', script: 'on openCard\n  go nowhere\nend openCard', kind: 'syntaxError', errorLine: 2 };

    const runtime = await runCase(stack, { k: 'name', name: 'crypt', via: 'ask' });
    expect(runtime.outcome).toEqual({ k: 'openCardFailed', card: 2 });
    expect(runtime.result).toEqual({
      ok: false,
      error: { kind: 'runtime', line: 3, message: 'there is no button "door" on this card', scriptId: 'card-2' },
    });

    const syntax = await runCase(stack, { k: 'nav', nav: 'last' });
    expect(syntax.outcome).toEqual({ k: 'openCardFailed', card: 3 });
    expect(syntax.result).toMatchObject({ ok: false, error: { kind: 'syntax', line: 2, scriptId: 'card-3' } });
  });
});

describe('navigation generator (P2)', () => {
  const sample = fc.sample(navCaseArb, { numRuns: 1000, seed: 9 });

  it('gives each of the three outcomes in at least 10% of cases', async () => {
    const counts: Record<Outcome['k'], number> = { moved: 0, goFailed: 0, openCardFailed: 0 };
    for (const { stack, target } of sample) counts[(await runCase(stack, target)).outcome.k]++;
    for (const [k, n] of Object.entries(counts)) expect(n / sample.length, k).toBeGreaterThanOrEqual(0.1);
  });

  it('covers both wraps, every kind of target, both ways of passing a string, and both openCard errors', () => {
    const seen = new Set<string>();
    for (const { stack, target } of sample) {
      const count = stack.cards.length;
      const card = expectedCard(stack, target);
      if (target.k === 'nav') {
        seen.add(target.nav);
        if (target.nav === 'next' && stack.current === count && count > 1) seen.add('wrap to first');
        if (target.nav === 'prev' && stack.current === 1 && count > 1) seen.add('wrap to last');
      } else {
        seen.add(`${target.k} ${card === undefined ? 'missing' : 'found'}`);
        if (target.k !== 'number') seen.add(`via ${target.via}`);
      }
      if (card !== undefined) seen.add(`card script ${stack.cards[card - 1]!.kind}`);
    }
    expect([...seen].sort()).toEqual(
      [
        'next', 'prev', 'first', 'last', 'wrap to first', 'wrap to last',
        'number found', 'number missing', 'numericString found', 'numericString missing',
        'name found', 'name missing', 'via literal', 'via ask',
        'card script empty', 'card script valid', 'card script runtimeError', 'card script syntaxError',
      ].sort(),
    );
  });
});
