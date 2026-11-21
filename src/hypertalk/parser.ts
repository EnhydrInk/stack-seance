// Recursive-descent parser for the v1 HyperTalk subset (see design.md, "Parser").
// Reports the first syntax error only and never throws (R12.3).

import type { BinOp, Effect, Expr, Handler, HandlerName, IfStmt, NavTarget, Pos, Script, Stmt } from './ast';
import { clampLine, lineCount, syntaxError, type SyntaxError } from './errors';
import { tokenize } from './lexer';
import { HAUNTS, isReserved, type Haunt, type Token } from './tokens';

export type ParseResult = { ok: true; script: Script } | { ok: false; error: SyntaxError };

/** Parses a script. Error lines are forced into the script as a last guard (P4). */
export function parse(source: string): ParseResult {
  const result = parseUnguarded(source);
  if (result.ok) return result;
  return { ok: false, error: { ...result.error, line: clampLine(result.error.line, lineCount(source)) } };
}

/**
 * The parser without the line guard. Not part of the public API: the P4 property test
 * runs against it so that the guard cannot hide a wrong line.
 */
export function parseUnguarded(source: string): ParseResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return lexed;
  const parser = new Parser(lexed.tokens);
  try {
    return { ok: true, script: parser.script() };
  } catch (e) {
    if (e instanceof ParseAbort) return { ok: false, error: e.error };
    const at = parser.current();
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: syntaxError(at.line, at.column, `internal parser error: ${detail}`) };
  }
}

class ParseAbort {
  constructor(readonly error: SyntaxError) {}
}

const HANDLER_NAMES: ReadonlyMap<string, HandlerName> = new Map([
  ['mouseup', 'mouseUp'],
  ['opencard', 'openCard'],
]);

const NAV_TARGETS: ReadonlySet<string> = new Set<NavTarget>(['next', 'prev', 'first', 'last']);

const CALCULATION_OPS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '&', '&&']);

/** Haunt entries by their first word (R15.1). */
const HAUNT_BY_FIRST_WORD: ReadonlyMap<string, Haunt> = new Map(HAUNTS.map((h) => [h.words[0], h]));

const pos = (at: Pos): Pos => ({ line: at.line, column: at.column });

function describe(t: Token): string {
  switch (t.kind) {
    case 'newline': return 'the end of the line';
    case 'eof': return 'the end of the script';
    case 'string': return t.text;
    default: return `"${t.text}"`;
  }
}

class Parser {
  private i = 0;
  private handlerName: HandlerName = 'mouseUp';

  constructor(private readonly tokens: Token[]) {}

  // ---- token helpers ------------------------------------------------------

  current(): Token {
    return this.peek(0);
  }

