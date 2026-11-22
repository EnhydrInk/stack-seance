import { describe, it, expect } from 'vitest';
import { parse, parseUnguarded } from '../../src/hypertalk/parser';
import { stripPositions, type Expr, type IfStmt, type Script, type Stmt } from '../../src/hypertalk/ast';
import { lineCount, type SyntaxError } from '../../src/hypertalk/errors';
import { HAUNTS, isReserved } from '../../src/hypertalk/tokens';
import { handlerSource, REPRO_1, REPROS } from './helpers/lexMask';
import {
  ELSE_AFTER_ONE_LINE_IF,
  ONE_LINE_IF_REPRO_1,
  ONE_LINE_IF_REPRO_2,
  strayEndIfMessage,
  UNMATCHED_END_IF,
} from './helpers/ifShapes';

const src = (...lines: string[]) => lines.join('\n');

/** Wraps lines in `on mouseUp … end mouseUp`, so the first given line is line 2. */
const inHandler = (...lines: string[]) => src('on mouseUp', ...lines.map((l) => `  ${l}`), 'end mouseUp');

function ok(source: string): Script {
  const result = parse(source);
  if (!result.ok) throw new Error(`expected a tree, got ${JSON.stringify(result.error)}`);
  return result.script;
}

function err(source: string): SyntaxError {
  const result = parse(source);
  if (result.ok) throw new Error(`expected a syntax error for:\n${source}`);
  return result.error;
}

function stmts(...lines: string[]): Stmt[] {
  return ok(inHandler(...lines)).handlers[0]!.body;
}

const body = (...lines: string[]) => stripPositions(stmts(...lines));

/** The expression of `put <text> into x`. */
function exprOf(text: string): Expr {
  const s = stmts(`put ${text} into x`)[0];
  if (s?.t !== 'putVar') throw new Error('expected put … into');
  return s.value;
}

/** Compact form of an expression tree: (op left right), [paren], #true. */
function sx(e: Expr): string {
  switch (e.t) {
    case 'str': return JSON.stringify(e.value);
    case 'num': return String(e.value);
    case 'bool': return e.value ? '#true' : '#false';
    case 'var': return e.name;
    case 'field': return `field(${JSON.stringify(e.name)})`;
    case 'bin': return `(${e.op} ${sx(e.left)} ${sx(e.right)})`;
    case 'not': return `(not ${sx(e.operand)})`;
    case 'paren': return `[${sx(e.inner)}]`;
  }
}

const ex = (text: string) => sx(exprOf(text));

describe('R1 handlers', () => {
  it('accepts mouseUp and openCard handlers, with and without statements', () => {
    const script = ok(src('on mouseUp', '  go to next card', 'end mouseUp', '', 'on openCard', 'end openCard'));
    expect(script.handlers.map((h) => [h.name, h.pos.line, h.body.length])).toEqual([
      ['mouseUp', 1, 1],
      ['openCard', 5, 0],
    ]);
  });

  it('accepts an empty script, a blank script and a script of comments', () => {
    expect(ok('').handlers).toEqual([]);
    expect(ok('\n\n   \n').handlers).toEqual([]);
    expect(ok('-- nothing here yet\n').handlers).toEqual([]);
  });

  it('reads keywords and handler names in any case', () => {
    const script = ok(src('ON MOUSEUP', '  GO TO NEXT CARD', 'End MouseUp'));
    expect(stripPositions(script)).toEqual({
      handlers: [{ name: 'mouseUp', body: [{ t: 'go', target: { k: 'next' } }] }],
    });
  });

  it('R1.3 reports an end with a different name on the end line', () => {
    const e = err(src('on mouseUp', '  go to next card', 'end openCard'));
    expect(e).toMatchObject({ kind: 'syntax', line: 3, column: 1 });
    expect(e.message).toBe('expected "end mouseUp" but found "end openCard"');
  });

  it('R1.4 reports an unknown handler name on the on line', () => {
    const e = err(src('on mouseDown', '  go to next card', 'end mouseDown'));
    expect(e).toMatchObject({ line: 1, column: 4 });
    expect(e.message).toContain('v1 supports mouseUp and openCard');
  });

  it('R1.5 reports an unclosed handler on the line of its on', () => {
    expect(err(src('on mouseUp', '  go to next card', '', ''))).toMatchObject({ line: 1, column: 1 });
    const e = err(src('', '  on openCard', '    answer "hi"'));
    expect(e).toMatchObject({ line: 2, column: 3 });
    expect(e.message).toBe('"on openCard" is never closed; add "end openCard"');
  });

  it('R1.6 reports a second handler of the same name on its on line', () => {
    const e = err(src('on mouseUp', 'end mouseUp', 'on MOUSEUP', 'end mouseUp'));
    expect(e).toMatchObject({ line: 3, column: 1 });
    expect(e.message).toContain('already has an "on mouseUp"');
  });

  it('reports commands outside a handler', () => {
    expect(err('go to next card')).toMatchObject({ line: 1, column: 1 });
    expect(err('go to next card').message).toContain('inside a handler');
    expect(err(src('on mouseUp', 'end mouseUp', 'answer "x"'))).toMatchObject({ line: 3 });
  });

  it('reports a new handler that starts before the last one ends', () => {
    const e = err(src('on mouseUp', '  go to next card', 'on openCard', 'end openCard'));
    expect(e).toMatchObject({ line: 3, column: 1 });
    expect(e.message).toContain('add "end mouseUp" before it');
  });

  it('reports a stray end and extra words after on or end', () => {
    expect(err('end mouseUp')).toMatchObject({ line: 1, column: 1 });
    expect(err(src('on mouseUp now', 'end mouseUp'))).toMatchObject({ line: 1, column: 12 });
    expect(err(src('on mouseUp', 'end mouseUp now'))).toMatchObject({ line: 2, column: 13 });
  });
});

