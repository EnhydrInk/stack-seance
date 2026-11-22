// nested-if-else-attachment-fix (design: "Correctness Properties").
// Property 1: inside a block if, an else or else if line right after a one-line if without
// else is a syntax error on that else, and an unmatched else or end if after a stray end if
// in the same handler is reported on the last stray end if. parse, parseUnguarded and
// runHandler all return that error, and running the script calls the host for nothing.
// Property 2: every other script of the same shapes parses exactly as the unfixed parser does.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { stripPositions } from '../../src/hypertalk/ast';
import { tokenize } from '../../src/hypertalk/lexer';
import { parse, parseUnguarded, type ParseResult } from '../../src/hypertalk/parser';
import { runHandler } from '../../src/hypertalk/runtime';
import { FakeHost } from './helpers/fakeHost';
import { bugShapeArb, preservedShapeArb, type ExpectedParse, type IfShape } from './helpers/ifShapes';

/**
 * The generator checks: the source lexes, the expected error is on an `else`, or on the
 * `end` of an `end if`, and for an end if the line it names starts with the `if` it closed.
 */
function checkShape(shape: IfShape): void {
  const lexed = tokenize(shape.source);
  if (!lexed.ok) throw new Error(`generator: the source does not lex\n${shape.source}`);
  const { tokens } = lexed;
  const indexAt = (line: number, column: number) => tokens.findIndex((t) => t.line === line && t.column === column);
  const wordAt = (i: number) => {
    const t = i < 0 ? undefined : tokens[i];
    return t?.kind === 'word' ? t.text.toLowerCase() : undefined;
  };
  const k = indexAt(shape.error.line, shape.error.column);
  if (shape.family === 'else') {
    expect(wordAt(k), `generator: the error is on an else\n${shape.source}`).toBe('else');
    return;
  }
  expect([wordAt(k), wordAt(k + 1)], `generator: the error is on an end if\n${shape.source}`).toEqual(['end', 'if']);
  const closes = shape.closes!;
  expect(wordAt(indexAt(closes.line, closes.column)), `generator: the named line starts with if\n${shape.source}`).toBe('if');
}

describe('Property 1: an else or end if line right after a one-line if inside a block if (2.1, 2.2, 2.3, 2.4)', () => {
  it('parseUnguarded, parse and runHandler return the expected syntax error, and the host is never called', async () => {
    await fc.assert(
      fc.asyncProperty(bugShapeArb, async (shape) => {
        checkShape(shape);
        const expected = { ok: false, error: shape.error };

        const result = parseUnguarded(shape.source);
        expect(result).toEqual(expected);
        expect(parse(shape.source)).toEqual(result);

        const host = new FakeHost({ cards: [{}, {}] });
        const ran = await runHandler(shape.source, shape.handler, { host, globals: new Map(), scriptId: 'button-1' });
        expect(ran).toEqual(expected);
        expect(host.log).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('if shape generator (Property 1)', () => {
  it('writes every ended block and follower of family A, and every unmatched line of family B', () => {
    const seen = new Set(fc.sample(bugShapeArb, { numRuns: 500, seed: 7 }).map((s) => `${s.family}: ${s.detail}`));
    const blocks = ['then part', 'else if link', 'else part'];
    const expected = [
      ...blocks.flatMap((b) => [`else: ${b}, then else`, `else: ${b}, then else if`]),
      'end if: unmatched end if',
      'end if: unmatched else',
      'end if: unmatched else if',
    ];
    expect([...seen].sort()).toEqual(expected.sort());
  });
});

/** A parse result with the tree's positions removed, to compare with a shape's expected result. */
function withoutPositions(result: ParseResult): ExpectedParse {
  return result.ok ? { ok: true, script: stripPositions(result.script) } : result;
}

describe('Property 2: every other script parses as before (3.1 to 3.11)', () => {
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**
  // The expected results were checked against the unfixed parser before the fix.
  it('parseUnguarded returns the same tree or the same error as the unfixed parser, and parse agrees', () => {
    fc.assert(
      fc.property(preservedShapeArb, (shape) => {
        const result = parseUnguarded(shape.source);
        expect(withoutPositions(result), `${shape.family}: ${shape.detail}\n${shape.source}`).toEqual(shape.expected);
        expect(parse(shape.source)).toEqual(result);
      }),
      { numRuns: 300 },
    );
  });
});

describe('if shape generator (Property 2)', () => {
  it('writes every case of families A, B and C', () => {
    const seen = new Set(fc.sample(preservedShapeArb, { numRuns: 2000, seed: 7 }).map((s) => `${s.family}: ${s.detail}`));
    const lasts = ['a command', 'a block if', 'a block if closed right after a one-line if', 'a one-line if with else'];
    const expected = [
      ...['then part', 'else if link', 'else part'].flatMap((block) =>
        lasts.flatMap((last) => ['else', 'else if'].map((follower) => `A: ${block} ends with ${last}, then ${follower}`)),
      ),
      ...['end if', 'else', 'else if'].flatMap((u) => [
        `B: no stray end if, then unmatched ${u}`,
        `B: no stray end if here, one in the other handler, then unmatched ${u}`,
        `B: a stray end if, then a one-line if, then unmatched ${u}`,
      ]),
      'C: with a stray end if',
      'C: without a stray end if',
    ];
    expect([...seen].sort()).toEqual(expected.sort());
  });
});
