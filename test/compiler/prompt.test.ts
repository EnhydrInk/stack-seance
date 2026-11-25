import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/hypertalk/index';
import { HAUNTS } from '../../src/hypertalk/tokens';
import type { CompileRequest } from '../../src/compiler/contract';
import { EXAMPLES, SYSTEM_PROMPT, userMessage } from '../../src/compiler/prompt';
import { RULES, checkReply, type RuleNumber } from '../../src/compiler/rules';
import { REPLY_SCHEMA } from '../../src/compiler/schema';
import { atticRequest, gateRequest, hallRequest } from './helpers/fixtures';

const CONTRACT_ORDER = ['sentence', 'stackName', 'cardNames', 'cardName', 'fieldNames', 'buttonNames', 'stackNames'];

const crypt: CompileRequest = {
  sentence: 'Clicking this opens the crypt of whispers and summons the witch',
  stackName: 'Graveyard Of Owls',
  cardNames: ['Crypt Door', 'Bone Room'],
  cardName: 'Crypt Door',
  fieldNames: ['epitaph'],
  buttonNames: ['Knock thrice'],
  stackNames: ['Graveyard Of Owls', 'Moonlit Mill'],
};

const lantern: CompileRequest = {
  sentence: '点一下灯笼就飞出一只蝙蝠然后去下一张卡片',
  stackName: '灯笼小屋',
  cardNames: ['门口', '院子'],
  cardName: '门口',
  fieldNames: ['提示'],
  buttonNames: ['敲门'],
  stackNames: ['灯笼小屋'],
};

function namesOf(request: CompileRequest): string[] {
  return [request.stackName, request.cardName, ...request.cardNames, ...request.fieldNames, ...request.buttonNames, ...request.stackNames];
}

describe('Requirement 6.4 one system prompt for every request', () => {
  it('is the same string after userMessage runs for two different requests', () => {
    const before = SYSTEM_PROMPT;
    const first = userMessage(crypt);
    const second = userMessage(lantern);
    expect(first).not.toBe(second);
    expect(SYSTEM_PROMPT).toBe(before);
  });

  it('holds neither request\'s sentence nor its names', () => {
    for (const request of [crypt, lantern]) {
      expect(SYSTEM_PROMPT).not.toContain(request.sentence);
      for (const name of namesOf(request)) expect(SYSTEM_PROMPT, name).not.toContain(name);
    }
  });

  it('is the same string after userMessage runs for a request with a label, and does not hold the label', () => {
    // recompile-keeps-label, Requirement 4.3.
    const recompile: CompileRequest = { ...crypt, label: 'Quokka lantern' };
    const before = SYSTEM_PROMPT;
    expect(userMessage(recompile)).toContain('"label":"Quokka lantern"');
    expect(SYSTEM_PROMPT).toBe(before);
    expect(SYSTEM_PROMPT).not.toContain('Quokka lantern');
  });
});

describe('recompile-keeps-label Requirement 4 the recompiling paragraph', () => {
  it('says that a recompiled button keeps the request\'s label, and how a script names it', () => {
    for (const text of [
      '\n\n# Recompiling\n\n',
      'it is being recompiled',
      "the reply's label is exactly the request's label, with the same characters and the same case",
      'button "<the label>"',
      'hasButton is false and label is empty',
    ]) {
      expect(SYSTEM_PROMPT, text).toContain(text);
    }
  });

  it('comes after the guidance and before the examples', () => {
    const recompiling = SYSTEM_PROMPT.indexOf('\n# Recompiling\n');
    expect(SYSTEM_PROMPT.indexOf('\n# Guidance\n')).toBeGreaterThan(0);
    expect(recompiling).toBeGreaterThan(SYSTEM_PROMPT.indexOf('\n# Guidance\n'));
    expect(recompiling).toBeLessThan(SYSTEM_PROMPT.indexOf('\n# Examples\n'));
  });
});

