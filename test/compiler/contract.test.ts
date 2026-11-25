import './helpers/noNetwork';
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  REQUEST_LIMITS,
  readCompileRequest,
  type CompileOutcome,
  type CompileRequest,
  type CompileResponse,
} from '../../src/compiler/contract';
import { ENGLISH_NAME_MAX } from '../../src/compiler/names';
import { readReplyObject, type ReplyObject } from '../../src/compiler/schema';

describe('Requirement 1.2 the contract types', () => {
  it('CompileRequest has exactly the contract fields and types', () => {
    expectTypeOf<CompileRequest>().toEqualTypeOf<{
      sentence: string;
      stackName: string;
      cardNames: string[];
      cardName: string;
      fieldNames: string[];
      buttonNames: string[];
      stackNames: string[];
      label?: string;
    }>();
  });

  it('CompileResponse has exactly the contract answers, error codes and scopes', () => {
    expectTypeOf<CompileResponse>().toEqualTypeOf<
      | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
      | { ok: false; error: 'nothing'; skipped: string[] }
      | { ok: false; error: 'limit'; scope: 'ip' | 'site' }
      | { ok: false; error: 'bad-request' }
      | { ok: false; error: 'unauthorized' }
      | { ok: false; error: 'model' }
    >();
  });

  it('CompileOutcome is the ok answer, nothing and model', () => {
    expectTypeOf<CompileOutcome>().toEqualTypeOf<
      | { ok: true; label: string; script: string; newCards: string[]; skipped: string[] }
      | { ok: false; error: 'nothing'; skipped: string[] }
      | { ok: false; error: 'model' }
    >();
    expectTypeOf<CompileOutcome>().toMatchTypeOf<CompileResponse>();
  });

  it('REQUEST_LIMITS holds the limits of Requirement 2.3 and 2.4, and the longest Request_Label', () => {
    expect(REQUEST_LIMITS).toEqual({ sentence: 500, names: 100, nameLength: 100, label: 24 });
    // A label that an earlier reply gave is an English_Name, so it must fit (recompile-keeps-label).
    expect(REQUEST_LIMITS.label).toBe(ENGLISH_NAME_MAX);
  });
});

const NAME_LISTS = ['cardNames', 'fieldNames', 'buttonNames', 'stackNames'] as const;
const STRING_FIELDS = ['sentence', 'stackName', 'cardName'] as const;

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sentence: 'Clicking this goes to the kitchen',
    stackName: 'Haunted House',
    cardNames: ['Gate', 'Hall', 'Attic', 'Garden'],
    cardName: 'Hall',
    fieldNames: ['greeting', 'note'],
    buttonNames: ['Upstairs', 'Back'],
    stackNames: ['Home', 'Haunted House', 'Help'],
    ...overrides,
  };
}

function without(field: string): Record<string, unknown> {
  const body = request();
  delete body[field];
  return body;
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `Card ${i + 1}`);

