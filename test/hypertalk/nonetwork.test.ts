// Task 11: no network, no LLM (R10.2, R13). Scripts are parsed, printed and run with the
// network globals replaced by stubs that fail the test, and the interpreter's source files
// are scanned for banned globals and for imports from outside src/hypertalk.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { FakeHost } from './helpers/fakeHost';
import { sessionArb } from './helpers/arbitraries';
import { bannedUses, interpreterSources, moduleSpecifiers, outsideImports, parseSource } from './helpers/sourceScan';

const src = (...lines: string[]) => lines.join('\n');

const NETWORK = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

describe('R13.1 / 11.1 parsing and running with the network replaced by failing stubs', () => {
  /** Every stub call, in order. Kept even when the runtime turns the throw into a runtime error. */
  let calls: string[] = [];
  const stubs = new Map<string, () => never>();

  /** A plain function, so both `fetch(…)` and `new WebSocket(…)` reach it. */
  function trap(name: string): () => never {
    return function blocked(): never {
      calls.push(name);
      throw new Error(`${name} was called: the interpreter must not use the network (R13)`);
    };
  }

  beforeEach(() => {
    calls = [];
    for (const name of NETWORK) {
      stubs.set(name, trap(name));
      vi.stubGlobal(name, stubs.get(name));
    }
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Imports the interpreter after the stubs are in, so code that runs at import time is covered too. */
  async function load() {
    const { parse } = await import('../../src/hypertalk/parser');
    const { print } = await import('../../src/hypertalk/printer');
    const { runHandler } = await import('../../src/hypertalk/runtime');
    return { parse, print, runHandler };
  }

  it('the stubs are what the globals hold, and calling one fails and is recorded', () => {
    for (const name of NETWORK) {
      expect(Reflect.get(globalThis, name)).toBe(stubs.get(name));
      expect(() => stubs.get(name)!()).toThrow(`${name} was called`);
    }
    expect(calls).toEqual([...NETWORK]);
  });

  it('parses, prints and runs a sample script that uses every statement form, with no network call', async () => {
    const { parse, print, runHandler } = await load();
    const button = src(
      'on mouseUp',
      '  global score',
      '  put 0 - 5 into score -- a negative value',
      '  ask "Your name?"',
      '  put "Hello" && it into field "greeting"',
      '  answer field "greeting" with "Go" or "Stay"',
      '  if it is "Go" then',
      '    hide button "start"',
      '    wait 1 second',
      '    release bat',
      '    visual effect dissolve',
      '    go to next card',
      '  else if it contains "st" then',
      '    howl',
      '  else',
      '    summon witch',
      '  end if',
      '  put score + 1 after field "log"',
      'end mouseUp',
    );
    const card2 = src(
      'on openCard',
      '  global score',
      '  put score * 2 into score',
      '  drop spider',
      '  show field "secret"',
      'end openCard',
    );
    const host = new FakeHost({
      cards: [
        { fields: [{ name: 'greeting' }], buttons: [{ name: 'start' }] },
        { script: card2, fields: [{ name: 'log' }, { name: 'secret', visible: false }] },
      ],
      replies: ['Ada', 'Go'],
    });
    const globals = new Map<string, string | number>();

    const parsed = parse(button);
    if (!parsed.ok) throw new Error(`sample script does not parse: ${parsed.error.message}`);
    expect(parse(print(parsed.script)).ok).toBe(true);
    expect(await runHandler(button, 'mouseUp', { host, globals, scriptId: 'button-1' })).toEqual({ ok: true });

    // The run really went through dialogs, fields, visibility, wait, haunts, go and openCard.
    expect(host.fieldText('greeting', 1)).toBe('Hello Ada');
    expect(host.isVisible('button', 'start', 1)).toBe(false);
    expect(host.state.current).toBe(2);
    expect(host.isVisible('field', 'secret')).toBe(true);
    expect(host.fieldText('log')).toBe('-9');
    expect(globals.get('score')).toBe(-10);
    expect(host.log.filter((c) => c.call === 'haunt' || c.call === 'wait' || c.call === 'goToCard')).toEqual([
      { call: 'wait', seconds: 1 },
      { call: 'haunt', kind: 'bat' },
      { call: 'goToCard', index: 2, id: 'card-2', effect: 'dissolve' },
      { call: 'haunt', kind: 'spider' },
    ]);
    expect(calls).toEqual([]);
  });

  it('reports a syntax error and a runtime error with no network call', async () => {
    const { parse, runHandler } = await load();
    const syntax = parse(src('on mouseUp', '  put 1 into true', 'end mouseUp'));
    expect(syntax.ok ? undefined : syntax.error.line).toBe(2);
    const host = new FakeHost({ cards: [{}] });
    const ran = await runHandler(src('on mouseUp', '  go to card "nowhere"', 'end mouseUp'), 'mouseUp', {
      host,
      globals: new Map(),
      scriptId: 'button-1',
    });
    expect(ran.ok ? undefined : ran.error).toMatchObject({ kind: 'runtime', line: 2 });
    expect(calls).toEqual([]);
  });

  it('runs generated sessions (any statement mix, card scripts, errors) with no network call', async () => {
    const { runHandler } = await load();
    await fc.assert(
      fc.asyncProperty(sessionArb, async (session) => {
        const host = new FakeHost(session.host);
        await runHandler(session.source, 'mouseUp', { host, globals: new Map(session.globals), scriptId: 'button-1' });
        expect(calls).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

describe('R10.2, R13.2 / 11.2 static scan of src/hypertalk', () => {
  const sources = interpreterSources();

  it('reads every interpreter file and sees their imports', () => {
    expect(sources.map((s) => s.name)).toEqual(
      expect.arrayContaining(['errors.ts', 'host.ts', 'index.ts', 'lexer.ts', 'parser.ts', 'printer.ts', 'runtime.ts', 'tokens.ts', 'values.ts']),
    );
    expect(sources.flatMap((s) => moduleSpecifiers(s).map((m) => `${s.name} ${m.specifier}`))).toContain('runtime.ts ./parser');
  });

  it('uses no network, DOM, timer, clock or randomness global', () => {
    expect(sources.flatMap(bannedUses)).toEqual([]);
  });

  it('imports nothing from outside src/hypertalk: no UI, no compiler, no packages', () => {
    expect(sources.flatMap(outsideImports)).toEqual([]);
  });

  it('the scan catches every banned name and outside import, and ignores comments and prose', () => {
    const sample = parseSource(
      'sample.ts',
      src(
        '// fetch, window and Date in a comment are fine',
        "import { tokenize } from './lexer';",
        "import type { Host } from '.';",
        "import { card } from '../ui/card';",
        "export * from '../compiler/llm';",
        "import OpenAI from 'openai';",
        "const https = await import('node:https');",
        "const prose = 'a window of time, set by a Date';",
        'fetch("https://example.com"); new WebSocket("wss://example.com"); new XMLHttpRequest();',
        'setTimeout(f, 1); setInterval(f, 1); window.alert(""); document.title; Date.now();',
        "Math.random(); Math['random'](); globalThis['fetch'];",
      ),
    );
    expect(bannedUses(sample)).toEqual([
      'sample.ts:9 fetch',
      'sample.ts:9 WebSocket',
      'sample.ts:9 XMLHttpRequest',
      'sample.ts:10 setTimeout',
      'sample.ts:10 setInterval',
      'sample.ts:10 window',
      'sample.ts:10 document',
      'sample.ts:10 Date',
      'sample.ts:11 Math.random',
      'sample.ts:11 Math.random',
      'sample.ts:11 "fetch"',
    ]);
    expect(outsideImports(sample)).toEqual([
      'sample.ts:4 imports "../ui/card"',
      'sample.ts:5 imports "../compiler/llm"',
      'sample.ts:6 imports "openai"',
      'sample.ts:7 imports "node:https"',
    ]);
  });
});
