// go-to-stack-command task 6.3: the stack P2 property. A mouseUp handler runs one go to stack
// on generated stacks, and the result must be one of three outcomes: the one a small model of
// the stacks expects, with the lookups and moves the model expects in the host's call log.
// The card P2 in navigation.property.test.ts stays on a single stack (Requirement 9.6).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineCount } from '../../src/hypertalk/errors';
import type { RunResult } from '../../src/hypertalk/host';
import { runHandler } from '../../src/hypertalk/runtime';
import { FakeHost, type HostCall } from './helpers/fakeHost';
import { stackGoScript, stackNavCaseArb, type StackNavCase } from './helpers/arbitraries';

/** The three outcomes of Property 2, with the id of the stack the run ended in. */
type StackOutcome =
  /** (a) No error, and the current card is the first card of the stack the text names. */
  | { k: 'opened'; stack: string }
  /** (b) A runtime error on the go line, and nothing moved. */
  | { k: 'goFailed' }
  /** (c) The go opened the named stack, and its first card's openCard failed. */
  | { k: 'openCardFailed'; stack: string };

/** The text the runtime must pass to findStackByName: the value of the target, as a string (R11.8). */
function modelText(c: StackNavCase): string {
  return c.target.via === 'number' ? String(Number(c.target.text)) : c.target.text;
}

/** The 0-based position of the stack the text names, ignoring case; none for the empty text (Requirement 3.4, 3.5). */
function modelMatch(c: StackNavCase): number | undefined {
  const key = modelText(c).toLowerCase();
  if (key === '') return undefined;
  const i = c.set.stacks.findIndex((s) => s.name.toLowerCase() === key);
  return i < 0 ? undefined : i;
}

/** The outcome worked out from the generated stacks alone. Written apart from the runtime on purpose. */
function expectedStackOutcome(c: StackNavCase): StackOutcome {
  const match = modelMatch(c);
  if (match === undefined) return { k: 'goFailed' };
  const stack = c.set.stacks[match]!;
  const { kind } = stack.cards[0]!;
  return kind === 'runtimeError' || kind === 'syntaxError' ? { k: 'openCardFailed', stack: stack.id } : { k: 'opened', stack: stack.id };
}

/** Which of the three outcomes a run had. Fails the test unless exactly one of them holds. */
function observedStackOutcome(result: RunResult, host: FakeHost, c: StackNavCase, goLine: number): StackOutcome {
  const now = host.stack();
  const entry = c.set.stacks.find((s) => s.id === now.id);
  if (!entry) throw new Error(`the run ended in a stack that was not generated: ${now.id}`);
  const first = entry.cards[0]!;
  const start = c.set.stacks[c.set.currentStack - 1]!;
  const named = now.name.toLowerCase() === modelText(c).toLowerCase();
  const onFirst = host.state.current === 1;
  const moved = host.log.some((x) => x.call === 'goToStack' || x.call === 'goToCard');

  const a = result.ok && named && onFirst;
  const b =
    !result.ok &&
    result.error.scriptId === undefined &&
    result.error.kind === 'runtime' &&
    result.error.line === goLine &&
    now.id === start.id &&
    host.state.current === c.set.current &&
    !moved;
  const failedLine = result.ok ? undefined : result.error.line;
  const cFirst =
    !result.ok &&
    result.error.scriptId === first.id &&
    named &&
    onFirst &&
    Number.isInteger(failedLine) &&
    failedLine! >= 1 &&
    failedLine! <= lineCount(first.script) &&
    // The generator knows which line of the card's script is broken, and how.
    result.error.kind === (first.kind === 'syntaxError' ? 'syntax' : first.kind === 'runtimeError' ? 'runtime' : 'none') &&
    failedLine === first.errorLine;

  const holding = [a && 'a', b && 'b', cFirst && 'c'].filter(Boolean);
  expect(holding, JSON.stringify({ result, stack: now, card: host.state.current, log: host.log })).toHaveLength(1);
  if (a) return { k: 'opened', stack: now.id };
  if (b) return { k: 'goFailed' };
  return { k: 'openCardFailed', stack: now.id };
}

