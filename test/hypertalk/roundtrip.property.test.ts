import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../src/hypertalk/parser';
import { print } from '../../src/hypertalk/printer';
import { stripPositions, type Script } from '../../src/hypertalk/ast';
import {
  renderScript,
  scriptArb,
  sessionArb,
  simpleStmtArb,
  exprArb,
  type I,
  type Sc,
} from './helpers/arbitraries';
import { oneLineIfFollowers } from './helpers/ifShapes';

function ok(source: string): Script {
  const result = parse(source);
  if (!result.ok) {
    throw new Error(`expected a tree, got ${JSON.stringify(result.error)} for:\n${source}`);
  }
  return result.script;
}

const sourceArb = fc
  .tuple(scriptArb, fc.integer())
  .map(([ast, seed]) => ({ ast, seed, source: renderScript(ast, seed) }));

describe('P1 round trip', () => {
  it('P1 round trip: parse(print(parse(s))) equals parse(s) for rendered sources', () => {
    fc.assert(
      fc.property(sourceArb, ({ source }) => {
        const tree = stripPositions(ok(source));
        expect(stripPositions(ok(print(ok(source))))).toEqual(tree);
      }),
      { numRuns: 400 },
    );
  });

  it('P1 round trip: print(parse(print(ast))) equals print(ast) for generated trees', () => {
    fc.assert(
      fc.property(scriptArb, (ast) => {
        const printed = print(ast);
        expect(print(ok(printed))).toBe(printed);
      }),
      { numRuns: 400 },
    );
  });

  it('P1 round trip: every rendering of a tree parses like its canonical print', () => {
    // Case, spacing, comments, blank lines, CRLF, optional "to", second/seconds, one-line ifs
    // and else-if chains must not change the tree. Redundant parentheses are off because
    // they add paren nodes on purpose.
    fc.assert(
      fc.property(scriptArb, fc.integer(), (ast, seed) => {
        const canonical = stripPositions(ok(print(ast)));
        const source = renderScript(ast, seed, { redundantParens: false });
        expect(stripPositions(ok(source))).toEqual(canonical);
      }),
      { numRuns: 300 },
    );
  });
});

describe('R9.3 one-line and block if', () => {
  const shortIfArb = fc
    .tuple(exprArb, simpleStmtArb, fc.option(simpleStmtArb))
    .map(([cond, s, e]): I => ({ t: 'if', cond, then: [s], else: e ? [e] : [] }));

  it('P1 round trip: an if that fits on one line gives the same tree in both forms', () => {
    fc.assert(
      fc.property(shortIfArb, fc.integer(), (stmt, seed) => {
        const ast: Sc = { handlers: [{ name: 'mouseUp', body: [stmt] }] };
        // Redundant parentheses off: they would add paren nodes to one side only.
        const oneLine = renderScript(ast, seed, { ifForm: 'oneLine', redundantParens: false });
        const block = renderScript(ast, seed, { ifForm: 'block', redundantParens: false });
        const codeLines = (s: string) =>
          s.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('--')).length;
        expect(codeLines(oneLine)).toBe(3); // on mouseUp, the if, end mouseUp
        expect(codeLines(block)).toBeGreaterThan(3);
        expect(stripPositions(ok(oneLine))).toEqual(stripPositions(ok(block)));
      }),
      { numRuns: 300 },
    );
  });
});

describe('generator coverage', () => {
  it('produces every statement kind, both if forms, chains and nesting', () => {
    const seen = new Set<string>();
    const visit = (stmts: Sc['handlers'][number]['body'], depth: number) => {
      for (const s of stmts) {
        seen.add(s.t);
        if (s.t === 'if') {
          if (s.else.length === 1 && s.else[0]!.t === 'if') seen.add('chain');
          if (depth >= 3) seen.add('nested 4 deep');
          visit(s.then, depth + 1);
          visit(s.else, depth + 1);
        }
      }
    };
    for (const ast of fc.sample(scriptArb, { numRuns: 400, seed: 1 })) {
      for (const h of ast.handlers) visit(h.body, 0);
    }
    for (const kind of ['go', 'effect', 'answer', 'ask', 'putField', 'putVar', 'show', 'hide', 'wait', 'global', 'haunt', 'if', 'chain', 'nested 4 deep']) {
      expect(seen, kind).toContain(kind);
    }
  });

  // nested-if-else-attachment-fix: the parser rejects a one-line if without else right
  // before an else or else if line, so rendered valid scripts must not have one.
  const renderings = fc
    .sample(fc.tuple(scriptArb, fc.integer()), { numRuns: 2000, seed: 1 })
    .map(([ast, seed]) => renderScript(ast, seed));
  const runScripts = fc.sample(sessionArb, { numRuns: 1000, seed: 11 }).map((s) => s.source);

  // Expected to fail until the renderer change (task 3.1 removes .fails).
  it.fails('never writes a one-line if without else directly before an else or else if line (2.1, 2.3)', () => {
    const rejected = (sources: string[]) => sources.filter((s) => oneLineIfFollowers(s).elseAfterNoElse > 0);
    const badRenderings = rejected(renderings);
    const badRunScripts = rejected(runScripts);
    const shortest = [...badRenderings, ...badRunScripts].sort((a, b) => a.length - b.length)[0];
    expect(
      { scriptArbRenderings: badRenderings.length, sessionArbRunScripts: badRunScripts.length },
      `the shortest one:\n${shortest}`,
    ).toEqual({ scriptArbRenderings: 0, sessionArbRunScripts: 0 });
  });

  it('still writes a one-line if with its own else before an else line (3.2) and a one-line if before end if (3.3)', () => {
    const counts = renderings.map(oneLineIfFollowers);
    expect(counts.filter((c) => c.elseAfterOwnElse > 0).length, '3.2').toBeGreaterThan(0);
    expect(counts.filter((c) => c.endIfAfter > 0).length, '3.3').toBeGreaterThan(0);
  });
});