describe('Requirement 6.1 the subset and the rules', () => {
  it('states every rule with its RULES sentence, numbered', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as RuleNumber[]) {
      expect(SYSTEM_PROMPT).toContain(`\n${n}. ${RULES[n]}\n`);
    }
  });

  it('names every haunt of the interpreter with its words', () => {
    expect(HAUNTS.length).toBeGreaterThan(0);
    for (const haunt of HAUNTS) expect(SYSTEM_PROMPT).toContain(haunt.words.join(' '));
  });

  it('describes go to stack, the visual effects and both if forms', () => {
    for (const text of [
      'go to stack <target>',
      'visual effect dissolve', 'wipe left', 'wipe right', 'iris open', 'iris close',
      'else if <condition> then', 'end if', 'if <condition> then <statement> else <statement>',
      'put <expression> into field "<name>"', 'put <expression> after field "<name>"', 'put <expression> before field "<name>"',
      'show button "<name>"', 'hide field "<name>"', 'wait <expression> seconds', 'global <name>',
      'ask <expression>', 'answer <expression>',
    ]) {
      expect(SYSTEM_PROMPT, text).toContain(text);
    }
  });

  it('defines a short English name', () => {
    expect(SYSTEM_PROMPT).toContain(
      'A short English name is 1 to 24 printable ASCII characters, holds at least one letter, holds no double quote, and has no space at either end.',
    );
  });
});

describe('Requirement 6.7 no request for reasoning', () => {
  it('asks for no reasoning in the prompt or the schema', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/reasoning|step by step|explain|think/i);
    expect(Object.keys(REPLY_SCHEMA.properties)).toEqual(['hasButton', 'script', 'newCards', 'label', 'skipped']);
    expect(JSON.stringify(REPLY_SCHEMA)).not.toMatch(/reasoning|explain|think/i);
  });
});

describe('Requirement 6.2 and 6.3 the examples', () => {
  it('every example reply follows the rules for its own request', () => {
    for (const { request, reply } of EXAMPLES) {
      expect(checkReply(request, JSON.stringify(reply)), request.sentence).toStrictEqual({
        ok: true,
        reply: reply.hasButton
          ? { kind: 'button', label: reply.label, script: reply.script, newCards: reply.newCards, skipped: reply.skipped }
          : { kind: 'nothing', skipped: reply.skipped },
      });
    }
  });

  it('every example script parses, in the house style', () => {
    for (const { request, reply } of EXAMPLES.filter((e) => e.reply.hasButton)) {
      expect(parse(reply.script).ok, request.sentence).toBe(true);
      const lines = reply.script.split('\n');
      expect(lines[0]).toBe('on mouseUp');
      expect(lines[lines.length - 1]).toBe('end mouseUp');
      expect(reply.script).not.toContain('\r');
      expect(reply.script).not.toContain('--');
      for (const line of lines.slice(1, -1)) expect(line, line).toMatch(/^(  )+\S/);
    }
  });

  it('include a CJK sentence, a skipped part, a new card and a Nothing_Reply', () => {
    expect(EXAMPLES.some((e) => /[\u3040-\u30FF\u4E00-\u9FFF]/u.test(e.request.sentence))).toBe(true);
    expect(EXAMPLES.some((e) => e.reply.hasButton && e.reply.skipped.length > 0)).toBe(true);
    expect(EXAMPLES.some((e) => e.reply.newCards.length > 0)).toBe(true);
    expect(EXAMPLES.some((e) => !e.reply.hasButton)).toBe(true);
  });

  it('use the cards of the built-in Haunted House stack', () => {
    const cards = [hallRequest, gateRequest, atticRequest].map(({ sentence: _, ...card }) => card);
    for (const { request } of EXAMPLES) {
      const { sentence: _, ...card } = request;
      expect(cards, request.sentence).toContainEqual(card);
    }
  });

  it('are in the system prompt, each as userMessage writes the request, then the reply JSON', () => {
    for (const { request, reply } of EXAMPLES) {
      expect(SYSTEM_PROMPT).toContain(`${userMessage(request)}\n\nReply:\n${JSON.stringify(reply)}`);
    }
  });
});

