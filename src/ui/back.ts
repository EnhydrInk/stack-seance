// The back of a card: the card script and every button's script, each under its button's
// name and the sentence it came from. The text is the stored source, exactly as written.
// Every edit is parsed; a syntax error marks its line. The text is stored either way, so the
// back always shows what runs.

import { parse } from '../hypertalk/index';
import { MAX_SENTENCE, editedByHand } from './compile';
import type { CardDoc } from './types';
import { spiritsWriting } from './writing';

export interface BackHandle {
  /** Marks a line of a script (from an error notice) and scrolls it into view. */
  mark(scriptId: string, line: number, message: string): void;
}

interface Block {
  section: HTMLElement;
  textarea: HTMLTextAreaElement;
  gutter: HTMLElement;
  hl: HTMLElement;
  problem: HTMLElement;
}

export function renderBack(
  card: CardDoc,
  stackName: string,
  el: HTMLElement,
  onEdit: (scriptId: string, source: string) => void,
  /** True when the button was written again (the back is then drawn anew). */
  onRecompile: (buttonId: string, sentence: string) => Promise<boolean>,
  /** A dialog with these buttons; resolves to the one clicked, or '' when it was closed. */
  answer: (message: string, labels: string[]) => Promise<string>,
): BackHandle {
  el.replaceChildren();
  const blocks = new Map<string, Block>();

  const head = document.createElement('header');
  head.className = 'back-head';
  head.textContent = `Back of card “${card.name}” · ${stackName}`;
  el.appendChild(head);

  /** A button's sentence: edit it and recompile, and the button's script is written again. */
  const sentenceBox = (buttonId: string, sentence: string, compiled: string | undefined): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'sentence-edit';
    const input = document.createElement('textarea');
    input.className = 'sentence';
    input.rows = 2;
    input.maxLength = MAX_SENTENCE;
    input.value = sentence;
    input.setAttribute('aria-label', 'The sentence this script came from');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'dbtn small';
    go.textContent = 'Recompile';
    go.disabled = true;
    input.addEventListener('input', () => {
      go.disabled = input.value.trim() === '' || input.value === sentence;
    });
    go.addEventListener('click', async () => {
      const script = blocks.get(buttonId)?.textarea;
      if (script && editedByHand({ script: script.value, compiled })) {
        // One question at a time: the keyboard can still reach this button behind the dialog.
        go.disabled = true;
        const choice = await answer('This script was changed by hand. Replace it with what the spirits write from the sentence?', ['Replace', 'Cancel']);
        go.disabled = false;
        if (choice !== 'Replace') return;
      }
      const writing = spiritsWriting();
      go.replaceWith(writing.el);
      input.readOnly = true;
      // The script below is about to be written again: an edit made now would be lost.
      if (script) script.readOnly = true;
      const ok = await onRecompile(buttonId, input.value.trim());
      writing.stop();
      if (!ok) {
        // The edited sentence stays, and Recompile can be pressed again.
        writing.el.replaceWith(go);
        input.readOnly = false;
        if (script) script.readOnly = false;
        input.focus();
      }
    });
    box.append(input, go);
    return box;
  };

  const add = (id: string, who: string, sentence: string | undefined, source: string, hidden: boolean, skipped: string[] = [], compiled?: string) => {
    const section = document.createElement('section');
    section.className = 'script';
    const title = document.createElement('div');
    title.className = 'who';
    title.textContent = who + (hidden ? ' (hidden)' : '');
    section.appendChild(title);
    if (sentence !== undefined) section.appendChild(sentenceBox(id, sentence, compiled));
    if (skipped.length) {
      // What the ghost's sign said when this script was written: the parts the script leaves out.
      const left = document.createElement('p');
      left.className = 'skipped';
      left.textContent = `The spirits left out: ${skipped.join(' · ')}`;
      section.appendChild(left);
    }
    // Once the script is changed by hand, the sentence above is no longer all of where it came from.
    const byHand = document.createElement('p');
    byHand.className = 'by-hand';
    byHand.textContent = 'Changed by hand since the spirits wrote it.';
    section.appendChild(byHand);
    const editor = document.createElement('div');
    editor.className = 'editor';
    const gutter = document.createElement('pre');
    gutter.className = 'gutter';
    const code = document.createElement('div');
    code.className = 'code';
    const hl = document.createElement('div');
    hl.className = 'hl';
    hl.hidden = true;
    const textarea = document.createElement('textarea');
    textarea.spellcheck = false;
    textarea.wrap = 'off';
    textarea.autocapitalize = 'off';
    textarea.setAttribute('autocorrect', 'off');
    textarea.value = source;
    textarea.setAttribute('aria-label', `Script of ${who}`);
    code.append(hl, textarea);
    editor.append(gutter, code);
    section.appendChild(editor);
    const problem = document.createElement('p');
    problem.className = 'problem';
    problem.hidden = true;
    section.appendChild(problem);
    el.appendChild(section);

    const block: Block = { section, textarea, gutter, hl, problem };
    blocks.set(id, block);
    const refresh = () => {
      const lines = textarea.value.split('\n').length;
      textarea.rows = Math.max(lines, 2);
      gutter.textContent = Array.from({ length: Math.max(lines, 2) }, (_, i) => String(i + 1)).join('\n');
      const parsed = parse(textarea.value);
      if (parsed.ok) show(block, undefined);
      else show(block, { line: parsed.error.line, message: parsed.error.message, kind: 'syntax' });
      byHand.hidden = !editedByHand({ script: textarea.value, compiled });
    };
    textarea.addEventListener('input', () => {
      refresh();
      onEdit(id, textarea.value);
    });
    // A new line starts where the one above it did; Tab indents by two spaces.
    textarea.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') {
        const start = textarea.value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
        const indent = /^[ \t]*/.exec(textarea.value.slice(start))![0];
        e.preventDefault();
        document.execCommand('insertText', false, `\n${indent}`);
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });
    refresh();
  };

  add(card.id, 'Card script', undefined, card.script, false);
  for (const b of card.buttons) {
    if (b.builtin) {
      const section = document.createElement('section');
      section.className = 'script';
      const title = document.createElement('div');
      title.className = 'who';
      title.textContent = `Button “${b.name}”`;
      const note = document.createElement('p');
      note.className = 'sentence';
      note.textContent = 'Built in, with no script: it asks for a name and makes a new stack.';
      section.append(title, note);
      el.appendChild(section);
      continue;
    }
    add(b.id, `Button “${b.name}”`, b.sentence, b.script, !b.visible, b.skipped, b.compiled);
  }

  if (card.fields.length) {
    // The names a script uses for the text on this card, next to what each one says now.
    const section = document.createElement('section');
    section.className = 'script';
    const title = document.createElement('div');
    title.className = 'who';
    title.textContent = 'Fields on this card';
    const list = document.createElement('dl');
    list.className = 'fields';
    for (const f of card.fields) {
      const name = document.createElement('dt');
      name.textContent = `field "${f.name}"`;
      const text = document.createElement('dd');
      const line = f.text.split('\n')[0] ?? '';
      text.textContent = (line.length > 48 ? `${line.slice(0, 47)}…` : line || '(empty)') + (f.visible ? '' : ' (hidden)');
      list.append(name, text);
    }
    section.append(title, list);
    el.appendChild(section);
  }

  return {
    mark(scriptId, line, message) {
      const block = blocks.get(scriptId);
      if (!block) return;
      show(block, { line, message, kind: 'runtime' });
      block.section.scrollIntoView({ block: 'center' });
    },
  };
}

function show(block: Block, problem: { line: number; message: string; kind: 'syntax' | 'runtime' } | undefined): void {
  if (!problem) {
    block.hl.hidden = true;
    block.problem.hidden = true;
    return;
  }
  block.hl.hidden = false;
  block.hl.style.top = `calc(${problem.line - 1} * var(--code-lh))`;
  block.problem.hidden = false;
  block.problem.textContent = `Line ${problem.line}: ${problem.message}`;
  block.problem.dataset.kind = problem.kind;
}
