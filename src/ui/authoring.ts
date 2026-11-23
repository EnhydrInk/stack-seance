// Making things on a card: grow a button from one sentence (the compiler), add text, arrange
// what is there (drag, delete, edit text), recompile a button from its edited sentence, and
// make a new stack.

import { compileSentence, MAX_NAME, MAX_SENTENCE, requestFor, type CompileResponse } from './compile';
import type { Model } from './model';
import type { Runner } from './runner';
import { CARD_H, CARD_W, type Screen } from './screen';
import type { Rect } from './types';
import { spiritsWriting } from './writing';

const BUTTON_SIZE: [number, number] = [132, 24];
const TEXT_SIZE: [number, number] = [200, 40];

/** The flip corner at the bottom right of the card, in card pixels. */
const CORNER = 26;

/** Keeps a rect inside the card and off the flip corner. */
function inside([x, y, w, h]: Rect): Rect {
  let nx = Math.max(0, Math.min(x, CARD_W - w));
  const ny = Math.max(0, Math.min(y, CARD_H - h));
  if (nx + w > CARD_W - CORNER && ny + h > CARD_H - CORNER) nx = Math.max(0, CARD_W - CORNER - w);
  return [nx, ny, w, h];
}

/** A button rect wide enough for its label (about 8 px a character, plus the pumpkin), inside the card. */
function fitLabel([x, y, w, h]: Rect, label: string): Rect {
  return inside([x, y, Math.min(CARD_W, Math.max(w, label.length * 8 + 44)), h]);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** A script that names its button by the compiler's label, made to name it by the name it got. */
function renamed(script: string, from: string, to: string): string {
  const quoted = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return script.replace(new RegExp(`(button\\s+)"${quoted}"`, 'gi'), (_, pre: string) => `${pre}"${to}"`);
}

/** What the ghost says about parts of a sentence the spirits could not do. */
function couldNot(skipped: string[]): string {
  return skipped.length > 1 ? `${skipped.slice(0, -1).join(', ')} or ${skipped.at(-1)}` : (skipped[0] ?? 'that');
}

export class Authoring {
  arranging = false;
  /** Set by main: told whenever arranging turns on or off, so the title bar tool can follow. */
  onArranging: (on: boolean) => void = () => {};
  private cancelPlace: (() => void) | undefined;

  constructor(
    private readonly model: Model,
    private readonly screen: Screen,
    private readonly runner: Runner,
    /** Changes the card on screen and runs the new card's openCard. */
    private readonly navigate: (move: () => void) => Promise<void>,
  ) {
    let shown = model.card.id;
    model.onChange((change) => {
      // A spot or a sentence not yet sent belongs to the card it was made on: moving on drops it.
      if (change === 'place' && model.card.id !== shown) this.cancelPlace?.();
      shown = model.card.id;
      if (change !== 'text') this.drawHandles();
    });
    document.addEventListener('keydown', (e) => {
      // Escape while an input method is composing cancels the composition, nothing more.
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      if (this.cancelPlace) this.cancelPlace();
      else if (this.arranging && !(document.activeElement as HTMLElement | null)?.isContentEditable) this.setArranging(false);
    });
  }

  /** Drops a spot being chosen or a sentence not yet sent. */
  cancelPlacing(): void {
    this.cancelPlace?.();
  }

  private ready(): boolean {
    return !this.runner.running && !this.screen.flipped;
  }

  // ---- placing a new button or text

  place(kind: 'button' | 'text'): void {
    if (!this.ready()) return;
    this.cancelPlace?.();
    const overlay = el('div', 'place-overlay');
    overlay.tabIndex = 0;
    overlay.setAttribute('aria-label', kind === 'button' ? 'Place the new button' : 'Place the new text');
    overlay.appendChild(
      el(
        'span',
        'place-hint',
        kind === 'button' ? 'Click where the button should grow · Enter for the middle · Esc to cancel' : 'Click where the text goes · Enter for the middle · Esc to cancel',
      ),
    );
    const done = () => {
      overlay.remove();
      if (this.cancelPlace === done) this.cancelPlace = undefined;
    };
    const put = ([x, y]: [number, number]) => {
      done();
      if (kind === 'text') {
        const f = this.model.addField(inside([x, y, ...TEXT_SIZE]));
        this.editText(f.id);
      } else {
        this.askSentence(inside([x, y, ...BUTTON_SIZE]));
      }
    };
    overlay.addEventListener('click', (e) => put(this.screen.toCard(e)));
    // Without a pointer, Enter puts it in the middle of the card; Arrange can move it later.
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const [w, h] = kind === 'button' ? BUTTON_SIZE : TEXT_SIZE;
      put([Math.round((CARD_W - w) / 2), Math.round((CARD_H - h) / 2)]);
    });
    this.cancelPlace = done;
    this.screen.layer.appendChild(overlay);
    overlay.focus();
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
    // Running from a clone: the dev server answers with a stand-in that knows a few words.
    if (import.meta.env.DEV) row.appendChild(el('span', 'dev-note', 'dev stand-in compiler'));
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
      if (this.cancelPlace === close) this.cancelPlace = undefined;
    };
    this.cancelPlace = close;
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      // Enter while an input method is composing picks a word; it does not grow the button.
      if (e.isComposing || e.keyCode === 229) return;
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
      // The button grows where it was placed, even if the reader moves on while the spirits write.
      const cardId = this.model.card.id;
      const writing = spiritsWriting();
      box.replaceChildren(writing.el);
      box.classList.add('waiting');
      const reply = await compileSentence(requestFor(this.model, sentence));
      writing.stop();
      // Found again by id: another tab may have handed this one new stacks meanwhile.
      const home = this.model.cardById(cardId);
      if (reply.ok && home) {
        close();
        const grown = this.model.addCards(reply.newCards, home.stack);
        // Another grow on this card may have taken the label while the spirits wrote.
        const name = this.model.freeButtonName(reply.label, home.card);
        this.model.addButton(
          {
            name,
            rect: fitLabel(rect, name),
            visible: true,
            sentence,
            script: name === reply.label ? reply.script : renamed(reply.script, reply.label, name),
            ...(reply.skipped.length ? { skipped: reply.skipped } : {}),
            style: 'roundrect',
          },
          home.card,
        );
        // Grown while the reader looked at the back: the back shows it too.
        this.screen.refreshBack();
        this.tell(reply, grown);
        return;
      }
      if (!reply.ok && this.model.card.id === cardId && !this.cancelPlace) {
        // The sentence stays, so the reader can change it and try again.
        box.classList.remove('waiting');
        box.replaceChildren(input, row);
        this.cancelPlace = close;
        input.focus();
      } else {
        // The reader moved on, or is placing something else: the box does not follow them.
        close();
      }
      this.tell(reply);
    });
    input.focus();
  }

  /** The ghost's news after a compile: new cards (`grown`), skipped parts, nothing done, or a failure. */
  private tell(reply: CompileResponse, grown: string[] = []): void {
    if (reply.ok) {
      const grew = grown.length ? ` A new card grew: ${grown.join(', ')}.` : '';
      if (reply.skipped.length) this.screen.boo(`Boo… the spirits can't ${couldNot(reply.skipped)} yet. Everything else is done!${grew}`);
      else if (grew) this.screen.boo(grew.trim());
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
      case 'bad-request':
        this.screen.boo('Boo… this stack has grown too big for the spirits to read.');
        return;
      default:
        this.screen.boo('The séance failed. Try again.');
    }
  }

  // ---- recompiling a button from the back

  /** True when the button was written again; on a failure the back keeps the edited sentence. */
  async recompile(buttonId: string, sentence: string): Promise<boolean> {
    const reply = await compileSentence(requestFor(this.model, sentence, buttonId));
    // Found again by id: another tab may have handed this one new stacks meanwhile.
    const owner = this.model.owner(buttonId);
    if (!reply.ok || owner?.kind !== 'button') {
      this.tell(reply);
      return false;
    }
    const { stack, card, button } = owner;
    // The new script may name the button by its new label (the compiler's Rule 6).
    const name = this.model.freeButtonName(reply.label, card, buttonId);
    button.name = name;
    if (button.style === 'roundrect') button.rect = fitLabel(button.rect, name);
    button.sentence = sentence;
    button.script = name === reply.label ? reply.script : renamed(reply.script, reply.label, name);
    if (reply.skipped.length) button.skipped = reply.skipped;
    else delete button.skipped;
    const grown = this.model.addCards(reply.newCards, stack);
    this.model.changed('content');
    this.screen.refreshBack();
    this.tell(reply, grown);
    return true;
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
    // The text is saved as it is typed; leaving the field redraws the card.
    div.addEventListener('input', () => {
      field.text = div.innerText.replace(/\n$/, '');
      this.model.changed('text');
    });
    div.addEventListener(
      'blur',
      () => {
        // The box grows to fit what was written, as far as the bottom of the card.
        const need = Math.min(div.scrollHeight, CARD_H - field.rect[1]);
        if (need > field.rect[3]) field.rect[3] = need;
        this.model.changed('content');
      },
      { once: true },
    );
    div.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // Escape leaves the text only; arranging, if it is on, stays on.
      e.stopPropagation();
      div.blur();
    });
  }

  // ---- arranging

  setArranging(on: boolean): void {
    if (on && !this.ready()) return;
    this.arranging = on;
    this.screen.viewport.classList.toggle('arranging', on);
    this.drawHandles();
    this.onArranging(on);
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
    const answer = await this.screen.ask('Name your new stack:', MAX_NAME);
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