describe('R2.1 go', () => {
  it('accepts next, prev, first and last card, with or without to', () => {
    expect(body('go next card', 'go to prev card', 'go first card', 'go to last card').map((s) => s)).toEqual([
      { t: 'go', target: { k: 'next' } },
      { t: 'go', target: { k: 'prev' } },
      { t: 'go', target: { k: 'first' } },
      { t: 'go', target: { k: 'last' } },
    ]);
  });

  it('accepts go to card with a number, name, variable, field or parenthesised expression', () => {
    const targets = stmts(
      'go to card 3',
      'go card "Kitchen"',
      'go to card it',
      'go to card field "Room"',
      'go to card (n + 1)',
    ).map((s) => (s.t === 'go' && s.target.k === 'card' ? sx(s.target.expr) : '?'));
    expect(targets).toEqual(['3', '"Kitchen"', 'it', 'field("Room")', '[(+ n 1)]']);
  });

  it('reports a missing card word, a missing target and an unknown target', () => {
    const missingCard = err(inHandler('go to next'));
    expect(missingCard).toMatchObject({ line: 2, column: 13 });
    expect(missingCard.message).toBe('expected "card" after "next"');
    expect(err(inHandler('go to card'))).toMatchObject({ line: 2 });
    expect(err(inHandler('go to card')).message).toBe('expected a value after "card"');
    expect(err(inHandler('answer "x"', 'go home'))).toMatchObject({ line: 3, column: 6 });
  });

  it('asks for parentheses around a calculated card number', () => {
    const e = err(inHandler('go to card n + 1'));
    expect(e).toMatchObject({ line: 2, column: 16 });
    expect(e.message).toContain('in parentheses');
  });
});

describe('R3.1 visual effect', () => {
  it('accepts the five effects', () => {
    const effects = body(
      'visual effect dissolve',
      'visual effect wipe left',
      'visual effect wipe right',
      'visual effect iris open',
      'Visual Effect Iris Close',
    ).map((s) => (s.t === 'effect' ? s.effect : '?'));
    expect(effects).toEqual(['dissolve', 'wipeLeft', 'wipeRight', 'irisOpen', 'irisClose']);
  });

  it('reports unknown effects and directions on their line', () => {
    expect(err(inHandler('visual effect wipe up'))).toMatchObject({ line: 2, column: 22 });
    expect(err(inHandler('visual effect wipe up')).message).toBe('expected "left" or "right" after "wipe"');
    expect(err(inHandler('visual effect fade')).message).toContain('unknown visual effect');
    expect(err(inHandler('visual dissolve')).message).toBe('expected "effect" after "visual"');
  });
});

describe('R4 answer and ask', () => {
  it('R4.1 accepts zero to three labels', () => {
    const labels = body(
      'answer "Hi"',
      'answer "Continue?" with "Yes"',
      'answer "Pick one" with "A" or "B" or "C"',
    ).map((s) => (s.t === 'answer' ? s.labels : '?'));
    expect(labels).toEqual([[], ['Yes'], ['A', 'B', 'C']]);
  });

  it('parses the prompt as an expression that ends at with', () => {
    const [a, b] = stmts('answer "Room " & it with "OK"', 'answer a or b');
    expect(a?.t === 'answer' && sx(a.prompt)).toBe('(& "Room " it)');
    expect(b?.t === 'answer' && [sx(b.prompt), b.labels]).toEqual(['(or a b)', []]);
  });

  it('R4.2 reports a fourth label on its line', () => {
    const e = err(inHandler('go next card', 'answer "Pick" with "A" or "B" or "C" or "D"'));
    expect(e).toMatchObject({ line: 3, column: 43 });
    expect(e.message).toBe('answer can show at most 3 buttons');
  });

  it('reports a label that is not in quotes', () => {
    expect(err(inHandler('answer "x" with Yes'))).toMatchObject({ line: 2, column: 19 });
  });

  it('R4.3 accepts ask with an expression', () => {
    expect(body('ask "Which room?"')).toEqual([{ t: 'ask', prompt: { t: 'str', value: 'Which room?' } }]);
    expect(err(inHandler('ask "Which room?" with "1"')).message).toBe('unexpected "with" after the command');
  });
});

