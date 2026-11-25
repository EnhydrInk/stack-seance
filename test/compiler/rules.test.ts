import './helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import { RULES, checkReply, type RuleReport } from '../../src/compiler/rules';
import type { CompileRequest } from '../../src/compiler/contract';
import { digRequest, hallRequest, mouseUp, nothingText, replyText } from './helpers/fixtures';

/** The reports for a reply, or [] when it is accepted. */
function reports(text: string, request: CompileRequest = hallRequest): RuleReport[] {
  const result = checkReply(request, text);
  return result.ok ? [] : result.reports;
}

function expectAccepted(text: string, request: CompileRequest = hallRequest): void {
  expect(checkReply(request, text)).toMatchObject({ ok: true });
}

const r = (rule: RuleReport['rule'], detail: string): RuleReport => ({ rule, detail });

describe('RULES', () => {
  it('holds one sentence for each of Rules 1 to 10', () => {
    expect(Object.keys(RULES)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(RULES[1]).toBe('The script parses as HyperTalk of this subset.');
    expect(RULES[8]).toBe('After a go, the script names no field and no button, and after a go to stack it names no card.');
  });

  it('states Rule 7 for a request with a label and for one without', () => {
    // recompile-keeps-label, Requirement 5.9.
    expect(RULES[7]).toBe(
      'When the request has a label, the label is exactly that label; otherwise it is a short English name of 1 to 24 characters that is not in buttonNames.',
    );
  });
});

describe('Rule 1: the script parses', () => {
  it('reports the line, the column, the parser message and the line as written', () => {
    expect(reports(replyText({ script: mouseUp('summon cat') }))).toEqual([
      r(1, 'Line 2, column 10: expected "witch" after "summon". The line is "  summon cat".'),
    ]);
  });

  it('reports a handler that is never closed', () => {
    expect(reports(replyText({ script: 'on mouseUp\n  go to next card' }))).toEqual([
      r(1, 'Line 1, column 1: "on mouseUp" is never closed; add "end mouseUp". The line is "on mouseUp".'),
    ]);
  });

  it('reads \\r\\n as \\n and quotes a line that holds a double quote', () => {
    expect(reports(replyText({ script: 'on mouseUp\r\n  answer "hi\r\nend mouseUp' }))).toEqual([
      r(1, 'Line 2, column 10: this string has no closing quote (") on this line. The line is "  answer \\"hi".'),
    ]);
  });

  it('reports a command outside a handler', () => {
    expect(reports(replyText({ script: 'go to next card' }))).toEqual([
      r(1, 'Line 1, column 1: expected "on mouseUp" or "on openCard" here; commands must be inside a handler. The line is "go to next card".'),
    ]);
  });

  it('cuts a long line to 80 code units in the report', () => {
    const line = `  put "x" into field "${'n'.repeat(90)}`;
    expect(reports(replyText({ script: `on mouseUp\n${line}\nend mouseUp` }))).toEqual([
      r(1, `Line 2, column 22: this string has no closing quote (") on this line. The line is "  put \\"x\\" into field \\"${'n'.repeat(58)}…".`),
    ]);
  });
});

describe('Rule 2: exactly one mouseUp handler with a statement', () => {
  it('reports a script with no handler', () => {
    expect(reports(replyText({ script: '' }))).toEqual([r(2, 'The script has no handler.')]);
  });

  it('reports a second handler, and checks its name', () => {
    const script = `${mouseUp('go to next card')}\n\non openCard\n  release bat\nend openCard`;
    expect(reports(replyText({ script }))).toEqual([
      r(2, 'The script has 2 handlers.'),
      r(2, 'Line 5: the handler is openCard, not mouseUp.'),
    ]);
  });

  it('reports a handler that is not mouseUp', () => {
    expect(reports(replyText({ script: 'on openCard\n  go to next card\nend openCard' }))).toEqual([
      r(2, 'Line 1: the handler is openCard, not mouseUp.'),
    ]);
  });

  it('reports a mouseUp handler with no statements', () => {
    expect(reports(replyText({ script: '\non mouseUp\n\nend mouseUp' }))).toEqual([
      r(2, 'Line 2: the mouseUp handler has no statements.'),
    ]);
  });
});

describe('Rule 3: card names and card numbers', () => {
  it('reports a card name that is in neither list', () => {
    expect(reports(replyText({ script: mouseUp('go to card "Kichen"') }))).toEqual([
      r(3, 'Line 2: go to card "Kichen" names no card in cardNames or newCards.'),
    ]);
  });

  it('checks a literal in parentheses', () => {
    expectAccepted(replyText({ script: mouseUp('go to card ("Attic")') }));
    expect(reports(replyText({ script: mouseUp('go to card (("Atic"))') }))).toEqual([
      r(3, 'Line 2: go to card "Atic" names no card in cardNames or newCards.'),
    ]);
  });

  it('matches a card name in other case, in cardNames and in newCards', () => {
    expectAccepted(replyText({ script: mouseUp('go to card "ATTIC"') }));
    expectAccepted(replyText({ script: mouseUp('go to card "kitchen"'), newCards: ['Kitchen'] }));
  });

  it('takes "3" and 3 as card numbers in range', () => {
    expectAccepted(replyText({ script: mouseUp('go to card "3"') }));
    expectAccepted(replyText({ script: mouseUp('go to card 3') }));
    expectAccepted(replyText({ script: mouseUp('go to card " 4 "') }));
  });

  it('counts the new cards in the highest card number', () => {
    const script = (n: number) => mouseUp('if field "note" is "" then', '  go to card "Kitchen"', 'else', `  go to card ${n}`, 'end if');
    expectAccepted(replyText({ script: script(5), newCards: ['Kitchen'] }));
    expect(reports(replyText({ script: script(6), newCards: ['Kitchen'] }))).toEqual([
      r(3, 'Line 5: go to card 6 is not a whole card number from 1 to 5.'),
    ]);
  });

  it('rejects card numbers that are not whole numbers from 1 to the count', () => {
    expect(reports(replyText({ script: mouseUp('go to card 2.5') }))).toEqual([
      r(3, 'Line 2: go to card 2.5 is not a whole card number from 1 to 4.'),
    ]);
    expect(reports(replyText({ script: mouseUp('go to card "-1"') }))).toEqual([
      r(3, 'Line 2: go to card "-1" is not a whole card number from 1 to 4.'),
    ]);
    expect(reports(replyText({ script: mouseUp('go to card 0') }))).toEqual([
      r(3, 'Line 2: go to card 0 is not a whole card number from 1 to 4.'),
    ]);
  });

  it('does not check a target that is not a literal', () => {
    expectAccepted(replyText({ script: mouseUp('go to card it') }));
    expectAccepted(replyText({ script: mouseUp('go to card (1 + 9)') }));
  });

  it('rejects the empty card name, even when an unnamed card exists', () => {
    expect(reports(replyText({ script: mouseUp('go to card ""') }))).toEqual([
      r(3, 'Line 2: go to card "" names no card in cardNames or newCards.'),
    ]);
    const unnamed = { ...hallRequest, cardNames: [...hallRequest.cardNames, ''] };
    expect(reports(replyText({ script: mouseUp('go to card ""') }), unnamed)).toEqual([
      r(3, 'Line 2: go to card "" names no card in cardNames or newCards.'),
    ]);
  });

  it('takes true and false as card names', () => {
    expect(reports(replyText({ script: mouseUp('go to card true') }))).toEqual([
      r(3, 'Line 2: go to card true names no card in cardNames or newCards.'),
    ]);
  });
});

describe('Rule 4: new cards', () => {
  it('reports a new card that no go to card uses', () => {
    expect(reports(replyText({ newCards: ['Kitchen'] }))).toEqual([
      r(4, 'The new card "Kitchen" is not the name of any go to card in the script.'),
    ]);
  });

  it('reports a new card that is already a card in this stack', () => {
    expect(reports(replyText({ script: mouseUp('go to card "attic"'), newCards: ['attic'] }))).toEqual([
      r(4, 'The new card "attic" is already a card in this stack, "Attic".'),
    ]);
  });

  it('reports the second and later copies of a name in newCards', () => {
    const script = mouseUp('go to card "Kitchen"');
    expect(reports(replyText({ script, newCards: ['Kitchen', 'KITCHEN', 'kitchen'] }))).toEqual([
      r(4, 'The new card "KITCHEN" is in newCards more than once.'),
      r(4, 'The new card "kitchen" is in newCards more than once.'),
    ]);
  });

  it('reports a new card that is not a short English name', () => {
    const name = 'The Long Hall Of Mirrors Room';
    expect(reports(replyText({ script: mouseUp(`go to card "${name}"`), newCards: [name] }))).toEqual([
      r(4, `The new card "${name}" is 29 characters long, more than 24.`),
    ]);
  });

  it('reports a new card that looks like a number, which no go to card can name', () => {
    expect(reports(replyText({ script: mouseUp('go to card "3"'), newCards: ['3'] }))).toEqual([
      r(4, 'The new card "3" holds no letter and looks like a number and is not the name of any go to card in the script.'),
    ]);
  });

  it('joins two problems with "and"', () => {
    expect(reports(replyText({ newCards: ['attic'] }))).toEqual([
      r(4, 'The new card "attic" is already a card in this stack, "Attic" and is not the name of any go to card in the script.'),
    ]);
    expect(reports(replyText({ script: mouseUp('go to card "厨房"'), newCards: ['厨房'] }))).toEqual([
      r(4, 'The new card "厨房" holds a character that is not printable ASCII and holds no letter.'),
    ]);
  });

  it('does not count a card number as a use, nor a stack name', () => {
    expect(reports(replyText({ script: mouseUp('go to stack "Help"'), newCards: ['Help'] }))).toEqual([
      r(4, 'The new card "Help" is not the name of any go to card in the script.'),
    ]);
  });
});

describe('Rule 5: stack names', () => {
  it('reports a stack that is not in stackNames', () => {
    expect(reports(replyText({ script: mouseUp('go to stack "Graveyard"') }))).toEqual([
      r(5, 'Line 2: go to stack "Graveyard" names no stack in stackNames.'),
    ]);
  });

  it('shows a number and a constant as written', () => {
    expect(reports(replyText({ script: mouseUp('go to stack 3') }))).toEqual([
      r(5, 'Line 2: go to stack 3 names no stack in stackNames.'),
    ]);
    expect(reports(replyText({ script: mouseUp('go to stack (false)') }))).toEqual([
      r(5, 'Line 2: go to stack false names no stack in stackNames.'),
    ]);
  });

  it('matches a stack name in other case, and does not check a target that is not a literal', () => {
    expectAccepted(replyText({ script: mouseUp('go to stack "HAUNTED house"') }));
    expectAccepted(replyText({ script: mouseUp('go to stack field "note"') }));
  });
});

describe('Rule 6: fields and buttons', () => {
  it('reports a field that is not in fieldNames, in each place a field can be named', () => {
    const script = mouseUp(
      'hide field "candle"',
      'put field "notes" into field "Greeting"',
      'answer "Hi" & field "nite"',
      'if field "sign" contains "open" then show field "NOTE"',
    );
    expect(reports(replyText({ script }))).toEqual([
      r(6, 'Line 2: field "candle" is not in fieldNames.'),
      r(6, 'Line 3: field "notes" is not in fieldNames.'),
      r(6, 'Line 4: field "nite" is not in fieldNames.'),
      r(6, 'Line 5: field "sign" is not in fieldNames.'),
    ]);
  });

  it('reports a button that is neither in buttonNames nor the label', () => {
    expect(reports(replyText({ script: mouseUp('show button "Closet"') }))).toEqual([
      r(6, 'Line 2: button "Closet" is not in buttonNames and is not the label.'),
    ]);
  });

  it('accepts the label and other buttons in other case', () => {
    expectAccepted(replyText({ script: mouseUp('hide button "ONWARD"', 'show button "back"'), label: 'Onward' }));
  });
});

describe('Rule 7: the label', () => {
  const label = (text: string) => reports(replyText({ label: text }));

  it('reports each problem alone', () => {
    expect(label('')).toEqual([r(7, 'The label "" is empty.')]);
    expect(label('Go to the kitchen and let a bat out')).toEqual([
      r(7, 'The label "Go to the kitchen and let a bat out" is 35 characters long, more than 24.'),
    ]);
    expect(label('Küche')).toEqual([r(7, 'The label "Küche" holds a character that is not printable ASCII.')]);
    expect(label('123')).toEqual([r(7, 'The label "123" holds no letter.')]);
    expect(label('Say "boo"')).toEqual([r(7, 'The label "Say \\"boo\\"" holds a double quote.')]);
    expect(label('Onward ')).toEqual([r(7, 'The label "Onward " starts or ends with a space.')]);
    expect(label('upstairs')).toEqual([r(7, 'The label "upstairs" is already a button on this card, "Upstairs".')]);
  });

  it('joins two problems with "and"', () => {
    expect(label('去厨房')).toEqual([
      r(7, 'The label "去厨房" holds a character that is not printable ASCII and holds no letter.'),
    ]);
    const request = { ...hallRequest, buttonNames: [...hallRequest.buttonNames, 'Go now '] };
    expect(reports(replyText({ label: 'GO NOW ' }), request)).toEqual([
      r(7, 'The label "GO NOW " starts or ends with a space and is already a button on this card, "Go now ".'),
    ]);
  });

  it('accepts 24 characters', () => {
    expectAccepted(replyText({ label: 'x'.repeat(24) }));
  });
});

// recompile-keeps-label, Requirement 5: a recompiled button keeps the request's label.
describe('Rule 7 with a label in the request', () => {
  const kept = (label: string) => r(7, `The label ${JSON.stringify(label)} is not the label in the request, "Dig".`);

  it('accepts exactly the label of the request', () => {
    expectAccepted(replyText({ label: 'Dig' }), digRequest);
  });

  it('accepts a kept label that is not English, which Rule 7 rejects without a label', () => {
    expectAccepted(replyText({ label: '挖一挖' }), { ...digRequest, label: '挖一挖' });
    expect(reports(replyText({ label: '挖一挖' }), hallRequest)).toEqual([
      r(7, 'The label "挖一挖" holds a character that is not printable ASCII and holds no letter.'),
    ]);
  });

  it('reports a different label, the label in another case, and an empty label', () => {
    for (const label of ['Dig for seeds', 'dig', 'DIG', '']) {
      expect(reports(replyText({ label }), digRequest), label).toEqual([kept(label)]);
    }
  });

  it('accepts a script that names the kept label as a button (Rule 6)', () => {
    expectAccepted(replyText({ label: 'Dig', script: mouseUp('hide button "Dig"', 'show button "home"') }), digRequest);
  });

  it('checks a Nothing_Reply as without a label', () => {
    expectAccepted(nothingText(), digRequest);
    expect(reports(nothingText({ label: 'Dig' }), digRequest)).toEqual([r(10, 'hasButton is false, but label is not empty.')]);
  });

  it('still checks the label when the script does not parse', () => {
    expect(reports(replyText({ label: 'Dig up', script: mouseUp('summon cat') }), digRequest)).toEqual([
      r(1, 'Line 2, column 10: expected "witch" after "summon". The line is "  summon cat".'),
      kept('Dig up'),
    ]);
  });
});

describe('Rule 8: names after a go', () => {
  it('rejects a field after go to next card', () => {
    expect(reports(replyText({ script: mouseUp('go to next card', 'put "Hi" into field "greeting"') }))).toEqual([
      r(8, 'Line 3: field "greeting" comes after the go on line 2, so it would be looked up on another card.'),
    ]);
  });

  it('rejects a button after a go', () => {
    expect(reports(replyText({ script: mouseUp('go to prev card', 'hide button "Back"') }))).toEqual([
      r(8, 'Line 3: button "Back" comes after the go on line 2, so it would be looked up on another card.'),
    ]);
  });

  it('accepts a field in the else branch when the then branch holds the go', () => {
    const block = mouseUp('if field "greeting" is "" then', '  go to next card', 'else', '  hide field "note"', 'end if');
    expectAccepted(replyText({ script: block }));
    expectAccepted(replyText({ script: mouseUp('if field "note" is "" then go to next card else hide field "note"') }));
  });

  it('rejects a field after an if with a go in one branch', () => {
    const script = mouseUp('if field "greeting" is "" then', '  go to next card', 'end if', 'show field "note"');
    expect(reports(replyText({ script }))).toEqual([
      r(8, 'Line 5: field "note" comes after the go on line 3, so it would be looked up on another card.'),
    ]);
  });

  it('names the earliest go of either branch', () => {
    const script = mouseUp('if field "greeting" is "" then', '  wait 1 second', '  go to next card', 'else', '  go to prev card', 'end if', 'show field "note"');
    expect(reports(replyText({ script }))).toEqual([
      r(8, 'Line 8: field "note" comes after the go on line 4, so it would be looked up on another card.'),
    ]);
  });

  it('accepts a field in the target of a go, which is read before the move', () => {
    const withDest = { ...hallRequest, fieldNames: [...hallRequest.fieldNames, 'dest'] };
    expectAccepted(replyText({ script: mouseUp('go to card field "dest"') }), withDest);
    expect(reports(replyText({ script: mouseUp('go to next card', 'go to card field "dest"') }), withDest)).toEqual([
      r(8, 'Line 3: field "dest" comes after the go on line 2, so it would be looked up on another card.'),
    ]);
  });

  it('rejects a card name and a card number after go to stack', () => {
    expect(reports(replyText({ script: mouseUp('go to stack "Help"', 'go to card "Hall"', 'go to card 2') }))).toEqual([
      r(8, 'Line 3: go to card "Hall" comes after the go to stack on line 2, so it would be looked up in another stack.'),
      r(8, 'Line 4: go to card 2 comes after the go to stack on line 2, so it would be looked up in another stack.'),
    ]);
  });

  it('accepts go to next card after go to stack, and a card go before it', () => {
    expectAccepted(replyText({ script: mouseUp('go to stack "Help"', 'go to next card') }));
    expectAccepted(replyText({ script: mouseUp('go to card "Attic"', 'go to stack "Help"', 'howl') }));
  });
});

describe('Rule 9: skipped phrases', () => {
  const skipped = (phrases: string[]) => reports(replyText({ skipped: phrases }));

  it('reports more than 10 phrases', () => {
    const phrases = Array.from({ length: 11 }, (_, i) => `part ${i + 1}`);
    expect(skipped(phrases)).toEqual([r(9, 'skipped holds 11 phrases, more than 10.')]);
    expectAccepted(replyText({ skipped: phrases.slice(0, 10) }));
  });

  it('reports each phrase problem', () => {
    expect(skipped([''])).toEqual([r(9, 'The skipped phrase "" is empty.')]);
    expect(skipped(['p'.repeat(61)])).toEqual([r(9, `The skipped phrase "${'p'.repeat(61)}" is 61 characters long, more than 60.`)]);
    expect(skipped(['播放音乐'])).toEqual([r(9, 'The skipped phrase "播放音乐" holds a character that is not printable ASCII.')]);
    expect(skipped([' play a song'])).toEqual([r(9, 'The skipped phrase " play a song" starts or ends with a space.')]);
    expectAccepted(replyText({ skipped: ['p'.repeat(60), '1 + 1', 'play a "song"'] }));
  });

  it('joins phrase problems with "and", and reports every phrase in order', () => {
    expect(skipped(['play a song', ' 播放音乐', 'send a letter '])).toEqual([
      r(9, 'The skipped phrase " 播放音乐" holds a character that is not printable ASCII and starts or ends with a space.'),
      r(9, 'The skipped phrase "send a letter " starts or ends with a space.'),
    ]);
  });

  it('checks a Nothing_Reply too', () => {
    expect(reports(nothingText({ skipped: ['send an email', ''] }))).toEqual([r(9, 'The skipped phrase "" is empty.')]);
  });
});

describe('Rule 10: the reply shape', () => {
  const SHAPE = r(10, 'The reply is not one JSON object with the five fields hasButton, script, newCards, label and skipped.');

  it('reports text that is not one JSON object with the five fields', () => {
    expect(reports('on mouseUp\n  go to next card\nend mouseUp')).toEqual([SHAPE]);
    expect(reports(replyText().slice(0, -2))).toEqual([SHAPE]);
    expect(reports(`[${replyText()}]`)).toEqual([SHAPE]);
    expect(reports(JSON.stringify({ hasButton: true, script: mouseUp('howl'), label: 'Howl', skipped: [] }))).toEqual([SHAPE]);
    expect(reports(JSON.stringify({ ...JSON.parse(replyText()), reasoning: 'because' }))).toEqual([SHAPE]);
  });

  it('reports each Nothing_Reply problem', () => {
    expect(reports(nothingText({ script: mouseUp('howl') }))).toEqual([r(10, 'hasButton is false, but script is not empty.')]);
    expect(reports(nothingText({ label: 'Email' }))).toEqual([r(10, 'hasButton is false, but label is not empty.')]);
    expect(reports(nothingText({ newCards: ['Kitchen'] }))).toEqual([r(10, 'hasButton is false, but newCards is not empty.')]);
    expect(reports(nothingText({ skipped: [] }))).toEqual([r(10, 'hasButton is false, but skipped is empty.')]);
  });

  it('reports every Nothing_Reply problem, in order, and nothing else', () => {
    expect(reports(JSON.stringify({ hasButton: false, script: ' ', newCards: ['3'], label: '去', skipped: [] }))).toEqual([
      r(10, 'hasButton is false, but script is not empty.'),
      r(10, 'hasButton is false, but label is not empty.'),
      r(10, 'hasButton is false, but newCards is not empty.'),
      r(10, 'hasButton is false, but skipped is empty.'),
    ]);
    expect(reports(nothingText({ label: 'Email', skipped: [' send an email'] }))).toEqual([
      r(10, 'hasButton is false, but label is not empty.'),
    ]);
  });
});

describe('Requirement 4.11 rules together', () => {
  it('reports Rules 3 and 7 in rule order', () => {
    const text = replyText({ script: mouseUp('go to card "Kichen"', 'release bat'), label: 'Go to the kitchen and let a bat out' });
    expect(reports(text)).toEqual([
      r(3, 'Line 2: go to card "Kichen" names no card in cardNames or newCards.'),
      r(7, 'The label "Go to the kitchen and let a bat out" is 35 characters long, more than 24.'),
    ]);
  });

  it('reports a Rule 10 shape break alone', () => {
    const text = JSON.stringify({ hasButton: 'yes', script: mouseUp('summon cat'), newCards: ['3'], label: '', skipped: [''] });
    expect(reports(text)).toEqual([
      r(10, 'The reply is not one JSON object with the five fields hasButton, script, newCards, label and skipped.'),
    ]);
  });

  it('still reports Rules 4, 7 and 9 when Rule 1 is broken, without the parts of Rule 4 that need a parse', () => {
    const text = replyText({ script: mouseUp('summon cat'), newCards: ['3', 'Kitchen'], label: 'upstairs', skipped: [' x'] });
    expect(reports(text)).toEqual([
      r(1, 'Line 2, column 10: expected "witch" after "summon". The line is "  summon cat".'),
      r(4, 'The new card "3" holds no letter and looks like a number.'),
      r(7, 'The label "upstairs" is already a button on this card, "Upstairs".'),
      r(9, 'The skipped phrase " x" starts or ends with a space.'),
    ]);
  });

  it('checks both handlers of a script with two', () => {
    const script = `${mouseUp('go to card "Kichen"')}\non openCard\n  hide field "candle"\n  go to stack "Graveyard"\nend openCard`;
    expect(reports(replyText({ script, newCards: ['Cellar'] }))).toEqual([
      r(2, 'The script has 2 handlers.'),
      r(2, 'Line 4: the handler is openCard, not mouseUp.'),
      r(3, 'Line 2: go to card "Kichen" names no card in cardNames or newCards.'),
      r(4, 'The new card "Cellar" is not the name of any go to card in the script.'),
      r(5, 'Line 6: go to stack "Graveyard" names no stack in stackNames.'),
      r(6, 'Line 5: field "candle" is not in fieldNames.'),
    ]);
  });

  it('starts each handler with a fresh state for Rule 8', () => {
    // Carried over from the mouseUp handler, its go to stack would make both lines of openCard break Rule 8.
    const script = `${mouseUp('go to stack "Help"')}\non openCard\n  hide field "note"\n  go to card "Hall"\nend openCard`;
    expect(reports(replyText({ script }))).toEqual([
      r(2, 'The script has 2 handlers.'),
      r(2, 'Line 4: the handler is openCard, not mouseUp.'),
    ]);
  });
});

describe('accepted replies', () => {
  it('accepts a valid button and returns its values unchanged', () => {
    const script = 'on mouseUp\r\n  GO TO card "kitchen"   \r\n  release bat -- out it goes\r\nend mouseUp\r\n';
    const text = replyText({ script, newCards: ['Kitchen'], label: 'To  the kitchen', skipped: ['play a song'] });
    const parsed = JSON.parse(text);
    const result = checkReply(hallRequest, text);
    if (!result.ok || result.reply.kind !== 'button') throw new Error(`not accepted: ${JSON.stringify(result)}`);
    expect(result.reply.label).toBe(parsed.label);
    expect(result.reply.script).toBe(script);
    expect(result.reply.newCards).toHaveLength(1);
    expect(result.reply.newCards[0]).toBe('Kitchen');
    expect(result.reply.skipped).toHaveLength(1);
    expect(result.reply.skipped[0]).toBe('play a song');
    expect(result.reply).toStrictEqual({ kind: 'button', label: 'To  the kitchen', script, newCards: ['Kitchen'], skipped: ['play a song'] });
  });

  it('accepts a valid nothing reply and returns its skipped phrases unchanged', () => {
    const result = checkReply(hallRequest, nothingText({ skipped: ['send an email', 'call a friend'] }));
    if (!result.ok || result.reply.kind !== 'nothing') throw new Error(`not accepted: ${JSON.stringify(result)}`);
    expect(result.reply.skipped).toHaveLength(2);
    expect(result.reply.skipped[0]).toBe('send an email');
    expect(result.reply.skipped[1]).toBe('call a friend');
    expect(result.reply).toStrictEqual({ kind: 'nothing', skipped: ['send an email', 'call a friend'] });
  });

  it('accepts the design example reply for the hall', () => {
    expectAccepted(replyText({ script: mouseUp('go to card "Kitchen"', 'release bat'), newCards: ['Kitchen'], label: 'To the kitchen' }));
  });
});
