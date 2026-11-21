// Task 10.3: property P6 (global sharing). A button's mouseUp stores a value in a global and
// goes to another card. That card's handler reads the global, either as the openCard the go
// starts or as a later click in the same session. Locals with the same name stay apart.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runHandler } from '../../src/hypertalk/runtime';
import { toStr, type Value } from '../../src/hypertalk/values';
import { FakeHost } from './helpers/fakeHost';
import { nameArb, textArb } from './helpers/arbitraries';

interface GlobalCase {
  cardCount: number;
  /** 1-based cards: the writer's button is on one, the reader's script on another. */
  writer: number;
  reader: number;
  /** The reader runs as the openCard of the writer's go, or as a click after it. */
  via: 'openCard' | 'mouseUp';
  /** One variable name, spelled in six random cases (R1.8). */
  names: string[];
  /** The global's value as written in the script, and as stored. */
  value: { literal: string; stored: Value };
  /** What the writer and the reader put into their own locals of that name. */
  writerLocal: string;
  readerLocal: string;
}

const valueArb = fc.oneof(
  textArb.filter((t) => t !== '').map((t) => ({ literal: `"${t}"`, stored: t as Value })),
  fc.integer({ min: 0, max: 9999 }).map((n) => ({ literal: String(n), stored: n as Value })),
);

const globalCaseArb: fc.Arbitrary<GlobalCase> = fc
  .integer({ min: 2, max: 5 })
  .chain((cardCount) =>
    fc.record({
      cardCount: fc.constant(cardCount),
      cards: fc.uniqueArray(fc.integer({ min: 1, max: cardCount }), { minLength: 2, maxLength: 2 }),
      via: fc.constantFrom<GlobalCase['via']>('openCard', 'mouseUp'),
      names: nameArb.chain((name) => fc.array(fc.mixedCase(fc.constant(name)), { minLength: 6, maxLength: 6 })),
      value: valueArb,
      writerLocal: textArb.filter((t) => t !== ''),
      readerLocal: textArb.filter((t) => t !== ''),
    }),
  )
  .map(({ cards: [writer, reader], ...rest }): GlobalCase => ({ ...rest, writer: writer!, reader: reader! }))
  .filter((c) => new Set([toStr(c.value.stored), c.writerLocal, c.readerLocal]).size === 3);

const lines = (...ls: string[]) => ls.join('\n');

function scripts(c: GlobalCase) {
  const [n0, n1, n2, n3, n4, n5] = c.names;
  const writer = lines(
    'on mouseUp',
    `  put "${c.writerLocal}" into ${n0}`, // a local: the name is not declared global yet
    `  global ${n1}`,
    `  put ${c.value.literal} into ${n2}`,
    `  go to card ${c.reader}`,
    'end mouseUp',
  );
  const reader = lines(
    `on ${c.via}`,
    `  put ${n3} into field "before"`, // a fresh local of this run: empty
    `  put "${c.readerLocal}" into ${n3}`,
    `  global ${n4}`,
    `  put ${n5} into field "after"`,
    `end ${c.via}`,
  );
  return { writer, reader };
}

async function runCase(c: GlobalCase) {
  const { writer, reader } = scripts(c);
  const host = new FakeHost({
    cards: Array.from({ length: c.cardCount }, (_, i) =>
      i + 1 === c.reader
        ? { script: reader, fields: [{ name: 'before', text: '?' }, { name: 'after', text: '?' }] }
        : {},
    ),
    current: c.writer,
  });
  // One session: the same global store for every handler run (R8.2).
  const globals = new Map<string, Value>();
  const results = [await runHandler(writer, 'mouseUp', { host, globals, scriptId: 'button-1' })];
  if (c.via === 'mouseUp') {
    results.push(await runHandler(reader, 'mouseUp', { host, globals, scriptId: `card-${c.reader}` }));
  }
  return { host, globals, results };
}

describe('P6 global sharing (R8.1, R8.2, R14.2)', () => {
  it('P6 global sharing: a handler on another card reads the global, and same-named locals are not shared', async () => {
    await fc.assert(
      fc.asyncProperty(globalCaseArb, async (c) => {
        const { host, globals, results } = await runCase(c);
        expect(results.every((r) => r.ok), JSON.stringify(results)).toBe(true);
        expect(host.state.current).toBe(c.reader);
        // Neither the writer's local nor the global is visible before the reader's `global`.
        expect(host.fieldText('before')).toBe('');
        expect(host.fieldText('after')).toBe(toStr(c.value.stored));
        // The store holds the global's value, unchanged by either local and keeping its type.
        expect([...globals]).toStrictEqual([[c.names[0]!.toLowerCase(), c.value.stored]]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('global case generator (P6)', () => {
  it('covers both ways the reader runs, string and number values, and readers before and after the writer', () => {
    const seen = new Set<string>();
    for (const c of fc.sample(globalCaseArb, { numRuns: 300, seed: 6 })) {
      seen.add(c.via);
      seen.add(typeof c.value.stored);
      seen.add(c.reader < c.writer ? 'reader first' : 'writer first');
      if (new Set(c.names).size > 1) seen.add('mixed case');
    }
    expect([...seen].sort()).toEqual(
      ['openCard', 'mouseUp', 'string', 'number', 'reader first', 'writer first', 'mixed case'].sort(),
    );
  });
});