describe('R5 put', () => {
  it('R5.1 accepts into, after and before a field, and into a variable', () => {
    expect(body(
      'put "a" into field "Name"',
      'put "b" after field "Name"',
      'put "c" before field "Name"',
      'put 1 + 2 into total',
    )).toEqual([
      { t: 'putField', value: { t: 'str', value: 'a' }, mode: 'into', field: 'Name' },
      { t: 'putField', value: { t: 'str', value: 'b' }, mode: 'after', field: 'Name' },
      { t: 'putField', value: { t: 'str', value: 'c' }, mode: 'before', field: 'Name' },
      {
        t: 'putVar',
        value: { t: 'bin', op: '+', left: { t: 'num', value: 1 }, right: { t: 'num', value: 2 } },
        name: 'total',
      },
    ]);
  });

  it('R5.5 reports after or before a variable on its line', () => {
    const e = err(inHandler('go next card', 'put "x" after total'));
    expect(e).toMatchObject({ line: 3, column: 17 });
    expect(e.message).toContain('works only with fields in v1');
    expect(err(inHandler('put "x" before total'))).toMatchObject({ line: 2 });
  });

  it('reports a missing target and a field name without quotes', () => {
    expect(err(inHandler('put 1')).message).toBe('expected "into", "after" or "before" after the value');
    expect(err(inHandler('put 1 into field Name'))).toMatchObject({ line: 2, column: 20 });
  });
});

describe('R6.1 show and hide', () => {
  it('accepts buttons and fields', () => {
    expect(body('show button "Next"', 'hide field "Answer"')).toEqual([
      { t: 'show', kind: 'button', name: 'Next' },
      { t: 'hide', kind: 'field', name: 'Answer' },
    ]);
  });

  it('reports other objects and unquoted names', () => {
    expect(err(inHandler('show card "x"')).message).toBe('expected "button" or "field" after "show"');
    expect(err(inHandler('hide button Next'))).toMatchObject({ line: 2, column: 15 });
  });
});

describe('R7.1 wait', () => {
  it('accepts second and seconds with any expression', () => {
    const waits = stmts('wait 1 second', 'wait 2 seconds', 'wait n * 2 seconds').map((s) =>
      s.t === 'wait' ? sx(s.seconds) : '?',
    );
    expect(waits).toEqual(['1', '2', '(* n 2)']);
  });

  it('reports a missing unit on its line', () => {
    expect(err(inHandler('wait 2'))).toMatchObject({ line: 2 });
    expect(err(inHandler('wait 2')).message).toBe('expected "seconds" after the number');
  });
});

describe('R8 variables', () => {
  it('accepts global with one or more names', () => {
    expect(body('global score', 'global a, b,c')).toEqual([
      { t: 'global', names: ['score'] },
      { t: 'global', names: ['a', 'b', 'c'] },
    ]);
  });

  it('R8.3 lets it be a variable name', () => {
    expect(body('put 1 into it', 'global it')).toEqual([
      { t: 'putVar', value: { t: 'num', value: 1 }, name: 'it' },
      { t: 'global', names: ['it'] },
    ]);
  });

  it('R8.4 reports true, false and keywords as variable names', () => {
    const intoTrue = err(inHandler('go next card', 'put 1 into true'));
    expect(intoTrue).toMatchObject({ line: 3, column: 14 });
    expect(intoTrue.message).toBe('"true" is a reserved word and cannot be a variable name');
    expect(err(inHandler('global false'))).toMatchObject({ line: 2, column: 10 });
    expect(err(inHandler('put 1 into TRUE')).message).toContain('reserved word');
    expect(err(inHandler('global score, next'))).toMatchObject({ line: 2, column: 17 });
    expect(err(inHandler('put 1 into card')).message).toContain('reserved word');
  });

  it('reports a missing variable name', () => {
    expect(err(inHandler('global a,')).message).toBe('expected a variable name after ","');
    expect(err(inHandler('put 1 into 5')).message).toBe('expected a variable name after "into"');
  });
});