  private peek(offset: number): Token {
    // The lexer always ends the list with eof, so this never runs past it.
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]!;
  }

  private previous(): Token | undefined {
    return this.i > 0 ? this.tokens[this.i - 1] : undefined;
  }

  private advance(): Token {
    const t = this.current();
    if (t.kind !== 'eof') this.i++;
    return t;
  }

  private atWord(word: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'word' && t.text.toLowerCase() === word;
  }

  private atOp(op: string): boolean {
    const t = this.current();
    return t.kind === 'op' && t.text === op;
  }

  private atLineEnd(): boolean {
    const k = this.current().kind;
    return k === 'newline' || k === 'eof';
  }

  private skipNewlines(): void {
    while (this.current().kind === 'newline') this.i++;
  }

  private fail(at: Pos, message: string): never {
    throw new ParseAbort(syntaxError(at.line, at.column, message));
  }

  /** Checks that the line ends here, without consuming the line break. */
  private expectLineEnd(after: string): void {
    if (!this.atLineEnd()) this.fail(this.current(), `unexpected ${describe(this.current())} after ${after}`);
  }

  private expectWord(word: string, message: string): Token {
    if (!this.atWord(word)) this.fail(this.current(), message);
    return this.advance();
  }

  private quoted(message: string): string {
    const t = this.current();
    if (t.kind !== 'string') this.fail(t, message);
    this.advance();
    return t.value;
  }

  // ---- script and handlers (R1) -------------------------------------------

  script(): Script {
    const handlers: Handler[] = [];
    const seen = new Set<HandlerName>();
    for (;;) {
      this.skipNewlines();
      const t = this.current();
      if (t.kind === 'eof') return { handlers };
      if (this.atWord('end')) this.fail(t, '"end" without a matching "on"');
      if (!this.atWord('on')) {
        this.fail(t, 'expected "on mouseUp" or "on openCard" here; commands must be inside a handler');
      }
      handlers.push(this.handler(seen));
    }
  }

  private handler(seen: Set<HandlerName>): Handler {
    const on = this.advance();
    const nameTok = this.current();
    if (nameTok.kind !== 'word') this.fail(nameTok, 'expected a handler name after "on"');
    const name = HANDLER_NAMES.get(nameTok.text.toLowerCase());
    if (!name) this.fail(nameTok, `unknown handler "${nameTok.text}"; v1 supports mouseUp and openCard`);
    if (seen.has(name)) this.fail(on, `this script already has an "on ${name}" handler`);
    seen.add(name);
    this.handlerName = name;
    this.advance();
    this.expectLineEnd(`"on ${name}"`);

    const body = this.block();

    const t = this.current();
    if (t.kind === 'eof') this.fail(on, `"on ${name}" is never closed; add "end ${name}"`);
    if (this.atWord('else')) {
      this.fail(t, '"else" without a matching "if"; a one-line if keeps its else on the same line');
    }
    // block() stops only at eof, "else" or "end".
    const end = this.advance();
    if (this.atWord('if')) this.fail(end, '"end if" without a matching "if" (a one-line if has no "end if")');
    const endName = this.current();
    if (endName.kind !== 'word' || endName.text.toLowerCase() !== name.toLowerCase()) {
      const found = endName.kind === 'word' ? ` but found "end ${endName.text}"` : '';
      this.fail(end, `expected "end ${name}"${found}`);
    }
    this.advance();
    this.expectLineEnd(`"end ${name}"`);
    return { name, body, pos: pos(on) };
  }

  /** Statements up to (not including) eof, "else" or "end" at the start of a line. */
  private block(): Stmt[] {
    const body: Stmt[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.current().kind === 'eof' || this.atWord('end') || this.atWord('else')) return body;
      body.push(this.statement(false));
      this.expectLineEnd('the command');
    }
  }

  // ---- statements ---------------------------------------------------------

  private statement(inOneLineIf: boolean): Stmt {
    const t = this.current();
    if (t.kind !== 'word') {
      this.fail(t, `expected a command such as go, put or answer, but found ${describe(t)}`);
    }
    switch (t.text.toLowerCase()) {
      case 'go': return this.go();
      case 'visual': return this.visualEffect();
      case 'answer': return this.answer();
      case 'ask': return this.ask();
      case 'put': return this.put();
      case 'show':
      case 'hide': return this.showHide();
      case 'wait': return this.wait();
      case 'global': return this.global();
      case 'if':
        if (inOneLineIf) this.fail(t, 'an if inside a one-line if needs the block form with "end if"');
        return this.ifStatement();
      case 'on':
        return this.fail(t, `a new handler starts here; add "end ${this.handlerName}" before it`);
      default: {
        const haunt = HAUNT_BY_FIRST_WORD.get(t.text.toLowerCase());
        if (haunt) return this.haunt(haunt);
        if (isReserved(t.text)) {
          this.fail(t, `expected a command such as go, put or answer, but found ${describe(t)}`);
        }
        return this.fail(t, `unknown command "${t.text}"`);
      }
    }
  }

  // The words of one HAUNTS entry, in order   (R15.1)
  private haunt(entry: Haunt): Stmt {
    const first = this.advance();
    let last = first;
    for (const word of entry.words.slice(1)) {
      last = this.expectWord(word, `expected "${word}" after "${last.text}"`);
    }
    return { t: 'haunt', kind: entry.kind, pos: pos(first) };
  }

  // go [to] next|prev|first|last card | go [to] card <primary>   (R2.1)
  private go(): Stmt {
    const go = this.advance();
    if (this.atWord('to')) this.advance();
    const t = this.current();
    const word = t.kind === 'word' ? t.text.toLowerCase() : '';
    if (NAV_TARGETS.has(word)) {
      this.advance();
      this.expectWord('card', `expected "card" after "${t.text}"`);
      return { t: 'go', target: { k: word as NavTarget }, pos: pos(go) };
    }
    if (word === 'card') {
      this.advance();
      const expr = this.primary();
      const after = this.current();
      if (after.kind === 'op' && CALCULATION_OPS.has(after.text)) {
        this.fail(after, 'put a calculated card number in parentheses, for example go to card (n + 1)');
      }
      return { t: 'go', target: { k: 'card', expr }, pos: pos(go) };
    }
    this.fail(t, 'expected next card, prev card, first card, last card or card … after "go"');
  }

  // visual effect dissolve | wipe left | wipe right | iris open | iris close   (R3.1)
  private visualEffect(): Stmt {
    const visual = this.advance();
    this.expectWord('effect', 'expected "effect" after "visual"');
    const t = this.current();
    const word = t.kind === 'word' ? t.text.toLowerCase() : '';
    let effect: Effect | undefined;
    if (word === 'dissolve') {
      this.advance();
      effect = 'dissolve';
    } else if (word === 'wipe' || word === 'iris') {
      this.advance();
      const d = this.current();
      const dir = d.kind === 'word' ? d.text.toLowerCase() : '';
      const options: Record<string, Effect> =
        word === 'wipe' ? { left: 'wipeLeft', right: 'wipeRight' } : { open: 'irisOpen', close: 'irisClose' };
      effect = options[dir];
      if (!effect) {
        const expected = word === 'wipe' ? '"left" or "right"' : '"open" or "close"';
        this.fail(d, `expected ${expected} after "${t.text}"`);
      }
      this.advance();
    } else {
      this.fail(t, 'unknown visual effect; use dissolve, wipe left, wipe right, iris open or iris close');
    }
    return { t: 'effect', effect, pos: pos(visual) };
  }

  // answer <expr> [with "<label>" [or "<label>" [or "<label>"]]]   (R4.1, R4.2)
  private answer(): Stmt {
    const answer = this.advance();
    const prompt = this.expression();
    const labels: string[] = [];
    if (this.atWord('with')) {
      this.advance();
      labels.push(this.quoted('button labels after "with" must be in quotes'));
      while (this.atWord('or')) {
        this.advance();
        if (labels.length === 3) this.fail(this.current(), 'answer can show at most 3 buttons');
        labels.push(this.quoted('button labels after "or" must be in quotes'));
      }
    }
    return { t: 'answer', prompt, labels, pos: pos(answer) };
  }

  // ask <expr>   (R4.3)
  private ask(): Stmt {
    const ask = this.advance();
    return { t: 'ask', prompt: this.expression(), pos: pos(ask) };
  }

  // put <expr> into|after|before field "<name>" | put <expr> into <variable>   (R5.1, R5.5)
  private put(): Stmt {
    const put = this.advance();
    const value = this.expression();
    const t = this.current();
    const word = t.kind === 'word' ? t.text.toLowerCase() : '';
    if (word === 'into') {
      this.advance();
      if (this.atWord('field')) return { t: 'putField', value, mode: 'into', field: this.fieldName(), pos: pos(put) };
      return { t: 'putVar', value, name: this.variableName('"into"'), pos: pos(put) };
    }
    if (word === 'after' || word === 'before') {
      this.advance();
      if (this.atWord('field')) return { t: 'putField', value, mode: word, field: this.fieldName(), pos: pos(put) };
      const target = this.current();
      if (target.kind === 'word') {
        this.fail(target, `"put … ${word}" works only with fields in v1; use "put … into" for a variable`);
      }
      this.fail(target, `expected field "<name>" after "${t.text}"`);
    }
    this.fail(t, 'expected "into", "after" or "before" after the value');
  }

  // show|hide button|field "<name>"   (R6.1)
  private showHide(): Stmt {
    const cmd = this.advance();
    const t = this.current();
    const kind = t.kind === 'word' ? t.text.toLowerCase() : '';
    if (kind !== 'button' && kind !== 'field') this.fail(t, `expected "button" or "field" after "${cmd.text}"`);
    this.advance();
    const name = this.quoted(`expected a ${kind} name in quotes after "${t.text}"`);
    return { t: cmd.text.toLowerCase() as 'show' | 'hide', kind, name, pos: pos(cmd) };
  }

  // wait <expr> second[s]   (R7.1)
  private wait(): Stmt {
    const wait = this.advance();
    const seconds = this.expression();
    if (!this.atWord('second') && !this.atWord('seconds')) {
      this.fail(this.current(), 'expected "seconds" after the number');
    }
    this.advance();
    return { t: 'wait', seconds, pos: pos(wait) };
  }

  // global <name> {, <name>}   (R8.2, R8.4)
  private global(): Stmt {
    const global = this.advance();
    const names = [this.variableName('"global"')];
    while (this.atOp(',')) {
      this.advance();
      names.push(this.variableName('","'));
    }
    return { t: 'global', names, pos: pos(global) };
  }

  private fieldName(): string {
    const field = this.advance();
    return this.quoted(`expected a field name in quotes after "${field.text}"`);
  }

  private variableName(after: string): string {
    const t = this.current();
    if (t.kind !== 'word') this.fail(t, `expected a variable name after ${after}`);
    if (isReserved(t.text)) this.fail(t, `"${t.text}" is a reserved word and cannot be a variable name`);
    this.advance();
    return t.text;
  }

  // ---- if (R9) ------------------------------------------------------------

  private ifStatement(): IfStmt {
    const head = this.advance();
    const cond = this.expression();
    this.expectWord('then', 'expected "then" after the condition');
    return this.atLineEnd() ? this.blockIf(head, cond) : this.oneLineIf(head, cond);
  }

  /**
   * if c then / … / {else if c then / …} / [else / …] / end if
   * Every unclosed case reports the line of the first `if` (R9.5).
   */
  private blockIf(head: Token, cond: Expr): IfStmt {
    const notClosed = (): never => this.fail(head, '"if" is never closed; add "end if"');
    const root: IfStmt = { t: 'if', cond, then: this.block(), else: [], pos: pos(head) };
    let tail = root;
    for (;;) {
      if (this.atWord('end')) {
        if (!this.atWord('if', 1)) notClosed();
        this.advance();
        this.advance();
        return root;
      }
      if (!this.atWord('else')) notClosed(); // eof
      this.advance();

      if (this.atWord('if')) {
        // else if c then — a link in the chain (R9.6)
        const linkIf = this.advance();
        const linkCond = this.expression();
        this.expectWord('then', 'expected "then" after the condition');
        if (!this.atLineEnd()) {
          this.fail(this.current(), 'after "else if … then", start the commands on the next line');
        }
        const link: IfStmt = { t: 'if', cond: linkCond, then: this.block(), else: [], pos: pos(linkIf) };
        tail.else = [link];
        tail = link;
        continue;
      }

      if (!this.atLineEnd()) this.fail(this.current(), 'after "else", start the commands on the next line');
      tail.else = this.block();
      if (this.atWord('else')) this.fail(this.current(), 'this "if" already has an "else"');
      if (!(this.atWord('end') && this.atWord('if', 1))) notClosed();
      this.advance();
      this.advance();
      return root;
    }
  }

  /** if c then <statement> [else <statement>] on one line. */
  private oneLineIf(head: Token, cond: Expr): IfStmt {
    const thenStmt = this.statement(true);
    let elseStmts: Stmt[] = [];
    if (this.atWord('else')) {
      this.advance();
      if (this.atWord('if')) {
        this.fail(this.current(), '"else if" needs the block form: put the commands on their own lines and end with "end if"');
      }
      if (this.atLineEnd()) this.fail(this.current(), 'expected a command after "else"');
      elseStmts = [this.statement(true)];
    }
    return { t: 'if', cond, then: [thenStmt], else: elseStmts, pos: pos(head) };
  }

  // ---- expressions (R11.2: or < and < not < comparison < & && < + - < * / < primary)

  private expression(): Expr {
    return this.orExpr();
  }

  private orExpr(): Expr {
    let left = this.andExpr();
    while (this.atWord('or')) {
      const op = this.advance();
      left = { t: 'bin', op: 'or', left, right: this.andExpr(), pos: pos(op) };
    }
    return left;
  }

  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.atWord('and')) {
      const op = this.advance();
      left = { t: 'bin', op: 'and', left, right: this.notExpr(), pos: pos(op) };
    }
    return left;
  }

  private notExpr(): Expr {
    if (this.atWord('not')) {
      const not = this.advance();
      return { t: 'not', operand: this.notExpr(), pos: pos(not) };
    }
    return this.comparison();
  }

  /** One comparison at most: `1 < 2 < 3` is an error (R11.2). */
  private comparison(): Expr {
    const left = this.concat();
    const first = this.comparisonOp();
    if (!first) return left;
    const opTok = this.current();
    this.i += first.width;
    const right = this.concat();
    if (this.comparisonOp()) {
      this.fail(this.current(), 'comparisons cannot be chained; join them with "and"');
    }
    return { t: 'bin', op: first.op, left, right, pos: pos(opTok) };
  }

  /** Looks at the current token(s) without consuming them. */
  private comparisonOp(): { op: BinOp; width: number } | undefined {
    const t = this.current();
    if (t.kind === 'op' && (t.text === '<' || t.text === '>' || t.text === '<=' || t.text === '>=')) {
      return { op: t.text, width: 1 };
    }
    if (this.atWord('is')) return this.atWord('not', 1) ? { op: 'isNot', width: 2 } : { op: 'is', width: 1 };
    if (this.atWord('contains')) return { op: 'contains', width: 1 };
    return undefined;
  }

  private concat(): Expr {
    return this.leftAssoc(() => this.additive(), ['&', '&&']);
  }

  private additive(): Expr {
    return this.leftAssoc(() => this.multiplicative(), ['+', '-']);
  }

  private multiplicative(): Expr {
    return this.leftAssoc(() => this.primary(), ['*', '/']);
  }

  private leftAssoc(operand: () => Expr, ops: readonly ('&' | '&&' | '+' | '-' | '*' | '/')[]): Expr {
    let left = operand();
    for (;;) {
      const t = this.current();
      const op = t.kind === 'op' ? ops.find((o) => o === t.text) : undefined;
      if (!op) return left;
      this.advance();
      left = { t: 'bin', op, left, right: operand(), pos: pos(t) };
    }
  }

  private primary(): Expr {
    const t = this.current();
    switch (t.kind) {
      case 'string':
        this.advance();
        return { t: 'str', value: t.value, pos: pos(t) };
      case 'number':
        this.advance();
        return { t: 'num', value: t.value, pos: pos(t) };
      case 'op':
        if (t.text === '(') {
          this.advance();
          const inner = this.expression();
          if (!this.atOp(')')) {
            this.fail(this.current(), `missing ")" to close the "(" at column ${t.column}`);
          }
          this.advance();
          return { t: 'paren', inner, pos: pos(t) };
        }
        if (t.text === '-') this.fail(t, 'negative numbers are not supported; write 0 - 5 instead of -5');
        return this.fail(t, `expected a value but found "${t.text}"`);
      case 'word': {
        const word = t.text.toLowerCase();
        if (word === 'true' || word === 'false') {
          this.advance();
          return { t: 'bool', value: word === 'true', pos: pos(t) };
        }
        if (word === 'field') return { t: 'field', name: this.fieldName(), pos: pos(t) };
        if (isReserved(word)) this.fail(t, `expected a value but found "${t.text}", which is a reserved word`);
        this.advance();
        return { t: 'var', name: t.text, pos: pos(t) };
      }
      case 'newline':
      case 'eof': {
        const prev = this.previous();
        return this.fail(t, prev ? `expected a value after ${describe(prev)}` : 'expected a value');
      }
    }
  }
}
