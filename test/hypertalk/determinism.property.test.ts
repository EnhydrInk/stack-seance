// Task 10.1: property P3 (determinism). A generated session runs twice, from identical
// copies of the stack, the dialog replies and the globals, and both runs end the same.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runHandler } from '../../src/hypertalk/runtime';
import { HAUNTS } from '../../src/hypertalk/tokens';
import { FakeHost, type HostCall } from './helpers/fakeHost';
import { sessionArb, type Session } from './helpers/arbitraries';

/** Runs the session's mouseUp on `host` and returns everything the run can change or report. */
async function runOn(session: Session, host: FakeHost) {
  const globals = new Map(session.globals);
  const result = await runHandler(session.source, 'mouseUp', { host, globals, scriptId: 'button-1' });
  return { result, state: host.state, replies: host.replies, log: host.log, globals: [...globals] };
}

describe('P3 determinism (R10, R13, R15.2)', () => {
  it('P3 determinism: two runs from identical copies give equal state, results, globals and call logs', async () => {
    await fc.assert(
      fc.asyncProperty(sessionArb, async (session) => {
        const first = new FakeHost(session.host);
        const second = first.clone();
        expect(second.state).toStrictEqual(first.state);
        const a = await runOn(session, first);
        const b = await runOn(session, second);
        // The logs include every haunt call with its kind (10.1a).
        expect(b).toStrictEqual(a);
      }),
      { numRuns: 300 },
    );
  });
});

describe('session generator (P3)', () => {
  const sample = fc.sample(sessionArb, { numRuns: 500, seed: 10 });
  const runs = Promise.all(sample.map((session) => runOn(session, new FakeHost(session.host))));

  it('reaches every host call and every haunt kind', async () => {
    const calls = new Set<HostCall['call']>();
    const haunts = new Set<string>();
    for (const { log } of await runs) {
      for (const c of log) {
        calls.add(c.call);
        if (c.call === 'haunt') haunts.add(c.kind);
      }
    }
    expect([...calls].sort()).toEqual(
      [
        'cardCount', 'currentCard', 'findCardByName', 'cardAt', 'goToCard', 'getField', 'setField',
        'setVisible', 'answer', 'ask', 'wait', 'haunt', 'getCardScript',
      ].sort(),
    );
    expect([...haunts].sort()).toEqual(HAUNTS.map((h) => h.kind).sort());
  });

  it('lets most runs get somewhere: many end without an error, many make five host calls or more', async () => {
    const done = await runs;
    expect(done.filter((r) => r.result.ok).length / done.length).toBeGreaterThanOrEqual(0.3);
    expect(done.filter((r) => r.log.length >= 5).length / done.length).toBeGreaterThanOrEqual(0.2);
  });

  it('changes globals and uses dialog replies in some runs', async () => {
    const done = await runs;
    expect(done.some((r, i) => JSON.stringify(r.globals) !== JSON.stringify(sample[i]!.globals))).toBe(true);
    expect(done.some((r, i) => r.replies.length < (sample[i]!.host.replies?.length ?? 0))).toBe(true);
  });
});
