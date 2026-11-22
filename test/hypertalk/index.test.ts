// Task 12: the public API in src/hypertalk/index.ts, and the R15.4 static scan that keeps
// every creature name in the HAUNTS table.
import { describe, it, expect, expectTypeOf } from 'vitest';
import * as api from '../../src/hypertalk';
import type {
  BinOp,
  CardRef,
  Effect,
  Expr,
  GoTarget,
  Handler,
  HandlerName,
  HauntKind,
  Host,
  IfStmt,
  NavTarget,
  ParseResult,
  Pos,
  RunContext,
  RunResult,
  RuntimeError,
  Script,
  ScriptError,
  Stmt,
  SyntaxError as ScriptSyntaxError,
  Value,
  WithoutPos,
} from '../../src/hypertalk';
import type * as ast from '../../src/hypertalk/ast';
import type * as errors from '../../src/hypertalk/errors';
import type * as host from '../../src/hypertalk/host';
import { HAUNTS } from '../../src/hypertalk/tokens';
import { FakeHost } from './helpers/fakeHost';
import { handlerSource, REPROS } from './helpers/lexMask';
import { at, insideConst, interpreterSources, parseSource, stringLiterals, wordsOf, type Source } from './helpers/sourceScan';

const src = (...lines: string[]) => lines.join('\n');

describe('12.1 public API (R14.1)', () => {
  it('exports parse, print and runHandler, and not the unguarded entry points', () => {
    expect(Object.keys(api).sort()).toEqual(['parse', 'print', 'runHandler']);
    for (const fn of [api.parse, api.print, api.runHandler]) expect(typeof fn).toBe('function');
  });

  it('re-exports the AST, error and host types unchanged', () => {
    expectTypeOf<Pos>().toEqualTypeOf<ast.Pos>();
    expectTypeOf<Script>().toEqualTypeOf<ast.Script>();
    expectTypeOf<Handler>().toEqualTypeOf<ast.Handler>();
    expectTypeOf<HandlerName>().toEqualTypeOf<ast.HandlerName>();
    expectTypeOf<Stmt>().toEqualTypeOf<ast.Stmt>();
    expectTypeOf<IfStmt>().toEqualTypeOf<ast.IfStmt>();
    expectTypeOf<GoTarget>().toEqualTypeOf<ast.GoTarget>();
    expectTypeOf<NavTarget>().toEqualTypeOf<ast.NavTarget>();
    expectTypeOf<Effect>().toEqualTypeOf<ast.Effect>();
    expectTypeOf<Expr>().toEqualTypeOf<ast.Expr>();
    expectTypeOf<BinOp>().toEqualTypeOf<ast.BinOp>();
    expectTypeOf<WithoutPos<Script>>().toEqualTypeOf<ast.WithoutPos<ast.Script>>();
    expectTypeOf<ScriptSyntaxError>().toEqualTypeOf<errors.SyntaxError>();
    expectTypeOf<RuntimeError>().toEqualTypeOf<errors.RuntimeError>();
    expectTypeOf<ScriptError>().toEqualTypeOf<errors.ScriptError>();
    expectTypeOf<Host>().toEqualTypeOf<host.Host>();
    expectTypeOf<CardRef>().toEqualTypeOf<host.CardRef>();
    expectTypeOf<RunContext>().toEqualTypeOf<host.RunContext>();
    expectTypeOf<RunResult>().toEqualTypeOf<host.RunResult>();
    expectTypeOf(api.parse).returns.toEqualTypeOf<ParseResult>();
    expectTypeOf(api.runHandler).returns.resolves.toEqualTypeOf<RunResult>();
  });

  it('parse, print and runHandler work together through the public API', async () => {
    const source = src('on mouseUp', '  ASK "Which room?"', '  go card it -- a numeric reply is a card number', 'end mouseUp');
    const parsed: ParseResult = api.parse(source);
    if (!parsed.ok) throw new Error(`does not parse: ${parsed.error.message}`);
    const printed = api.print(parsed.script);
    expect(printed).toBe(src('on mouseUp', '  ask "Which room?"', '  go to card it', 'end mouseUp', ''));

    const stack: Host = new FakeHost({ cards: [{}, {}, { name: 'Crypt' }], replies: ['3'] });
    const ctx: RunContext = { host: stack, globals: new Map<string, Value>(), scriptId: 'button-1' };
    expect(await api.runHandler(printed, 'mouseUp', ctx)).toEqual({ ok: true });
    expect(stack.currentCard()).toEqual({ index: 3, id: 'card-3', name: 'Crypt' });
  });

  it('errors come back as SyntaxError and RuntimeError values with a line', async () => {
    const syntax = api.parse(src('on mouseDown', 'end mouseDown'));
    const syntaxError: ScriptSyntaxError | undefined = syntax.ok ? undefined : syntax.error;
    expect(syntaxError).toMatchObject({ kind: 'syntax', line: 1 });

    const ctx: RunContext = { host: new FakeHost({ cards: [{}] }), globals: new Map(), scriptId: 'button-1' };
    const ran = await api.runHandler(src('on mouseUp', '  go to card 9', 'end mouseUp'), 'mouseUp', ctx);
    const error: ScriptError | undefined = ran.ok ? undefined : ran.error;
    expect(error).toMatchObject({ kind: 'runtime', line: 2 } satisfies Partial<RuntimeError>);
  });
});

