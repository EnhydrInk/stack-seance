import './helpers/noNetwork';
// Generator cross-checks (design.md, "Generator cross-checks"): the replies the property
// generators build to follow the rules do follow them, and the ones built to break a named rule
// do break it. Two example tests over a fixed seed, with no coverage thresholds.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkReply } from '../../src/compiler/rules';
import { brokenReplyArb, requestArb, validReplyArb } from './helpers/arbitraries';

const SAMPLES = 1000;

describe('generator cross-checks', () => {
  it('every validReplyArb reply passes checkReply, with its own values', () => {
    const sample = fc.sample(requestArb.chain((request) => validReplyArb(request).map((reply) => ({ request, reply }))), {
      numRuns: SAMPLES,
      seed: 21,
    });
    const failures = sample.flatMap(({ request, reply }) => {
      const result = checkReply(request, reply.text);
      const expected = reply.object.hasButton
        ? { kind: 'button', label: reply.object.label, script: reply.object.script, newCards: reply.object.newCards, skipped: reply.object.skipped }
        : { kind: 'nothing', skipped: reply.object.skipped };
      return result.ok && JSON.stringify(result.reply) === JSON.stringify(expected)
        ? []
        : [{ request, text: reply.text, result }];
    });
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it('every brokenReplyArb reply fails checkReply with a report for its tagged rule', () => {
    const sample = fc.sample(requestArb.chain((request) => brokenReplyArb(request).map((reply) => ({ request, reply }))), {
      numRuns: SAMPLES,
      seed: 22,
    });
    const failures = sample.flatMap(({ request, reply }) => {
      const result = checkReply(request, reply.text);
      return !result.ok && result.reports.some((r) => r.rule === reply.rule)
        ? []
        : [{ rule: reply.rule, how: reply.how, request, text: reply.text, result }];
    });
    expect(failures.slice(0, 3)).toEqual([]);
  });
});