describe('Requirement 2.2 to 2.6 readCompileRequest', () => {
  it('accepts a request and returns its seven fields', () => {
    expect(readCompileRequest(request())).toEqual(request());
  });

  it('rejects a body that is not a non-array object', () => {
    for (const body of [[], [request()], null, undefined, 'text', 3, true]) {
      expect(readCompileRequest(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('rejects a body with any field missing', () => {
    for (const field of [...STRING_FIELDS, ...NAME_LISTS]) {
      expect(readCompileRequest(without(field)), field).toBeNull();
    }
  });

  it('rejects a string field of another type', () => {
    for (const field of STRING_FIELDS) {
      for (const value of [3, null, ['Hall'], { name: 'Hall' }, true]) {
        expect(readCompileRequest(request({ [field]: value })), `${field} = ${JSON.stringify(value)}`).toBeNull();
      }
    }
  });

  it('rejects a name list of another type, or one that holds a value that is not a string', () => {
    for (const field of NAME_LISTS) {
      for (const value of ['Hall', 3, null, { 0: 'Hall' }, ['Hall', 3], [null], [['Hall']]]) {
        expect(readCompileRequest(request({ [field]: value })), `${field} = ${JSON.stringify(value)}`).toBeNull();
      }
    }
  });

  it('takes sentences of 1 to 500 code units', () => {
    expect(readCompileRequest(request({ sentence: '' }))).toBeNull();
    expect(readCompileRequest(request({ sentence: 'a' }))?.sentence).toBe('a');
    expect(readCompileRequest(request({ sentence: 'a'.repeat(500) }))?.sentence).toBe('a'.repeat(500));
    expect(readCompileRequest(request({ sentence: 'a'.repeat(501) }))).toBeNull();
  });

  it('counts the sentence in UTF-16 code units', () => {
    // 250 characters outside the BMP are 500 code units, 251 are 502.
    expect(readCompileRequest(request({ sentence: '👻'.repeat(250) }))).not.toBeNull();
    expect(readCompileRequest(request({ sentence: '👻'.repeat(251) }))).toBeNull();
    expect(readCompileRequest(request({ sentence: '幽'.repeat(500) }))).not.toBeNull();
  });

  it('rejects a sentence with no character that is not white space', () => {
    for (const sentence of ['     ', '\t\n\t', '\r\n', '\u3000\u3000', ' \u3000\t']) {
      expect(readCompileRequest(request({ sentence })), JSON.stringify(sentence)).toBeNull();
    }
    expect(readCompileRequest(request({ sentence: '\u3000点\u3000' }))?.sentence).toBe('\u3000点\u3000');
  });

  it('takes lists of up to 100 names', () => {
    for (const field of NAME_LISTS) {
      expect(readCompileRequest(request({ [field]: names(100) }))?.[field], field).toEqual(names(100));
      expect(readCompileRequest(request({ [field]: names(101) })), field).toBeNull();
    }
  });

  it('takes names of up to 100 code units, in every field and list', () => {
    const ok = 'n'.repeat(100);
    const long = 'n'.repeat(101);
    for (const field of ['stackName', 'cardName'] as const) {
      expect(readCompileRequest(request({ [field]: ok }))?.[field], field).toBe(ok);
      expect(readCompileRequest(request({ [field]: long })), field).toBeNull();
    }
    for (const field of NAME_LISTS) {
      expect(readCompileRequest(request({ [field]: ['Gate', ok] }))?.[field], field).toEqual(['Gate', ok]);
      expect(readCompileRequest(request({ [field]: ['Gate', long] })), field).toBeNull();
    }
  });

  it('accepts the empty string as stackName, as cardName and in every list', () => {
    const body = request({
      stackName: '',
      cardName: '',
      cardNames: ['', 'Hall'],
      fieldNames: [''],
      buttonNames: [''],
      stackNames: ['', ''],
    });
    expect(readCompileRequest(body)).toEqual(body);
  });

  it('accepts empty lists', () => {
    const body = request({ cardNames: [], fieldNames: [], buttonNames: [], stackNames: [] });
    expect(readCompileRequest(body)).toEqual(body);
  });

  it('drops fields that CompileRequest does not define', () => {
    const result = readCompileRequest(request({ extra: 'x', name: 'Hi', __proto__: { polluted: true } }));
    expect(result).toEqual(request());
    expect(Object.keys(result!)).toEqual([
      'sentence', 'stackName', 'cardNames', 'cardName', 'fieldNames', 'buttonNames', 'stackNames',
    ]);
  });

  it('returns new arrays', () => {
    const body = request();
    const result = readCompileRequest(body)!;
    for (const field of NAME_LISTS) {
      expect(result[field]).toEqual(body[field]);
      expect(result[field]).not.toBe(body[field]);
    }
  });
});

describe('Requirement 4.10 readReplyObject', () => {
  const button: ReplyObject = {
    hasButton: true,
    script: 'on mouseUp\n  go to card "Kitchen"\n  release bat\nend mouseUp',
    newCards: ['Kitchen'],
    label: 'To the kitchen',
    skipped: [],
  };
  const nothing: ReplyObject = { hasButton: false, script: '', newCards: [], label: '', skipped: ['send an email'] };

  it('reads a Button_Reply and a Nothing_Reply', () => {
    expect(readReplyObject(JSON.stringify(button))).toEqual(button);
    expect(readReplyObject(JSON.stringify(nothing))).toEqual(nothing);
  });

  it('reads the fields in any order and with white space around the JSON', () => {
    const reordered = { skipped: [], label: 'To the kitchen', newCards: ['Kitchen'], script: button.script, hasButton: true };
    expect(readReplyObject(`\n  ${JSON.stringify(reordered, null, 2)}  \n`)).toEqual(button);
  });

  it('gives null for text that is not JSON', () => {
    for (const text of ['', 'hello', '{"hasButton": true', JSON.stringify(button).slice(0, -1), "{'hasButton': true}"]) {
      expect(readReplyObject(text), text).toBeNull();
    }
  });

  it('gives null for JSON that is not an object', () => {
    for (const value of [[button], [], null, 'text', 3, true]) {
      expect(readReplyObject(JSON.stringify(value)), JSON.stringify(value)).toBeNull();
    }
  });

  it('gives null when a field is missing', () => {
    for (const field of Object.keys(button)) {
      const value: Record<string, unknown> = { ...button };
      delete value[field];
      expect(readReplyObject(JSON.stringify(value)), field).toBeNull();
    }
  });

  it('gives null when there is an extra field', () => {
    expect(readReplyObject(JSON.stringify({ ...button, reasoning: 'because' }))).toBeNull();
    expect(readReplyObject(JSON.stringify({ ...nothing, extra: null }))).toBeNull();
  });

  it('gives null when a field has the wrong type', () => {
    const wrong: Record<keyof ReplyObject, unknown[]> = {
      hasButton: ['true', 1, null],
      script: [null, 3, ['on mouseUp']],
      newCards: ['Kitchen', null, [3], [['Kitchen']]],
      label: [null, 3, ['Go']],
      skipped: ['play a song', null, [true]],
    };
    for (const [field, values] of Object.entries(wrong)) {
      for (const value of values) {
        expect(readReplyObject(JSON.stringify({ ...button, [field]: value })), `${field} = ${JSON.stringify(value)}`).toBeNull();
      }
    }
  });
});
