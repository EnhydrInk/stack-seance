// Requests and reply text for the compiler's example tests (design.md, "Helpers").
// The names are those of the built-in Haunted House stack, written out as literals. This file
// does not read src/ui/stacks.json: the UI regenerates that file, and a change to its content
// must not turn the compiler's tests red.
import type { CompileRequest } from '../../../src/compiler/contract';
import type { ReplyObject } from '../../../src/compiler/schema';

const HAUNTED_HOUSE_CARDS = ['Gate', 'Hall', 'Attic', 'Garden'];
const STACKS = ['Home', 'Haunted House', 'Help'];

/** The Hall card of the Haunted House: 4 cards, 2 fields, 5 buttons, 3 stacks. */
export const hallRequest: CompileRequest = {
  sentence: 'Clicking this goes to the kitchen and lets a bat out',
  stackName: 'Haunted House',
  cardNames: [...HAUNTED_HOUSE_CARDS],
  cardName: 'Hall',
  fieldNames: ['greeting', 'note'],
  buttonNames: ['Light a candle', 'Open the closet', 'Upstairs', 'Go deeper', 'Back'],
  stackNames: [...STACKS],
};

/** The Gate card of the Haunted House. */
export const gateRequest: CompileRequest = {
  sentence: 'If the sign says open, wipe to the next card; otherwise a werewolf howls',
  stackName: 'Haunted House',
  cardNames: [...HAUNTED_HOUSE_CARDS],
  cardName: 'Gate',
  fieldNames: ['sign'],
  buttonNames: ['Ring the bell', 'Enter', 'Home'],
  stackNames: [...STACKS],
};

/** The Attic card of the Haunted House. */
export const atticRequest: CompileRequest = {
  sentence: 'Clicking this plays a spooky song and drops a spider',
  stackName: 'Haunted House',
  cardNames: [...HAUNTED_HOUSE_CARDS],
  cardName: 'Attic',
  fieldNames: ['label', 'count'],
  buttonNames: ['Count a candle', 'Look up', 'Down', 'To the garden'],
  stackNames: [...STACKS],
};

/**
 * Recompiling Dig on the Garden card of the Haunted House, whose card script hides button "Dig"
 * and whose Look at the moon button shows it: a Labelled_Request (recompile-keeps-label).
 * buttonNames are the card's other buttons.
 */
export const digRequest: CompileRequest = {
  sentence: 'A Dig button: say "You found a pumpkin seed!" with Keep it or Plant it, then write "You picked: " and the choice in msg.',
  stackName: 'Haunted House',
  cardNames: [...HAUNTED_HOUSE_CARDS],
  cardName: 'Garden',
  fieldNames: ['msg'],
  buttonNames: ['Look at the moon', 'Previous card', 'Start over', 'Home'],
  stackNames: [...STACKS],
  label: 'Dig',
};

/** A `mouseUp` handler in the house style: two-space indentation, `\n` line breaks. */
export function mouseUp(...body: string[]): string {
  return ['on mouseUp', ...body.map((line) => `  ${line}`), 'end mouseUp'].join('\n');
}

/** The defaults of `replyText`: a Button_Reply that follows every rule for `hallRequest`. */
export const VALID_BUTTON: ReplyObject = {
  hasButton: true,
  script: mouseUp('go to next card'),
  newCards: [],
  label: 'Onward',
  skipped: [],
};

/** A ReplyObject written as JSON, with the fields of `VALID_BUTTON` as defaults. */
export function replyText(fields: Partial<ReplyObject> = {}): string {
  return JSON.stringify({ ...VALID_BUTTON, ...fields });
}

/** A Nothing_Reply written as JSON. */
export function nothingText(fields: Partial<ReplyObject> = {}): string {
  return JSON.stringify({ hasButton: false, script: '', newCards: [], label: '', skipped: ['send an email'], ...fields });
}