describe('R9 if', () => {
  const blockForm = inHandler('if x is 1 then', '  go next card', 'else', '  go prev card', 'end if');
  const oneLineForm = inHandler('if x is 1 then go next card else go prev card');

  it('R9.1 accepts the block form with and without else', () => {
    expect(body('if x is 1 then', '  go next card', 'end if')).toEqual([
      {
        t: 'if',
        cond: { t: 'bin', op: 'is', left: { t: 'var', name: 'x' }, right: { t: 'num', value: 1 } },
        then: [{ t: 'go', target: { k: 'next' } }],
        else: [],
      },
    ]);
    expect(ok(blockForm).handlers[0]!.body).toHaveLength(1);
  });

  it('R9.2 accepts the one-line form with and without else', () => {
    const [withElse, without] = body('if x is 1 then go next card else go prev card', 'if done then answer "ok"');
    expect(withElse).toMatchObject({ then: [{ t: 'go' }], else: [{ t: 'go' }] });
    expect(without).toMatchObject({ then: [{ t: 'answer' }], else: [] });
  });

  it('R9.3 gives both forms the same tree', () => {
    expect(stripPositions(ok(oneLineForm))).toEqual(stripPositions(ok(blockForm)));
  });

  it('R9.3 lets blocks nest, and one-line ifs sit inside blocks', () => {
    const [outer] = stmts('if a then', '  if b then', '    go next card', '  end if', '  if c then go prev card', 'end if');
    expect(outer?.t === 'if' && outer.then.map((s) => s.t)).toEqual(['if', 'if']);
  });

  it('reports an if inside a one-line if', () => {
    const e = err(inHandler('if a then if b then go next card'));
    expect(e).toMatchObject({ line: 2, column: 13 });
    expect(e.message).toContain('needs the block form');
  });

  it('reports else on the line after a one-line if', () => {
    const e = err(inHandler('if a then go next card', 'else go prev card'));
    expect(e).toMatchObject({ line: 3, column: 3 });
    expect(e.message).toContain('"else" without a matching "if"');
  });

  it('R9.5 reports a missing end if on the line of the if', () => {
    expect(err(src('on mouseUp', '  if a then', '    go next card'))).toMatchObject({ line: 2, column: 3 });
    const beforeEnd = err(inHandler('answer "hi"', 'if a then', '  go next card'));
    expect(beforeEnd).toMatchObject({ line: 3, column: 3 });
    expect(beforeEnd.message).toBe('"if" is never closed; add "end if"');
    expect(err(inHandler('if a then', '  go next card', 'else', '  go prev card'))).toMatchObject({ line: 2 });
  });

  it('reports end if without an if, a missing then, and a second else', () => {
    const stray = err(inHandler('if a then go next card', 'end if'));
    expect(stray).toMatchObject({ line: 3, column: 3 });
    expect(stray.message).toContain('a one-line if has no "end if"');
    expect(err(inHandler('if a go next card'))).toMatchObject({ line: 2, column: 8 });
    expect(err(inHandler('if a go next card')).message).toBe('expected "then" after the condition');
    const twoElses = err(inHandler('if a then', '  go next card', 'else', '  go prev card', 'else', 'end if'));
    expect(twoElses).toMatchObject({ line: 6, column: 3 });
  });

  it('reports a command on the same line as a block else', () => {
    const e = err(inHandler('if a then', '  go next card', 'else go prev card', 'end if'));
    expect(e).toMatchObject({ line: 4, column: 8 });
    expect(e.message).toContain('start the commands on the next line');
  });

  it('R9.6 reports else if in the one-line form on its line', () => {
    const e = err(inHandler('go next card', 'if a then go next card else if b then go prev card'));
    expect(e).toMatchObject({ line: 3, column: 31 });
    expect(e.message).toContain('"else if" needs the block form');
  });
});

describe('R9.6 else if chains', () => {
  const chain = src(
    'on mouseUp', //                 1
    '  if n is 1 then', //           2
    '    go to card "One"', //       3
    '  else if n is 2 then', //      4
    '    go to card "Two"', //       5
    '  else if n is 3 then', //      6
    '    go to card "Three"', //     7
    '  else', //                     8
    '    answer "No such room"', //  9
    '  end if', //                   10
    'end mouseUp', //                11
  );

  const nested = inHandler(
    'if n is 1 then',
    '  go to card "One"',
    'else',
    '  if n is 2 then',
    '    go to card "Two"',
    '  else',
    '    if n is 3 then',
    '      go to card "Three"',
    '    else',
    '      answer "No such room"',
    '    end if',
    '  end if',
    'end if',
  );

  it('parses a chain as nested ifs in the else branches', () => {
    const [root] = ok(chain).handlers[0]!.body as IfStmt[];
    const second = root!.else[0] as IfStmt;
    const third = second.else[0] as IfStmt;
    expect([root!.else.length, second.else.length, third.else.length]).toEqual([1, 1, 1]);
    expect([root!.t, second.t, third.t, third.else[0]!.t]).toEqual(['if', 'if', 'if', 'answer']);
    expect([sx(root!.cond), sx(second.cond), sx(third.cond)]).toEqual(['(is n 1)', '(is n 2)', '(is n 3)']);
    expect([root!.pos.line, second.pos.line, third.pos.line]).toEqual([2, 4, 6]);
  });

  it('gives a chain the same tree as else with nested block ifs', () => {
    expect(stripPositions(ok(chain))).toEqual(stripPositions(ok(nested)));
  });

  it('accepts a chain without a final else', () => {
    const [root] = body('if a then', '  go next card', 'else if b then', '  go prev card', 'end if');
    expect(root).toMatchObject({ else: [{ t: 'if', then: [{ t: 'go' }], else: [] }] });
  });

  it('reports a chain with no end if on the line of the first if', () => {
    const beforeEnd = err(inHandler(
      'if n is 1 then', //    2
      '  go to card "One"', // 3
      'else if n is 2 then', // 4
      '  go to card "Two"', // 5
      'else', //               6
      '  answer "No"', //      7
    ));
    expect(beforeEnd).toMatchObject({ line: 2, column: 3 });
    expect(beforeEnd.message).toBe('"if" is never closed; add "end if"');
    const atEof = err(src('on mouseUp', '  if a then', '    go next card', '  else if b then', '    go prev card'));
    expect(atEof).toMatchObject({ line: 2, column: 3 });
  });

  it('reports a command on the same line as else if … then', () => {
    expect(err(inHandler('if a then', '  go next card', 'else if b then go prev card', 'end if')))
      .toMatchObject({ line: 4, column: 18 });
  });
});

