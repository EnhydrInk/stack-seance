import './helpers/noNetwork';
// Generator cross-checks (design.md, "Generator cross-checks"): the replies the property
// generators build to follow the rules do follow them, and the ones built to break a named rule
// do break it. Example tests over a fixed seed, with no coverage thresholds: two for requests
// without a label, and the same two for requests with one (recompile-keeps-label).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkReply } from '../../src/compiler/rules';
import { brokenReplyArb, labelledRequestArb, requestArb, validReplyArb } from './helpers/arbitraries';

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

// recompile-keeps-label, Requirement 9.5: the same two checks for requests with a label.
describe('generator cross-checks with a label', () => {
  it('every validReplyArb reply passes checkReply with its own values, and every button keeps the label', () => {
    const sample = fc.sample(labelledRequestArb.chain((request) => validReplyArb(request).map((reply) => ({ request, reply }))), {
      numRuns: SAMPLES,
      seed: 23,
    });
    const failures = sample.flatMap(({ request, reply }) => {
      const result = checkReply(request, reply.text);
      const expected = reply.object.hasButton
        ? { kind: 'button', label: reply.object.label, script: reply.object.script, newCards: reply.object.newCards, skipped: reply.object.skipped }
        : { kind: 'nothing', skipped: reply.object.skipped };
      const keeps = !reply.object.hasButton || reply.object.label === request.label;
      return keeps && result.ok && JSON.stringify(result.reply) === JSON.stringify(expected)
        ? []
        : [{ request, text: reply.text, result }];
    });
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it('every brokenReplyArb reply fails checkReply with a report for its tagged rule', () => {
    const sample = fc.sample(labelledRequestArb.chain((request) => brokenReplyArb(request).map((reply) => ({ request, reply }))), {
      numRuns: SAMPLES,
      seed: 24,
    });
    const failures = sample.flatMap(({ request, reply }) => {
      const result = checkReply(request, reply.text);
      return !result.ok && result.reports.some((r) => r.rule === reply.rule)
        ? []
        : [{ rule: reply.rule, how: reply.how, request, text: reply.text, result }];
    });
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it('draws labels that are not English and both renaming breakers', () => {
    // Not a coverage threshold: it shows that the cases the property relies on are drawn at all.
    const labels = fc.sample(labelledRequestArb.map((r) => r.label!), { numRuns: SAMPLES, seed: 25 });
    expect(labels.some((l) => !/^[\x20-\x7E]*$/.test(l))).toBe(true);
    expect(labels.every((l) => l.length >= 1 && l.length <= 24 && /\S/.test(l))).toBe(true);
    const hows = fc.sample(labelledRequestArb.chain((r) => brokenReplyArb(r)).filter((b) => b.rule === 7).map((b) => b.how), { numRuns: 300, seed: 26 });
    expect(hows).toContain('a fresh English label');
    expect(hows).toContain('the label in other case');
  });
});
