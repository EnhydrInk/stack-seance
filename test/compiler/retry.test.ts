import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import { compile, MAX_MODEL_CALLS } from '../../src/compiler/compile';
import type { CallEvent, ModelInput } from '../../src/compiler/model';
import { SYSTEM_PROMPT, userMessage } from '../../src/compiler/prompt';
import { REPLY_SCHEMA } from '../../src/compiler/schema';
import { hallRequest, mouseUp, nothingText, replyText } from './helpers/fixtures';
import { refusalStep, rejectStep, replyStep, scriptedAsk, type Step } from './helpers/fakeModel';

const HALL_USER_MESSAGE =
  'Compile this request:\n' +
  '{"sentence":"Clicking this goes to the kitchen and lets a bat out","stackName":"Haunted House",' +
  '"cardNames":["Gate","Hall","Attic","Garden"],"cardName":"Hall","fieldNames":["greeting","note"],' +
  '"buttonNames":["Light a candle","Open the closet","Upstairs","Go deeper","Back"],' +
  '"stackNames":["Home","Haunted House","Help"]}';

const RULE_3 =
  'Rule 3: Every go to card with a literal name names a card in cardNames or newCards, and every literal card number is a whole number from 1 to the number of cards in cardNames plus newCards.';
const RULE_7 =
  'Rule 7: When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames.';
const RULE_10 =
  'Rule 10: The reply is one JSON object with hasButton, script, newCards, label and skipped; when hasButton is false, script and label are empty, newCards is empty, and skipped holds at least one phrase.';
const ASK_AGAIN = 'Write the whole reply again as one JSON object that follows every rule.';

const VALID = {
  script: mouseUp('go to card "Kitchen"', 'release bat'),
  newCards: ['Kitchen'],
  label: 'To the kitchen',
  skipped: [],
};

/** Compiles hallRequest against the steps, and keeps the inputs and the CallEvents. */
async function run(steps: Step[]) {
  const { ask, inputs } = scriptedAsk(steps);
  const events: CallEvent[] = [];
  const outcome = await compile(hallRequest, ask, (e) => events.push(e));
  return { outcome, inputs, events };
}

/** Every call has the same system and schema, its own messages array, and starts with the previous call's messages. */
function expectAppendOnly(inputs: readonly ModelInput[]): void {
  inputs.forEach((input, i) => {
    expect(input.system).toBe(SYSTEM_PROMPT);
    expect(input.schema).toBe(REPLY_SCHEMA);
    if (i === 0) return;
    const previous = inputs[i - 1]!;
    expect(input.messages).not.toBe(previous.messages);
    expect(input.messages).toHaveLength(previous.messages.length + 2);
    previous.messages.forEach((message, k) => expect(input.messages[k]).toBe(message));
  });
}