// nested-if-else-attachment-fix: inside a block if, an else or end if line right after a
// one-line if is meant for the one-line if, which cannot take it. Line 1 is `on mouseUp`.
describe('R9 an else or end if line right after a one-line if inside a block if (2.1, 2.3, 2.4)', () => {
  const syntax = (line: number, column: number, message: string): SyntaxError => ({ kind: 'syntax', line, column, message });

  /** parse and parseUnguarded both return exactly this error. */
  function expectError(source: string, error: SyntaxError) {
    expect(parseUnguarded(source)).toEqual({ ok: false, error });
    expect(parse(source)).toEqual({ ok: false, error });
  }

  it('Repro 1 reports the else on line 4 (2.1)', () => {
    expectError(ONE_LINE_IF_REPRO_1.source, ONE_LINE_IF_REPRO_1.error);
  });

  it('reports an else if line on its else (2.3)', () => {
    expectError(
      inHandler('if a then', '  if b then go next card', 'else if c then', '  howl', 'end if'),
      syntax(4, 3, ELSE_AFTER_ONE_LINE_IF),
    );
  });

  it('reports a second else in an else part with the one-line if message, not "already has an else" (2.1)', () => {
    expectError(
      inHandler('if a then', '  howl', 'else', '  if b then go next card', 'else', '  answer "x"', 'end if'),
      syntax(6, 3, ELSE_AFTER_ONE_LINE_IF),
    );
  });

  it('skips blank and comment-only lines between the one-line if and the else (2.1)', () => {
    const source = src(
      'on mouseUp', //                                     1
      '  if field "key" is "gold" then', //                2
      '    if field "door" is "open" then go next card', // 3
      '', //                                               4
      '    -- otherwise', //                               5
      '    else', //                                       6
      '      answer "The door is locked."', //             7
      '  end if', //                                       8
      'end mouseUp', //                                    9
    );
    expectError(source, syntax(6, 5, ELSE_AFTER_ONE_LINE_IF));
  });

  it('Repro 2 reports the stray end if on line 4, naming the if on line 2 (2.4)', () => {
    expectError(ONE_LINE_IF_REPRO_2.source, ONE_LINE_IF_REPRO_2.error);
  });

  it('reports the stray end if when the unmatched line is an else (2.4)', () => {
    expectError(
      inHandler('if a then', '  if b then go next card', 'end if', 'answer "x"', 'else', 'answer "y"', 'end if'),
      syntax(4, 3, strayEndIfMessage(2)),
    );
  });

  it('reports the last of several stray end ifs (2.4)', () => {
    const source = inHandler(
      'if a then', //                2
      '  if b then howl', //         3
      'end if', //                   4
      'if c then', //                5
      '  if d then go next card', // 6
      'end if', //                   7
      'end if', //                   8
    );
    expectError(source, syntax(7, 3, strayEndIfMessage(5)));
  });

  it('reports a stray end if that closes an inner block if two levels deep (2.4)', () => {
    const source = inHandler(
      'if a then', //          2
      '  if b then', //        3
      '    if c then howl', // 4
      '  end if', //           5
      'end if', //             6
      'end if', //             7
    );
    expectError(source, syntax(5, 5, strayEndIfMessage(3)));
  });

  // Preservation (3.2 to 3.5): observed on the unfixed parser, and must not change with the fix.
  it('still attaches an else after a one-line if with its own else to the enclosing if (3.2)', () => {
    expect(body('if a then', '  if b then howl else go next card', 'else', '  answer "x"', 'end if')).toEqual([
      {
        t: 'if',
        cond: { t: 'var', name: 'a' },
        then: [
          { t: 'if', cond: { t: 'var', name: 'b' }, then: [{ t: 'haunt', kind: 'howl' }], else: [{ t: 'go', target: { k: 'next' } }] },
        ],
        else: [{ t: 'answer', prompt: { t: 'str', value: 'x' }, labels: [] }],
      },
    ]);
  });

  it('still accepts an end if right after a one-line if when nothing unmatched follows (3.3)', () => {
    expect(body('if a then', '  if b then go next card', 'end if')).toEqual([
      {
        t: 'if',
        cond: { t: 'var', name: 'a' },
        then: [{ t: 'if', cond: { t: 'var', name: 'b' }, then: [{ t: 'go', target: { k: 'next' } }], else: [] }],
        else: [],
      },
    ]);
  });

  it('still reports an unmatched end if on its own line when it follows a one-line if (3.4)', () => {
    // Repro 2 with line 5 replaced by a one-line if: line 4 is a stray end if, but line 6 follows a one-line if.
    const source = src(
      'on mouseUp', //                1
      '  if a then', //               2
      '    if b then go next card', // 3
      '    end if', //                4
      '    if c then go prev card', // 5
      '  end if', //                  6
      'end mouseUp', //               7
    );
    expectError(source, syntax(6, 3, UNMATCHED_END_IF));
  });

  it('still reports an unmatched end if on its own line when the only stray end if is in another handler (3.5)', () => {
    const source = src(
      'on openCard', //       1
      '  if a then', //       2
      '    if b then howl', // 3
      '  end if', //          4
      'end openCard', //      5
      'on mouseUp', //        6
      '  howl', //            7
      '  end if', //          8
      'end mouseUp', //       9
    );
    expectError(source, syntax(8, 3, UNMATCHED_END_IF));
  });
});

