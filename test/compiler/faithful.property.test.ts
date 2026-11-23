import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compile } from '../../src/compiler/compile';
import { brokenReplyArb, requestArb, validReplyArb } from './helpers/arbitraries';
import { replyStep, scriptedAsk } from './helpers/fakeModel';

describe('Property 2: Faithful', () => {
  // Feature: sentence-compiler, Property 2: Faithful
  it('P2 faithful: the result holds the valid reply\'s own script, label, newCards and skipped', async () => {
    const caseArb = requestArb.chain((request) =>
      fc.record({
        request: fc.constant(request),
        before: fc.array(brokenReplyArb(request), { maxLength: 2 }),
        valid: validReplyArb(request),
      }),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ request, before, valid }) => {
        // The valid reply sits at call 1, 2 or 3, after the broken ones.
        const { ask, inputs } = scriptedAsk([...before.map((b) => replyStep(b.text)), replyStep(valid.text)]);
        const outcome = await compile(request, ask);
        const reply = JSON.parse(valid.text);

        expect(inputs).toHaveLength(before.length + 1);
        if (reply.hasButton) {
          if (!outcome.ok) throw new Error(`expected ok: true, got ${JSON.stringify(outcome)}`);
          expect(outcome.script).toStrictEqual(reply.script);
          expect(outcome.label).toStrictEqual(reply.label);
          expect(outcome.newCards).toStrictEqual(reply.newCards);
          expect(outcome.skipped).toStrictEqual(reply.skipped);
        } else {
          if (outcome.ok || outcome.error !== 'nothing') throw new Error(`expected nothing, got ${JSON.stringify(outcome)}`);
          expect(outcome.skipped).toStrictEqual(reply.skipped);
        }
      }),
      { numRuns: 200 },
    );
  });
});
