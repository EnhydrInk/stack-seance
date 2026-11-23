import './helpers/noNetwork';
// Static checks over the compiler's source files and the compiler and Worker tests
// (Requirement 12.1, 12.2, 14.10). Files are read with the TypeScript parser through the
// interpreter's scan helpers, used as they are, so comments and prose never count.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { INTERPRETER_DIR, bannedUses, moduleSpecifiers, type Source } from '../hypertalk/helpers/sourceScan';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const COMPILER_DIR = join(ROOT, 'src', 'compiler');
const INTERPRETER_INDEX = join(INTERPRETER_DIR, 'index.ts');
const NO_NETWORK = join(ROOT, 'test', 'compiler', 'helpers', 'noNetwork.ts');

/** Every file under `dir` whose name ends with `suffix`, as absolute paths, sorted. A missing folder has none. */
function filesUnder(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(dir, f))
    .sort();
}

/** A file read with the TypeScript parser. Its name is relative to the repository, with `/`. */
function source(path: string, text = readFileSync(path, 'utf8')): Source {
  return {
    name: relative(ROOT, path).split(sep).join('/'),
    ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
  };
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

/** The file a relative specifier names, the way the bundler resolves it: as written, with `.ts`, or a folder's index. */
function resolveFile(from: string, specifier: string): string {
  const path = resolve(dirname(from), specifier);
  return [path, `${path}.ts`, join(path, 'index.ts')].find((p) => existsSync(p) && p.endsWith('.ts')) ?? path;
}

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

/** Imports of a compiler file that are not relative, leave src/compiler, or reach the interpreter past its index. */
function badCompilerImports(file: Source): string[] {
  return moduleSpecifiers(file)
    .filter(({ specifier }) => {
      if (!isRelative(specifier)) return true;
      const target = resolveFile(file.ast.fileName, specifier);
      return !inside(COMPILER_DIR, target) && target !== INTERPRETER_INDEX;
    })
    .map(({ specifier }) => `${file.name} imports "${specifier}"`);
}

/** The file the first import declaration of a test file names, or undefined. */
function firstImport(file: Source): string | undefined {
  const first = file.ast.statements.find(ts.isImportDeclaration);
  if (!first || !ts.isStringLiteral(first.moduleSpecifier)) return undefined;
  const specifier = first.moduleSpecifier.text;
  return isRelative(specifier) ? resolveFile(file.ast.fileName, specifier) : specifier;
}

describe('Requirement 12.1, 12.2 static scan of src/compiler', () => {
  const sources = filesUnder(COMPILER_DIR, '.ts').map((path) => source(path));

  it('reads every compiler file and sees its imports', () => {
    expect(sources.map((s) => s.name)).toEqual(
      expect.arrayContaining(['contract.ts', 'model.ts', 'names.ts', 'schema.ts', 'references.ts', 'rules.ts', 'prompt.ts', 'compile.ts', 'index.ts'].map((f) => `src/compiler/${f}`)),
    );
    expect(sources.flatMap((s) => moduleSpecifiers(s).map((m) => `${s.name} ${m.specifier}`))).toContain('src/compiler/rules.ts ../hypertalk/index');
  });

  it('uses no network, DOM, timer, clock or randomness global', () => {
    expect(sources.flatMap(bannedUses)).toEqual([]);
  });

  it('imports only from src/compiler and the interpreter\'s public API: no SDK, no packages', () => {
    expect(sources.flatMap(badCompilerImports)).toEqual([]);
  });

  it('the import check catches packages, node modules, interpreter internals, the Worker and the UI', () => {
    const sample = source(
      join(COMPILER_DIR, 'sample.ts'),
      [
        "import { checkReply } from './rules';",
        "import type { Script } from '../hypertalk/index';",
        "import { parse } from '../hypertalk';",
        "import { parseUnguarded } from '../hypertalk/parser';",
        "import Anthropic from '@anthropic-ai/sdk';",
        "import { readFileSync } from 'node:fs';",
        "export * from '../../worker/src/ask';",
        "const stacks = await import('../ui/stacks.json');",
      ].join('\n'),
    );
    expect(badCompilerImports(sample)).toEqual([
      'src/compiler/sample.ts imports "../hypertalk/parser"',
      'src/compiler/sample.ts imports "@anthropic-ai/sdk"',
      'src/compiler/sample.ts imports "node:fs"',
      'src/compiler/sample.ts imports "../../worker/src/ask"',
      'src/compiler/sample.ts imports "../ui/stacks.json"',
    ]);
  });
});

describe('Requirement 14.10 every compiler and Worker test imports the noNetwork helper first', () => {
  const tests = [join(ROOT, 'test', 'compiler'), join(ROOT, 'test', 'worker')].flatMap((dir) => filesUnder(dir, '.test.ts'));

  it('finds the test files', () => {
    expect(tests.map((t) => relative(ROOT, t).split(sep).join('/'))).toEqual(
      expect.arrayContaining(['test/compiler/contract.test.ts', 'test/compiler/rules.test.ts', 'test/compiler/scan.test.ts']),
    );
  });

  it('each one imports test/compiler/helpers/noNetwork.ts before anything else', () => {
    const missing = tests.map((path) => source(path)).filter((file) => firstImport(file) !== NO_NETWORK).map((file) => file.name);
    expect(missing).toEqual([]);
  });

  it('the check sees a test that imports something else first', () => {
    const late = source(join(ROOT, 'test', 'worker', 'late.test.ts'), "import { it } from 'vitest';\nimport '../compiler/helpers/noNetwork';\n");
    const early = source(join(ROOT, 'test', 'worker', 'early.test.ts'), "import '../compiler/helpers/noNetwork';\nimport { it } from 'vitest';\n");
    expect(firstImport(late)).toBe('vitest');
    expect(firstImport(early)).toBe(NO_NETWORK);
  });
});