describe('R15 haunts', () => {
  it('R15.1 parses the four haunts to haunt nodes with their kinds', () => {
    expect(body('release bat', 'howl', 'summon witch', 'drop spider')).toEqual([
      { t: 'haunt', kind: 'bat' },
      { t: 'haunt', kind: 'howl' },
      { t: 'haunt', kind: 'witch' },
      { t: 'haunt', kind: 'spider' },
    ]);
  });

  it('reads haunt words in any case and spacing', () => {
    expect(body('RELEASE   Bat', 'Howl', 'summon\tWITCH', 'DrOp sPiDeR')).toEqual(
      body('release bat', 'howl', 'summon witch', 'drop spider'),
    );
  });

  it('accepts a haunt as the statement of a one-line if', () => {
    expect(body('if done then howl else release bat')).toEqual([
      { t: 'if', cond: { t: 'var', name: 'done' }, then: [{ t: 'haunt', kind: 'howl' }], else: [{ t: 'haunt', kind: 'bat' }] },
    ]);
  });

  it('reports a missing or wrong second word on its line', () => {
    const alone = err(inHandler('go next card', 'release'));
    expect(alone).toMatchObject({ line: 3 });
    expect(alone.message).toBe('expected "bat" after "release"');
    const wrong = err(inHandler('summon cat'));
    expect(wrong).toMatchObject({ line: 2, column: 10 });
    expect(wrong.message).toBe('expected "witch" after "summon"');
    expect(err(inHandler('howl loudly')).message).toBe('unexpected "loudly" after the command');
  });

  it('R8.4 reserves haunt words', () => {
    expect(err(inHandler('put 1 into bat'))).toMatchObject({ line: 2, column: 14 });
    expect(err(inHandler('put 1 into bat')).message).toBe('"bat" is a reserved word and cannot be a variable name');
    expect(err(inHandler('global spider')).message).toBe('"spider" is a reserved word and cannot be a variable name');
    const asValue = err(inHandler('put howl into x'));
    expect(asValue).toMatchObject({ line: 2, column: 7 });
    expect(asValue.message).toContain('reserved word');
  });

  it('R15.4 keeps the haunt table within its rules', () => {
    const otherStarts = ['on', 'end', 'go', 'visual', 'answer', 'ask', 'put', 'show', 'hide', 'wait', 'global', 'if', 'else'];
    const firstWords = HAUNTS.map((h) => h.words[0]);
    expect(new Set(firstWords).size).toBe(firstWords.length);
    for (const h of HAUNTS) {
      expect(otherStarts, h.kind).not.toContain(h.words[0]);
      for (const w of h.words) {
        expect(['it', 'true', 'false'], h.kind).not.toContain(w);
        // The parser compares lowercase single words.
        expect(w, h.kind).toMatch(/^[a-z]+$/);
        expect(isReserved(w), w).toBe(true);
      }
    }
  });
});