describe('Requirement 5 the retry loop', () => {
  it('allows three calls', () => {
    expect(MAX_MODEL_CALLS).toBe(3);
  });

  it('succeeds on the second reply, after a Rule 3 break', async () => {
    const first = replyStep(replyText({ ...VALID, script: mouseUp('go to card "Kichen"', 'release bat'), newCards: [] }));
    const { outcome, inputs, events } = await run([first, replyStep(replyText(VALID))]);

    expect(outcome).toStrictEqual({ ok: true, ...VALID });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.messages).toStrictEqual([{ role: 'user', text: HALL_USER_MESSAGE }]);
    expect(inputs[1]!.messages).toStrictEqual([
      { role: 'user', text: HALL_USER_MESSAGE },
      { role: 'assistant', turn: (first as { turn: unknown }).turn },
      {
        role: 'user',
        text: [
          'Your reply broke these rules.',
          '',
          RULE_3,
          '- Line 2: go to card "Kichen" names no card in cardNames or newCards.',
          '',
          ASK_AGAIN,
        ].join('\n'),
      },
    ]);
    // The Assistant_Turn goes back as the same object, unchanged.
    expect((inputs[1]!.messages[1] as { turn: unknown }).turn).toBe((first as { turn: unknown }).turn);
    expectAppendOnly(inputs);
    expect(events).toStrictEqual([
      { call: 1, result: 'broken', rules: [3] },
      { call: 2, result: 'accepted' },
    ]);
  });

  it('gives nothing on the first call for a Nothing_Reply', async () => {
    const { outcome, inputs, events } = await run([replyStep(nothingText({ skipped: ['send an email'] }))]);
    expect(outcome).toStrictEqual({ ok: false, error: 'nothing', skipped: ['send an email'] });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.messages).toStrictEqual([{ role: 'user', text: HALL_USER_MESSAGE }]);
    expectAppendOnly(inputs);
    expect(events).toStrictEqual([{ call: 1, result: 'accepted' }]);
  });

  it('gives model after three broken replies, with every broken rule sent back', async () => {
    const steps = [
      replyStep(replyText({ ...VALID, script: mouseUp('go to card "Kichen"'), newCards: [], label: 'Go to the kitchen and let a bat out' })),
      replyStep('{"hasButton": true, "script": "on mouseUp'),
      replyStep(replyText({ ...VALID, label: 'upstairs' })),
      replyStep(replyText(VALID)),
    ];
    const { outcome, inputs, events } = await run(steps);

    expect(outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(inputs).toHaveLength(3);
    expect(inputs[2]!.messages).toStrictEqual([
      { role: 'user', text: HALL_USER_MESSAGE },
      { role: 'assistant', turn: (steps[0] as { turn: unknown }).turn },
      {
        role: 'user',
        text: [
          'Your reply broke these rules.',
          '',
          RULE_3,
          '- Line 2: go to card "Kichen" names no card in cardNames or newCards.',
          RULE_7,
          '- The label "Go to the kitchen and let a bat out" is 35 characters long, more than 24.',
          '',
          ASK_AGAIN,
        ].join('\n'),
      },
      { role: 'assistant', turn: (steps[1] as { turn: unknown }).turn },
      {
        role: 'user',
        text: [
          'Your reply broke these rules.',
          '',
          RULE_10,
          '- The reply is not one JSON object with the five fields hasButton, script, newCards, label and skipped.',
          '',
          ASK_AGAIN,
        ].join('\n'),
      },
    ]);
    expectAppendOnly(inputs);
    expect(events).toStrictEqual([
      { call: 1, result: 'broken', rules: [3, 7] },
      { call: 2, result: 'broken', rules: [10] },
      { call: 3, result: 'broken', rules: [7] },
    ]);
  });

  it('gives model after a Refusal on call 2, without a third call', async () => {
    const broken = replyStep(replyText({ ...VALID, label: '' }));
    const { outcome, inputs, events } = await run([broken, refusalStep(), replyStep(replyText(VALID))]);
    expect(outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(inputs).toHaveLength(2);
    expectAppendOnly(inputs);
    expect(events).toStrictEqual([
      { call: 1, result: 'broken', rules: [7] },
      { call: 2, result: 'refusal' },
    ]);
  });

  it('gives model after a Refusal on call 1', async () => {
    const { outcome, inputs, events } = await run([refusalStep(), replyStep(replyText(VALID))]);
    expect(outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(inputs).toHaveLength(1);
    expect(events).toStrictEqual([{ call: 1, result: 'refusal' }]);
  });

  it('gives model after a rejected call 1, without a second call', async () => {
    const { outcome, inputs, events } = await run([rejectStep(), replyStep(replyText(VALID))]);
    expect(outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(inputs).toHaveLength(1);
    expect(events).toStrictEqual([{ call: 1, result: 'failed' }]);
  });

  it('gives model after a rejected call 3, and after an ask that throws without a promise', async () => {
    const broken = () => replyStep(replyText({ ...VALID, newCards: [] }));
    const late = await run([broken(), broken(), rejectStep('timeout')]);
    expect(late.outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(late.inputs).toHaveLength(3);
    expect(late.events).toStrictEqual([
      { call: 1, result: 'broken', rules: [3] },
      { call: 2, result: 'broken', rules: [3] },
      { call: 3, result: 'failed' },
    ]);

    const events: CallEvent[] = [];
    const outcome = await compile(hallRequest, () => { throw new Error('no client'); }, (e) => events.push(e));
    expect(outcome).toStrictEqual({ ok: false, error: 'model' });
    expect(events).toStrictEqual([{ call: 1, result: 'failed' }]);
  });

  it('accepts a reply on the third call', async () => {
    const broken = replyStep(replyText({ ...VALID, label: 'Back' }));
    const { outcome, inputs, events } = await run([broken, broken, replyStep(nothingText())]);
    expect(outcome).toStrictEqual({ ok: false, error: 'nothing', skipped: ['send an email'] });
    expect(inputs).toHaveLength(3);
    expectAppendOnly(inputs);
    expect(events.map((e) => e.result)).toEqual(['broken', 'broken', 'accepted']);
  });

  it('works without onCall, and never sends the CallEvents any reply text', async () => {
    const { ask } = scriptedAsk([replyStep(replyText(VALID))]);
    expect(await compile(hallRequest, ask)).toStrictEqual({ ok: true, ...VALID });

    const { events } = await run([replyStep(replyText({ ...VALID, label: 'Kitchen ' })), replyStep(replyText(VALID))]);
    expect(JSON.stringify(events)).not.toContain('Kitchen');
  });

  it('builds the User_Message from the request it is given', async () => {
    const { ask, inputs } = scriptedAsk([replyStep(nothingText())]);
    const request = { ...hallRequest, sentence: '点一下就问访客叫什么名字' };
    await compile(request, ask);
    expect(inputs[0]!.messages).toStrictEqual([{ role: 'user', text: userMessage(request) }]);
    expect((inputs[0]!.messages[0] as { text: string }).text).toContain('点一下就问访客叫什么名字');
  });
});
