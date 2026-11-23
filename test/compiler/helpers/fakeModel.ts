// A fake Ask that plays a fixed list of steps (design.md, "Helpers").
import { expect } from 'vitest';
import type { Ask, ModelInput } from '../../../src/compiler/model';

export type Step =
  | { kind: 'reply'; text: string; turn: unknown }
  | { kind: 'refusal' }
  | { kind: 'reject'; error: unknown };

/** A finished reply. The default turn is a new object, so a test can check that it comes back as the same one. */
export function replyStep(text: string, turn: unknown = { content: [{ type: 'text', text }] }): Step {
  return { kind: 'reply', text, turn };
}

export function refusalStep(): Step {
  return { kind: 'refusal' };
}

export function rejectStep(error: unknown = new Error('the API call failed')): Step {
  return { kind: 'reject', error };
}

/**
 * An Ask that plays `steps` in order, and the ModelInput objects it received, kept as they were
 * passed. That is safe because `compile` gives every call a new messages array and never changes
 * a message, and it lets a test check that a turn comes back as the same object.
 * A call past the last step fails the test, even though `compile` turns the throw into `model`.
 */
export function scriptedAsk(steps: readonly Step[]): { ask: Ask; inputs: ModelInput[] } {
  const inputs: ModelInput[] = [];
  const ask: Ask = async (input) => {
    inputs.push(input);
    const step = steps[inputs.length - 1];
    if (step === undefined) {
      expect.soft(inputs.length, 'scriptedAsk was called past its last step').toBeLessThanOrEqual(steps.length);
      throw new Error(`scriptedAsk was called ${inputs.length} times but has ${steps.length} steps`);
    }
    switch (step.kind) {
      case 'reply':
        return { kind: 'reply', text: step.text, turn: step.turn };
      case 'refusal':
        return { kind: 'refusal' };
      case 'reject':
        throw step.error;
    }
  };
  return { ask, inputs };
}