describe('R11 expressions', () => {
  it('R11.1 reads every kind of value', () => {
    expect(['"hi"', '2.5', 'it', 'It', 'score', 'field "Name"', 'true', 'FALSE', '"true"', '(1)'].map(ex)).toEqual([
      '"hi"', '2.5', 'it', 'It', 'score', 'field("Name")', '#true', '#false', '"true"', '[1]',
    ]);
  });

  it('R11.1 reads every operator', () => {
    expect([
      'a & b', 'a && b', 'a + b', 'a - b', 'a * b', 'a / b',
      'a is b', 'a is not b', 'a < b', 'a > b', 'a <= b', 'a >= b', 'a contains b',
      'a and b', 'a or b', 'not a',
    ].map(ex)).toEqual([
      '(& a b)', '(&& a b)', '(+ a b)', '(- a b)', '(* a b)', '(/ a b)',
      '(is a b)', '(isNot a b)', '(< a b)', '(> a b)', '(<= a b)', '(>= a b)', '(contains a b)',
      '(and a b)', '(or a b)', '(not a)',
    ]);
  });

  it('R11.2 applies the precedence levels from or (lowest) to * / (highest)', () => {
    expect(ex('1 + 2 * 3')).toBe('(+ 1 (* 2 3))');
    expect(ex('a & 1 + 2')).toBe('(& a (+ 1 2))');
    expect(ex('a is b & c')).toBe('(is a (& b c))');
    expect(ex('not a is b')).toBe('(not (is a b))');
    expect(ex('not a and b')).toBe('(and (not a) b)');
    expect(ex('a and b or c and d')).toBe('(or (and a b) (and c d))');
    expect(ex('a < b and c contains "x"')).toBe('(and (< a b) (contains c "x"))');
    expect(ex('(1 + 2) * 3')).toBe('(* [(+ 1 2)] 3)');
    expect(ex('not not a')).toBe('(not (not a))');
  });

  it('R11.2 makes binary operators left-associative', () => {
    expect(ex('1 - 2 - 3')).toBe('(- (- 1 2) 3)');
    expect(ex('8 / 4 / 2')).toBe('(/ (/ 8 4) 2)');
    expect(ex('a & b && c')).toBe('(&& (& a b) c)');
    expect(ex('a or b or c')).toBe('(or (or a b) c)');
  });

  it('R11.2 reports chained comparisons on their line', () => {
    const e = err(inHandler('go next card', 'if 1 < 2 < 3 then go next card'));
    expect(e).toMatchObject({ line: 3, column: 12 });
    expect(e.message).toBe('comparisons cannot be chained; join them with "and"');
    expect(err(inHandler('put a is b is not c into x'))).toMatchObject({ line: 2, column: 14 });
  });

  it('records the operator position on binary nodes', () => {
    const e = exprOf('1 + 2');
    expect(e.pos).toEqual({ line: 2, column: 9 });
    expect(stmts('put 1 + 2 into x')[0]!.pos).toEqual({ line: 2, column: 3 });
  });

  it('reports values that are missing or not allowed', () => {
    expect(err(inHandler('put 1 + into x')).message).toBe('expected a value but found "into", which is a reserved word');
    expect(err(inHandler('put + 1 into x')).message).toBe('expected a value but found "+"');
    expect(err(inHandler('answer next')).message).toBe('expected a value but found "next", which is a reserved word');
    expect(err(inHandler('put -5 into x')).message).toContain('negative numbers are not supported');
    expect(err(inHandler('answer "a" &')).message).toBe('expected a value after "&"');
  });

  it('reports a missing closing parenthesis on its line', () => {
    const e = err(inHandler('put (1 + 2 into x'));
    expect(e).toMatchObject({ line: 2, column: 14 });
    expect(e.message).toBe('missing ")" to close the "(" at column 7');
  });

  it('R11.9 ignores comments at the end of a command and on their own lines', () => {
    expect(body('-- add them up', 'put 1 + 2 into x -- the sum')).toEqual(body('put 1 + 2 into x'));
    expect(err(inHandler('put 1 + 2 -- into x')).message).toBe('expected "into", "after" or "before" after the value');
  });
});

describe('R12 error reporting', () => {
  it('passes lexer errors through with their line', () => {
    expect(err(inHandler('answer "hi', 'go next card'))).toMatchObject({ kind: 'syntax', line: 2, column: 10 });
  });

  it('never throws, and reports lines inside the script', () => {
    const odd = [
      'on', 'on\n', 'on mouseUp\nend', 'end', 'if', 'on mouseUp\n  if\nend mouseUp',
      'on mouseUp\n  put\nend mouseUp', 'on mouseUp\n  (((\nend mouseUp', 'else', ')', ',',
      'on mouseUp\n  go to card\n', 'on openCard\n  answer "x" with', 'on mouseUp\n  global\n',
      'on mouseUp\n  if a then\n  else if\n', '\n\n\non mouseUp\n\n\n',
    ];
    for (const source of odd) {
      expect(() => parse(source), source).not.toThrow();
      const result = parse(source);
      expect(result.ok, source).toBe(false);
      if (!result.ok) {
        expect(result.error.line, source).toBeGreaterThanOrEqual(1);
        expect(result.error.line, source).toBeLessThanOrEqual(lineCount(source));
        // The guard in parse() must not have changed anything.
        expect(parseUnguarded(source), source).toEqual(result);
      }
    }
  });
});

