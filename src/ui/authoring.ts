// Making things on a card: grow a button from one sentence (the compiler), add text, arrange
// what is there (drag, delete, edit text), recompile a button from its edited sentence, and
// make a new stack.

import { compileSentence, MAX_SENTENCE, requestFor, type CompileResponse } from './compile';
import type { Model } from './model';
import type { Runner } from './runner';
import { CARD_H, CARD_W, type Screen } from './screen';
import type { Rect } from './types';
import { spiritsWriting } from './writing';

const BUTTON_SIZE: [number, number] = [132, 24];
const TEXT_SIZE: [number, number] = [200, 40];

/** Keeps a rect inside the card. */
function inside([x, y, w, h]: Rect): Rect {
  return [Math.max(0, Math.min(x, CARD_W - w)), Math.max(0, Math.min(y, CARD_H - h)), w, h];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** What the ghost says about parts of a sentence the spirits could not do. */
function couldNot(skipped: string[]): string {
  return skipped.length > 1 ? `${skipped.slice(0, -1).join(', ')} or ${skipped.at(-1)}` : (skipped[0] ?? 'that');
}

export class Authoring {
  arranging = false;
  private cancelPlace: (() => void) | undefined;

  constructor(
    private readonly model: Model,
    private readonly screen: Screen,
    private readonly runner: Runner,
    /** Changes the card on screen and runs the new card's openCard. */
    private readonly navigate: (move: () => void) => Promise<void>,
  ) {
    model.onChange(() => this.drawHandles());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.cancelPlace) this.cancelPlace();
      else if (this.arranging && !(document.activeElement as HTMLElement | null)?.isContentEditable) this.setArranging(false);
    });
  }

  private ready(): boolean {
    return !this.runner.running && !this.screen.flipped;
  }

  // ---- placing a new button or text

  place(kind: 'button' | 'text'): void {
    if (!this.ready()) return;
    this.cancelPlace?.();
    const overlay = el('div', 'place-overlay');
    overlay.appendChild(
      el('span', 'place-hint', kind === 'button' ? 'Click where the button should grow · Esc to cancel' : 'Click where the text goes · Esc to cancel'),
    );
    const done = () => {
      overlay.remove();
      this.cancelPlace = undefined;
    };
    overlay.addEventListener('click', (e) => {
      done();
      const [x, y] = this.screen.toCard(e);
      if (kind === 'text') {
        const f = this.model.addField(inside([x, y, ...TEXT_SIZE]));
        this.editText(f.id);
      } else {
        this.askSentence(inside([x, y, ...BUTTON_SIZE]));
      }
    });
    this.cancelPlace = done;
    this.screen.layer.appendChild(overlay);
  }

  private askSentence(rect: Rect): void {
    const box = el('form', 'grow');
    // Below the spot, or above it near the bottom of the card.
    box.style.left = `${Math.min(rect[0], CARD_W - 300)}px`;
    box.style.top = rect[1] > CARD_H - 150 ? `${rect[1] - 128}px` : `${rect[1] + 28}px`;
    const input = el('textarea', 'grow-input');
    input.rows = 3;
    input.maxLength = MAX_SENTENCE;
    input.placeholder = 'Describe the button in one sentence, in any language.';
    input.setAttribute('aria-label', 'Describe the button in one sentence');
    const row = el('div', 'buttons');
    const cancel = el('button', 'dbtn', 'Cancel');
    cancel.type = 'button';
    const grow = el('button', 'dbtn default', 'Grow');
    grow.type = 'submit';
    row.append(cancel, grow);
    box.append(input, row);
    const marker = el('div', 'grow-marker');
    marker.style.left = `${rect[0]}px`;
    marker.style.top = `${rect[1]}px`;
    marker.style.width = `${rect[2]}px`;
    marker.style.height = `${rect[3]}px`;
    this.screen.layer.append(marker, box);
    const close = () => {
      box.remove();
      marker.remove();
      this.cancelPlace = undefined;
    };
    this.cancelPlace = close;
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        box.requestSubmit();
      }
    });
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sentence = input.value.trim();
      if (!sentence) return;
      this.cancelPlace = undefined;
      const writing = spiritsWriting();
      box.replaceChildren(writing.el);
      box.classList.add('waiting');
      const reply = await compileSentence(requestFor(this.model, sentence));
      writing.stop();
      close();
      if (reply.ok) {
        this.model.addCards(reply.newCards);
        this.model.addButton({ name: reply.label, rect, visible: true, sentence, script: reply.script, style: 'roundrect' });
      }
      this.tell(reply);
    });
    input.focus();
  }

  /** The ghost's news after a compile: skipped parts, nothing done, or a failure. */
  private tell(reply: CompileResponse): void {
    if (reply.ok) {
      if (reply.skipped.length) this.screen.boo(`Boo… the spirits can't ${couldNot(reply.skipped)} yet. Everything else is done!`);
      return;
    }
    switch (reply.error) {
      case 'nothing':
        this.screen.boo(`Boo… the spirits can't ${couldNot(reply.skipped)} yet, so no button grew this time.`);
        return;
      case 'limit':
        this.screen.boo("Today's magic is used up. Come back tomorrow.");
        return;
      case 'unauthorized':
        this.screen.boo("The spirits don't know you. Reload the page and sign in again.");
        return;
      default:
        this.screen.boo('The séance failed. Try again.');
    }
  }

  // ---- recompiling a button from the back

  async recompile(buttonId: string, sentence: string): Promise<void> {
    const button = this.model.card.buttons.find((b) => b.id === buttonId);
    if (!button) return;
    const reply = await compileSentence(requestFor(this.model, sentence, buttonId));
    if (reply.ok) {
      // The new script may name the button by its new label (the compiler's Rule 6).
      button.name = reply.label;
      button.sentence = sentence;
      button.script = reply.script;
      this.model.addCards(reply.newCards);
      this.model.changed('content');
    }
    this.screen.refreshBack();
    this.tell(reply);
  }

  // ---- text

  /** Lets the reader type into a field on the front; leaving it keeps the text. */
  editText(fieldId: string): void {
    const field = this.model.card.fields.find((f) => f.id === fieldId);
    const div = this.screen.front.querySelector<HTMLElement>(`.field[data-id="${fieldId}"]`);
    if (!field || !div) return;
    div.contentEditable = 'plaintext-only';
    div.classList.add('editing');
    div.focus();
    // The text is kept as it is typed; leaving the field redraws the card and autosaves.
    div.addEventListener('input', () => {
      field.text = div.innerText.replace(/\n$/, '');
    });
    div.addEventListener('blur', () => this.model.changed('content'), { once: true });
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') div.blur();
    });
  }

  // ---- arranging

  setArranging(on: boolean): void {
    if (on && !this.ready()) return;
    this.arranging = on;
    this.screen.viewport.classList.toggle('arranging', on);
    this.drawHandles();
  }

  /** One handle over each button and field: drag to move, × to delete, click text to edit it. */
  private drawHandles(): void {
    this.screen.layer.querySelectorAll('.handle').forEach((h) => h.remove());
    if (!this.arranging || this.screen.flipped) return;
    const items = [
      ...this.model.card.buttons.map((b) => ({ id: b.id, rect: b.rect, kind: 'button' as const, label: b.name })),
      ...this.model.card.fields.map((f) => ({ id: f.id, rect: f.rect, kind: 'field' as const, label: f.name })),
    ];
    for (const item of items) {
      const h = el('div', `handle handle-${item.kind}`);
      const move = (r: Rect) => {
        h.style.left = `${r[0]}px`;
        h.style.top = `${r[1]}px`;
        h.style.width = `${r[2]}px`;
        h.style.height = `${r[3]}px`;
      };
      move(item.rect);
      const del = el('button', 'handle-delete', '×');
      del.setAttribute('aria-label', `Delete ${item.label}`);
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', () => this.model.remove(item.id));
      h.appendChild(del);
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const [sx, sy] = this.screen.toCard(e);
        const start = [...item.rect] as Rect;
        const target = this.screen.front.querySelector<HTMLElement>(`[data-id="${item.id}"]`);
        let moved = false;
        h.setPointerCapture(e.pointerId);
        const onMove = (ev: PointerEvent) => {
          const [x, y] = this.screen.toCard(ev);
          if (Math.abs(x - sx) + Math.abs(y - sy) > 2) moved = true;
          const r = inside([start[0] + x - sx, start[1] + y - sy, start[2], start[3]]);
          item.rect.splice(0, 4, ...r);
          move(r);
          if (target) {
            target.style.left = `${r[0]}px`;
            target.style.top = `${r[1]}px`;
          }
        };
        const onUp = () => {
          h.removeEventListener('pointermove', onMove);
          if (moved) this.model.changed('content');
          else if (item.kind === 'field') {
            h.remove();
            this.editText(item.id);
          }
        };
        h.addEventListener('pointermove', onMove);
        h.addEventListener('pointerup', onUp, { once: true });
      });
      this.screen.layer.appendChild(h);
    }
  }

  // ---- a new stack

  async newStack(): Promise<void> {
    if (this.runner.running) return;
    const answer = await this.screen.ask('Name your new stack:');
    const name = answer?.trim();
    if (!name) return;
    if (name.includes('"')) {
      await this.screen.answer('A stack name cannot have a double quote in it.', ['OK']);
      return;
    }
    if (this.model.doc.stacks.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      await this.screen.answer(`There is already a stack called ${name}.`, ['OK']);
      return;
    }
    const stack = this.model.addStack(name);
    await this.navigate(() => this.model.goToStack(stack.id));
  }
}
