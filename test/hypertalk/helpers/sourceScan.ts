// Static checks over the interpreter's own source files (R10.2, R13.2, R15.4).
// Files are read with the TypeScript parser, so comments never count and a word in a
// comment or an error message cannot trip a check that is about code.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Absolute path of src/hypertalk, without a trailing separator. */
export const INTERPRETER_DIR = resolve(fileURLToPath(new URL('../../../src/hypertalk/', import.meta.url)));

export interface Source {
  /** Path relative to src/hypertalk, with `/` separators (for example `runtime.ts`). */
  name: string;
  ast: ts.SourceFile;
}

/** Parses `text` as if it were the file `src/hypertalk/<name>`. */
export function parseSource(name: string, text: string): Source {
  return { name, ast: ts.createSourceFile(join(INTERPRETER_DIR, name), text, ts.ScriptTarget.Latest, true) };
}

/** Every `.ts` file under src/hypertalk, sorted by name. */
export function interpreterSources(): Source[] {
  return readdirSync(INTERPRETER_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.split(sep).join('/'))
    .sort()
    .map((name) => parseSource(name, readFileSync(join(INTERPRETER_DIR, name), 'utf8')));
}

/** `name:line text`, the form every finding is reported in. */
export function at(source: Source, node: ts.Node, text: string): string {
  const { line } = source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast));
  return `${source.name}:${line + 1} ${text}`;
}

function each(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  node.forEachChild((child) => each(child, fn));
}

// ---- R10.2, R13.2: browser, network, timer, clock and randomness globals -------------

/** Names the interpreter must not use (task 11.2). `setInterval` is here because R10.2 bans timers. */
export const BANNED_NAMES: ReadonlySet<string> = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'window', 'document', 'setTimeout', 'setInterval', 'Date',
]);

/**
 * Uses of banned names in code: any identifier with a banned name, a string literal that is
 * exactly a banned name (so `globalThis['fetch']` counts), and `Math.random` in either access form.
 */
export function bannedUses(source: Source): string[] {
  const found: string[] = [];
  each(source.ast, (node) => {
    if (ts.isIdentifier(node) && BANNED_NAMES.has(node.text)) found.push(at(source, node, node.text));
    else if (ts.isStringLiteralLike(node) && BANNED_NAMES.has(node.text)) found.push(at(source, node, `"${node.text}"`));
    else if (isMathRandom(node)) found.push(at(source, node, 'Math.random'));
  });
  return found;
}

function isMathRandom(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isMath(node.expression) && node.name.text === 'random';
  }
  if (ts.isElementAccessExpression(node)) {
    return isMath(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'random';
  }
  return false;
}

function isMath(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && node.text === 'Math';
}

// ---- R13.2: imports stay inside src/hypertalk -----------------------------------------

/**
 * Every module a file names, with the line: static imports and exports (type-only ones
 * too), `import x = require()`, `import()` calls, `require()` calls and `import('…')` types.
 * A computed specifier is reported as `<computed>`, since a scan cannot know where it goes.
 */
export function moduleSpecifiers(source: Source): { node: ts.Node; specifier: string }[] {
  const found: { node: ts.Node; specifier: string }[] = [];
  const add = (node: ts.Node, spec: ts.Node | undefined) =>
    found.push({ node, specifier: spec && ts.isStringLiteralLike(spec) ? spec.text : '<computed>' });
  each(source.ast, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        add(node, node.arguments[0]);
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      add(node, ts.isLiteralTypeNode(arg) ? arg.literal : undefined);
    }
  });
  return found;
}

/** Imports that do not resolve to a file inside src/hypertalk: packages, `node:` modules, `../ui`, the compiler. */
export function outsideImports(source: Source): string[] {
  const dir = dirname(source.ast.fileName);
  return moduleSpecifiers(source)
    .filter(({ specifier }) => !isRelative(specifier) || !isInside(resolve(dir, specifier)))
    .map(({ node, specifier }) => at(source, node, `imports "${specifier}"`));
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../');
}

/** src/hypertalk itself (its index) or anything below it. */
function isInside(path: string): boolean {
  const rel = relative(INTERPRETER_DIR, path);
  return !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

// ---- R15.4: creature names live in the HAUNTS table only ------------------------------

export interface Literal {
  node: ts.Node;
  /** The literal's text without quotes. For a template, each text part is its own literal. */
  text: string;
}

/** Every string literal, including the text parts of templates and literal types such as `'bat'`. */
export function stringLiterals(source: Source): Literal[] {
  const found: Literal[] = [];
  each(source.ast, (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push({ node, text: node.text });
    }
  });
  return found;
}

/** True when `node` is inside the initializer of a top-level `const <name> = …`. */
export function insideConst(node: ts.Node, name: string): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      return n.initializer !== undefined && node.pos >= n.initializer.pos && node.end <= n.initializer.end;
    }
  }
  return false;
}

/** The lowercase words of a literal: letters, combining marks, digits and underscores. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{M}\d_]+/u).filter((w) => w !== '');
}