async function runStackCase(c: StackNavCase) {
  const { source, replies, goLine } = stackGoScript(c);
  const host = new FakeHost({
    stacks: c.set.stacks.map((s) => ({ id: s.id, name: s.name, cards: s.cards.map(({ id, name, script }) => ({ id, name, script })) })),
    currentStack: c.set.currentStack,
    current: c.set.current,
    replies,
  });
  const result = await runHandler(source, 'mouseUp', { host, globals: new Map(), scriptId: 'button-1' });
  return { result, host, goLine, outcome: observedStackOutcome(result, host, c, goLine) };
}

const callsOf = (host: FakeHost, call: HostCall['call']) => host.log.filter((x) => x.call === call);

// Feature: go-to-stack-command, Property 2: Stack navigation outcomes
describe('P2 stack navigation (go-to-stack-command Requirement 3, 4, 9.2–9.5)', () => {
  it('P2 stack navigation: every go to stack ends in exactly one of the three outcomes, the one the model expects, with one lookup and at most one move', async () => {
    await fc.assert(
      fc.asyncProperty(stackNavCaseArb, async (c) => {
        const { outcome, host } = await runStackCase(c);
        expect(outcome).toEqual(expectedStackOutcome(c));

        // One lookup with the text exactly as the model computed it, or none for the empty text (3.3, 3.5).
        const text = modelText(c);
        expect(callsOf(host, 'findStackByName')).toStrictEqual(text === '' ? [] : [{ call: 'findStackByName', name: text }]);

        // One goToStack with the matching stack's id and the generated effect, or none (3.7, 3.8, 4.1).
        const match = modelMatch(c);
        expect(callsOf(host, 'goToStack')).toStrictEqual(
          match === undefined
            ? []
            : [{ call: 'goToStack', id: c.set.stacks[match]!.id, ...(c.effect ? { effect: c.effect } : {}) }],
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('stack navigation generator (stack P2)', () => {
  const sample = fc.sample(stackNavCaseArb, { numRuns: 1000, seed: 12 });

  it('gives each of the three outcomes in at least 10% of cases', async () => {
    const counts: Record<StackOutcome['k'], number> = { opened: 0, goFailed: 0, openCardFailed: 0 };
    for (const c of sample) counts[(await runStackCase(c)).outcome.k]++;
    for (const [k, n] of Object.entries(counts)) expect(n / sample.length, k).toBeGreaterThanOrEqual(0.1);
  });

  it('agrees with the generator on which stack the text names, for every case', () => {
    for (const c of sample) {
      const match = modelMatch(c);
      const what = JSON.stringify(c.target);
      if (c.target.rel === 'missing') {
        expect(match, what).toBeUndefined();
        continue;
      }
      expect(match, what).toBeDefined();
      const { name } = c.set.stacks[match!]!;
      // As written is the name itself; other case differs from it, but only in case.
      expect(c.target.text === name, what).toBe(c.target.rel === 'asWritten');
    }
  });

  it('covers every way of naming a stack, the empty name, the current stack, one and several stacks, effects and all first-card scripts', () => {
    const seen = new Set<string>();
    for (const c of sample) {
      const { rel, via, text } = c.target;
      seen.add(`${rel} by ${via}`);
      if (text === '') seen.add('empty name');
      seen.add(c.set.stacks.length === 1 ? 'one stack' : 'several stacks');
      seen.add(c.effect ? 'with an effect' : 'without an effect');
      const match = modelMatch(c);
      if (match === undefined) continue;
      if (match + 1 === c.set.currentStack && c.set.current > 1) seen.add('the starting stack, from a card other than 1');
      seen.add(`first card ${c.set.stacks[match]!.cards[0]!.kind}`);
    }
    expect([...seen].sort()).toEqual(
      [
        'asWritten by literal', 'asWritten by ask', 'asWritten by number',
        'otherCase by literal', 'otherCase by ask',
        'missing by literal', 'missing by ask', 'missing by number',
        'empty name', 'the starting stack, from a card other than 1',
        'one stack', 'several stacks', 'with an effect', 'without an effect',
        'first card empty', 'first card valid', 'first card runtimeError', 'first card syntaxError',
      ].sort(),
    );
  });
});