describe('R12.3 / 2.1–2.3 public parse with a parse error before a lexer error', () => {
  it.each(REPROS)('$name returns the parser’s error, unchanged by the line guard', ({ body, error }) => {
    expect(api.parse(handlerSource('mouseUp', body))).toEqual({ ok: false, error });
  });
});

describe('12.1a HauntKind export (R15.2, R15.4)', () => {
  it('HauntKind is the union of the HAUNTS kinds', () => {
    expectTypeOf<HauntKind>().toEqualTypeOf<'bat' | 'howl' | 'witch' | 'spider'>();
    expectTypeOf<HauntKind>().toEqualTypeOf<(typeof HAUNTS)[number]['kind']>();
  });

  it('a host can keep its animations in a Record<HauntKind, …>', () => {
    const animations: Record<HauntKind, string> = { bat: 'flap', howl: 'moon', witch: 'broom', spider: 'thread' };
    expect(Object.keys(animations).sort()).toEqual(HAUNTS.map((h) => h.kind).sort());
  });
});

describe('R15.4 / 12.1a creature names live only in the HAUNTS table', () => {
  /** Every word and kind of every entry, lowercase. */
  const HAUNT_WORDS: ReadonlySet<string> = new Set(HAUNTS.flatMap((h) => [...h.words, h.kind]));

  /** String literals holding a haunt word or kind, except inside `const HAUNTS = …` in tokens.ts. */
  function creatureLiterals(source: Source): string[] {
    return stringLiterals(source)
      .filter((l) => !(source.name === 'tokens.ts' && insideConst(l.node, 'HAUNTS')))
      .filter((l) => wordsOf(l.text).some((w) => HAUNT_WORDS.has(w)))
      .map((l) => at(source, l.node, JSON.stringify(l.text)));
  }

  it('no file in src/hypertalk outside the HAUNTS table holds a haunt word or kind as a string literal', () => {
    expect(interpreterSources().flatMap(creatureLiterals)).toEqual([]);
  });

  it('the scan sees the table: every haunt word and kind is a string literal inside HAUNTS', () => {
    const tokens = interpreterSources().find((s) => s.name === 'tokens.ts');
    if (!tokens) throw new Error('src/hypertalk/tokens.ts not found');
    const inTable = stringLiterals(tokens).filter((l) => insideConst(l.node, 'HAUNTS'));
    expect(new Set(inTable.map((l) => l.text))).toEqual(HAUNT_WORDS);
  });

  it('the scan flags literals, literal types and template text, and ignores comments and longer words', () => {
    const sample = parseSource(
      'sample.ts',
      src(
        '// a bat in a comment is fine',
        "type Kind = 'bat' | 'Howl';",
        "const words = ['summon', 'witch'];",
        'const message = `drop ${x} spider`;',
        "const fine = 'a battle, a dropout';",
      ),
    );
    expect(creatureLiterals(sample)).toEqual([
      'sample.ts:2 "bat"',
      'sample.ts:2 "Howl"',
      'sample.ts:3 "summon"',
      'sample.ts:3 "witch"',
      'sample.ts:4 "drop "',
      'sample.ts:4 " spider"',
    ]);
    // In tokens.ts only the HAUNTS initializer is exempt, not the rest of the file.
    const tokens = parseSource(
      'tokens.ts',
      src("export const HAUNTS = [{ words: ['howl'], kind: 'howl' }] as const;", "export const MORE = ['howl'];"),
    );
    expect(creatureLiterals(tokens)).toEqual(['tokens.ts:2 "howl"']);
  });
});
