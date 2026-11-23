import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compile, MAX_MODEL_CALLS } from '../../src/compiler/compile';
import type { CompileOutcome } from '../../src/compiler/contract';
import type { ModelInput } from '../../src/compiler/model';
import { SYSTEM_PROMPT, userMessage } from '../../src/compiler/prompt';
import { REPLY_SCHEMA } from '../../src/compiler/schema';
import { requestArb, stepsArb, toStep, type GenStep } from './helpers/arbitraries';
import { scriptedAsk } from './helpers/fakeModel';

/**
 * What compile should do with these steps, from how each step was built and never from the
 * compiler's Rule_Checker (Requirement 13.2): walk the first three steps; a rejected call or a
 * Refusal gives model, a reply built to follow the rules gives its outcome, and a broken reply
 * moves on. Three broken replies give model.
 */
function expected(steps: readonly GenStep[]): { outcome: CompileOutcome; calls: number } {
  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    const step = steps[i]!;
    const calls = i + 1;
    switch (step.tag) {
      case 'reject':
      case 'refusal':
        return { outcome: { ok: false, error: 'model' }, calls };
      case 'valid': {
        const { hasButton, label, script, newCards, skipped } = step.reply.object;
        return hasButton
          ? { outcome: { ok: true, label, script, newCards, skipped }, calls }
          : { outcome: { ok: false, error: 'nothing', skipped }, calls };
      }
      case 'broken':
        continue;
    }
  }
  return { outcome: { ok: false, error: 'model' }, calls: MAX_MODEL_CALLS };
}

/** Each call's messages are the previous call's, then that step's turn and a Retry_Message naming its rule. */
function expectGrowth(inputs: readonly ModelInput[], steps: readonly GenStep[], first: string): void {
  expect(inputs[0]!.messages).toStrictEqual([{ role: 'user', text: first }]);
  for (let k = 1; k < inputs.length; k++) {
    const previous = inputs[k - 1]!.messages;
    const messages = inputs[k]!.messages;
    const step = steps[k - 1]!;
    if (step.tag !== 'broken') throw new Error(`call ${k + 1} was made after a ${step.tag} step`);

    expect(messages).toHaveLength(previous.length + 2);
    previous.forEach((message, i) => expect(messages[i]).toBe(message));
    const turn = messages[previous.length]!;
    const retry = messages[previous.length + 1]!;
    expect(turn.role).toBe('assistant');
    if (turn.role === 'assistant') expect(turn.turn).toBe(step.turn);
    expect(retry.role).toBe('user');
    if (retry.role === 'user') expect(retry.text).toContain(`\nRule ${step.reply.rule}: `);
  }
}

describe('Property 1: Safety', () => {
  // Feature: sentence-compiler, Property 1: Safety
  it('P1 safety: compile returns exactly what the steps were built to give, in at most three calls', async () => {
    const caseArb = requestArb.chain((request) => stepsArb(request).map((steps) => ({ request, steps })));
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ request, steps }) => {
        const { ask, inputs } = scriptedAsk(steps.map(toStep));
        const outcome = await compile(request, ask);
        const model = expected(steps);

        expect(outcome).toStrictEqual(model.outcome);
        // The number of calls is the number of steps the walk used, so later steps are never played.
        expect(inputs).toHaveLength(model.calls);
        expect(inputs.length).toBeLessThanOrEqual(MAX_MODEL_CALLS);
        for (const input of inputs) {
          expect(input.system).toBe(SYSTEM_PROMPT);
          expect(input.schema).toBe(REPLY_SCHEMA);
        }
        expectGrowth(inputs, steps, userMessage(request));
      }),
      { numRuns: 300 },
    );
  });
});