describe('Requirement 6.5 the User_Message', () => {
  it('holds every field of the request, in contract order', () => {
    for (const request of [crypt, lantern, hallRequest]) {
      const text = userMessage(request);
      expect(text.startsWith('Compile this request:\n')).toBe(true);
      const body = JSON.parse(text.slice('Compile this request:\n'.length));
      expect(Object.keys(body)).toEqual(CONTRACT_ORDER);
      expect(body).toStrictEqual(request);
    }
  });

  it('writes the fields in contract order whatever order the object has, and nothing else', () => {
    const shuffled = { stackNames: ['Home'], buttonNames: [], fieldNames: [], cardName: 'Hall', cardNames: ['Hall'], stackName: 'Home', sentence: 'Go', extra: 'x' };
    expect(userMessage(shuffled as CompileRequest)).toBe(
      'Compile this request:\n{"sentence":"Go","stackName":"Home","cardNames":["Hall"],"cardName":"Hall","fieldNames":[],"buttonNames":[],"stackNames":["Home"]}',
    );
  });

  it('keeps CJK text unescaped and escapes quotes and line breaks in names', () => {
    expect(userMessage(lantern)).toContain('"sentence":"点一下灯笼就飞出一只蝙蝠然后去下一张卡片"');
    const odd = { ...crypt, cardNames: ['Say "boo"', 'Two\nlines'] };
    expect(userMessage(odd)).toContain('"cardNames":["Say \\"boo\\"","Two\\nlines"]');
  });
});

describe('recompile-keeps-label Requirement 3 the label in the User_Message', () => {
  it('holds the label after stackNames when the request has one', () => {
    const text = userMessage({ ...hallRequest, label: 'Dig' });
    const body = JSON.parse(text.slice('Compile this request:\n'.length));
    expect(Object.keys(body)).toEqual([...CONTRACT_ORDER, 'label']);
    expect(text).toBe(`${userMessage(hallRequest).slice(0, -1)},"label":"Dig"}`);
  });

  it('writes the label last whatever order the object has', () => {
    const shuffled = { label: 'Dig', stackNames: ['Home'], buttonNames: [], fieldNames: [], cardName: 'Hall', cardNames: ['Hall'], stackName: 'Home', sentence: 'Go' };
    expect(userMessage(shuffled)).toBe(
      'Compile this request:\n{"sentence":"Go","stackName":"Home","cardNames":["Hall"],"cardName":"Hall","fieldNames":[],"buttonNames":[],"stackNames":["Home"],"label":"Dig"}',
    );
  });

  it('holds no label when the request has none, even when label is undefined', () => {
    const today =
      'Compile this request:\n' +
      '{"sentence":"Clicking this goes to the kitchen and lets a bat out","stackName":"Haunted House",' +
      '"cardNames":["Gate","Hall","Attic","Garden"],"cardName":"Hall","fieldNames":["greeting","note"],' +
      '"buttonNames":["Light a candle","Open the closet","Upstairs","Go deeper","Back"],' +
      '"stackNames":["Home","Haunted House","Help"]}';
    expect(userMessage(hallRequest)).toBe(today);
    expect(userMessage({ ...hallRequest, label: undefined })).toBe(today);
  });
});

describe('Requirement 7.2 the Reply_Schema keywords', () => {
  const ALLOWED = new Set(['type', 'properties', 'items', 'required', 'additionalProperties', 'description']);

  /** Every keyword used in a schema node and the nodes below it. Property names are not keywords. */
  function keywords(node: Record<string, unknown>): string[] {
    const found = Object.keys(node);
    const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
    for (const child of Object.values(properties ?? {})) found.push(...keywords(child));
    if (node.items) found.push(...keywords(node.items as Record<string, unknown>));
    return found;
  }

  it('uses only type, properties, items, required, additionalProperties and description', () => {
    const used = keywords(REPLY_SCHEMA);
    expect(used.filter((k) => !ALLOWED.has(k))).toEqual([]);
    expect(new Set(used)).toEqual(ALLOWED);
  });

  it('requires all five fields and allows no others', () => {
    expect(REPLY_SCHEMA.required).toEqual(['hasButton', 'script', 'newCards', 'label', 'skipped']);
    expect(REPLY_SCHEMA.additionalProperties).toBe(false);
    expect(REPLY_SCHEMA.type).toBe('object');
  });
});