// lexer-error-masks-parse-error-fix: the reported error is the first one met reading from
// the top, whether the lexer or the parser finds it. Line 1 is `on mouseUp`.
describe('R12.3 the first syntax error from the top, from the lexer or the parser', () => {
  /** parse and parseUnguarded both return exactly this error. */
  function expectError(source: string, error: SyntaxError) {
    expect(parse(source)).toEqual({ ok: false, error });
    expect(parseUnguarded(source)).toEqual({ ok: false, error });
  }

  const GO_MESSAGE = 'expected next card, prev card, first card, last card or card … after "go"';

  it.each(REPROS)('$name reports the parse error found before the lexer error (2.1, 2.2, 2.3)', ({ body, error }) => {
    expectError(handlerSource('mouseUp', body), error);
  });

  it('Repro 1 with \\r\\n line breaks reports the same line and column (2.1, 3.8)', () => {
    expectError(handlerSource('mouseUp', REPRO_1.body, '\r\n'), REPRO_1.error);
  });

  it('reports x = 1 as an unknown command at x, not as the "=" hint (decided at design review)', () => {
    expectError(inHandler('x = 1'), { kind: 'syntax', line: 2, column: 3, message: 'unknown command "x"' });
  });

  it('reports the parse error when the lexer error is at column 1 of the next line', () => {
    expectError(src('on mouseUp', '  put 1 into', '#', 'end mouseUp'), {
      kind: 'syntax',
      line: 2,
      column: 13,
      message: 'expected a variable name after "into"',
    });
  });

  it('reports a parse error in an earlier complete handler before a lexer error in a later one', () => {
    expectError(src('on mouseUp', '  go nowhere', 'end mouseUp', 'on openCard', '  answer "x', 'end openCard'), {
      kind: 'syntax',
      line: 2,
      column: 6,
      message: GO_MESSAGE,
    });
  });
});

// lexer-error-masks-parse-error-fix, preservation: when the parser needs the text at the
// first lexer error before it finds any parse error, that lexer error is reported exactly as
// today. Values observed on the unfixed code. Line 1 is `on mouseUp`.
describe('R12.3 the first lexer error, when no parse error is found before it (3.2–3.6)', () => {
  /** parse and parseUnguarded both return exactly this error. */
  function expectError(source: string, error: SyntaxError) {
    expect(parse(source)).toEqual({ ok: false, error });
    expect(parseUnguarded(source)).toEqual({ ok: false, error });
  }

  const syntax = (line: number, column: number, message: string): SyntaxError => ({ kind: 'syntax', line, column, message });
  const NO_CLOSING_QUOTE = 'this string has no closing quote (") on this line';
  const EQUALS = 'unexpected character "="; use "is" to compare';

  it('reports a lexer error on an earlier line than a parse error (3.2)', () => {
    expectError(inHandler('answer "unclosed', 'put 1 into'), syntax(2, 10, NO_CLOSING_QUOTE));
  });

  it('reports the lexer error when the next token put needs is the broken one (3.3)', () => {
    expectError(inHandler('put 1 into "x'), syntax(2, 14, NO_CLOSING_QUOTE));
  });

  it('reports the lexer error, not a missing end, when a block if is still open at it (3.4)', () => {
    expectError(src('on mouseUp', '  if a then', '    answer "x', 'end mouseUp'), syntax(3, 12, NO_CLOSING_QUOTE));
  });

  it('reports the lexer error, not a missing end, when its handler is still open at it (3.4)', () => {
    expectError(
      src('on mouseUp', '  go to next card', 'end mouseUp', 'on openCard', '  answer "x', 'end openCard'),
      syntax(5, 10, NO_CLOSING_QUOTE),
    );
  });

  it('reports the lexer error, not "at most 3 buttons", when that error would name the broken token', () => {
    expectError(inHandler('answer "a" with "b" or "c" or "d" or "e'), syntax(2, 40, NO_CLOSING_QUOTE));
  });

  it('reports a lexer error that has no token before it', () => {
    expectError('=', syntax(1, 1, EQUALS));
  });

  it('reports only the first of several lexer errors (3.5)', () => {
    expectError(inHandler('answer "a', 'put 1 # 2 into x', 'wait .5 seconds'), syntax(2, 10, NO_CLOSING_QUOTE));
  });

  it.each([
    ['if x = 1 then howl', 8, EQUALS],
    ['put x = 1 into y', 9, EQUALS],
    ['answer \u201Chi\u201D', 10, 'unexpected character "\u201C"; use straight quotes (")'],
    ["answer 'hi'", 10, 'unexpected character "\'"; strings use double quotes (")'],
  ])('keeps the message and hint for %s word for word (3.6)', (line, column, message) => {
    expectError(inHandler(line), syntax(2, column, message));
  });
});
