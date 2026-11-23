import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compile } from '../../src/compiler/compile';
import { newCardCandidateArb, requestArb } from './helpers/arbitraries';
import { refusalStep, replyStep, scriptedAsk } from './helpers/fakeModel';

/** Unique ignoring case, by this test's own lowercase set rather than the compiler's helpers. */
function uniqueIgnoringCase(names: readonly string[]): boolean {
  return new Set(names.map((n) => n.toLowerCase())).size === names.length;
}

describe('Property 3: Unique card names', () => {
  // Feature: sentence-compiler, Property 3: Unique card names
  it('P3 unique card names: the existing cards followed by the accepted newCards are unique ignoring case', async () => {
    let accepted = 0;
    let rejected = 0;
    // requestArb's card names are unique ignoring case, and sometimes one of them is empty.
    const caseArb = requestArb.chain((request) => newCardCandidateArb(request.cardNames).map((candidate) => ({ request, candidate })));
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ request, candidate }) => {
        expect(uniqueIgnoringCase(request.cardNames)).toBe(true);
        // The candidate, then a Refusal, so a rejected candidate ends in model after one retry.
        const { ask } = scriptedAsk([replyStep(candidate.text), refusalStep()]);
        const result = await compile(request, ask);
        if (!result.ok) {
          rejected++;
          return;
        }
        accepted++;
        expect(uniqueIgnoringCase([...request.cardNames, ...result.newCards])).toBe(true);
      }),
      { numRuns: 300 },
    );
    // The candidates collide on purpose, but not always.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});
