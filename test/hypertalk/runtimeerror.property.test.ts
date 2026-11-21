// Task 10.2: property P5 (runtime error lines). It runs against runHandlerUnguarded, as P4
// runs against parseUnguarded, so the line guard in runHandler cannot hide a wrong line.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineCount, type ScriptError } from '../../src/hypertalk/errors';
import { MAX_OPEN_CARD_DEPTH, runHandler, runHandlerUnguarded } from '../../src/hypertalk/runtime';
import { FakeHost } from './helpers/fakeHost';
import { sessionArb, type Session } from './helpers/arbitraries';

const ctx = (host: FakeHost, session: Session) => ({ host, globals: new Map(session.globals), scriptId: 'button-1' });

/** The script an error comes from: the one that was run, or the card script its scriptId names (R12.5). */
function scriptOf(error: ScriptError, session: Session, host: FakeHost): string {
  if (error.scriptId === undefined) return session.source;
  const card = host.state.cards.find((c) => c.id === error.scriptId);
  if (!card) throw new Error(`no card has the script id ${error.scriptId}`);
  return card.script;
}

/** True when a line holds a command, not only blanks or a comment (R11.9). */
function holdsCode(line: string): boolean {
  return line.replace(/"[^"]*"/g, '""').split('--')[0]!.trim() !== '';
}

describe('P5 runtime error lines (R12.1, R12.5)', () => {
  it('P5 runtime error lines: every error names a line in 1..lineCount of the script it comes from', async () => {
    await fc.assert(
      fc.asyncProperty(sessionArb, async (session) => {
        const host = new FakeHost(session.host);
        const result = await runHandlerUnguarded(session.source, 'mouseUp', ctx(host, session));
        fc.pre(!result.ok);
        if (result.ok) return;
        const { line } = result.error;
        const script = scriptOf(result.error, session, host);
        expect(Number.isInteger(line)).toBe(true);
        expect(line).toBeGreaterThanOrEqual(1);
        expect(line).toBeLessThanOrEqual(lineCount(script));
        // Stronger than the range: comments and blank lines must not shift the line.
        expect(holdsCode(script.split(/\r?\n/)[line - 1]!), `line ${line} of:\n${script}`).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('P5 runtime error lines: runHandler and runHandlerUnguarded agree, so the line guard never changes a value', async () => {
    await fc.assert(
      fc.asyncProperty(sessionArb, async (session) => {
        const guardedHost = new FakeHost(session.host);
        const unguardedHost = guardedHost.clone();
        const guarded = await runHandler(session.source, 'mouseUp', ctx(guardedHost, session));
        const unguarded = await runHandlerUnguarded(session.source, 'mouseUp', ctx(unguardedHost, session));
        expect(guarded).toStrictEqual(unguarded);
      }),
      { numRuns: 300 },
    );
  });
});

describe('session generator (P5)', () => {
  const sample = fc.sample(sessionArb, { numRuns: 1000, seed: 11 });

  it('fails often enough, from the script that ran and from card scripts, including the depth limit (R14.4)', async () => {
    const seen = new Set<string>();
    let failed = 0;
    for (const session of sample) {
      const host = new FakeHost(session.host);
      const result = await runHandlerUnguarded(session.source, 'mouseUp', ctx(host, session));
      if (result.ok) continue;
      failed++;
      const { kind, scriptId, message } = result.error;
      seen.add(`${scriptId === undefined ? 'run script' : 'card script'} ${kind}`);
      if (message.includes(`${MAX_OPEN_CARD_DEPTH} levels`)) seen.add('depth limit');
    }
    expect(failed / sample.length).toBeGreaterThanOrEqual(0.3);
    // The run script is valid, so its errors are runtime errors only.
    expect([...seen].sort()).toEqual(['card script runtime', 'card script syntax', 'depth limit', 'run script runtime'].sort());
  });
});
