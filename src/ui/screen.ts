// The HyperCard window: title bar, card area, flip corner, dialogs, haunts, card changes
// with their visual effect, and the error notice. Implements the host's Stage.

import type { Effect, HauntKind, ScriptError } from '../hypertalk/index';
import { BAT_DOWN, BAT_UP, GHOST, SPIDER, WITCH, WOLF, pixelSvg } from './art';
import { renderBack, type BackHandle } from './back';
import { renderFront } from './front';
import type { Stage } from './host';
import type { Model, ScriptOwner } from './model';
import type { ButtonDoc } from './types';

export const CARD_W = 512;
export const CARD_H = 342;

const EFFECT_MS = 520;

export class Screen implements Stage {
  readonly win: HTMLElement;
  private readonly title: HTMLElement;
  readonly viewport: HTMLElement;
  readonly front: HTMLElement;
  /** Title bar buttons for making things (filled by main). */
  readonly tools: HTMLElement;
  /** Above the card and below the dialogs: placing, arranging, the ghost's sign. */
  readonly layer: HTMLElement;
  private readonly back: HTMLElement;
  private readonly fx: HTMLElement;
  private readonly dialogs: HTMLElement;
  private readonly notice: HTMLElement;
  private pending: Promise<void> = Promise.resolve();
  private backHandle: BackHandle | undefined;
  /** Closes the answer or ask dialog on screen, when there is one. */
  private closeDialog: (() => void) | undefined;
  flipped = false;

  /** Set by main: what a click on a button does. */
  onClick: (b: ButtonDoc) => void = () => {};
  /** Set by main: whether a script is running (flips and clicks wait). */
  isBusy: () => boolean = () => false;
  /** Set by main: recompiles a button from its edited sentence; false when nothing changed. */
  onRecompile: (buttonId: string, sentence: string) => Promise<boolean> = async () => false;
  /** Set by main: told before the card shows its front or its back. */
  onFlip: (back: boolean) => void = () => {};

  constructor(private readonly model: Model) {
    this.win = el('div', 'window');
    const bar = el('div', 'titlebar');
    this.title = el('span', 'title');
    this.tools = el('span', 'tools');
    bar.append(el('span', 'stripes'), this.title, el('span', 'stripes'), this.tools);
    this.viewport = el('div', 'viewport');
    this.front = el('div', 'card front');
    this.back = el('div', 'card back');
    this.back.hidden = true;
    this.fx = el('div', 'fx');
    this.layer = el('div', 'layer');
    this.dialogs = el('div', 'dialogs');
    this.notice = el('div', 'notice');
    this.notice.hidden = true;
    const corner = el('button', 'corner');
    corner.setAttribute('aria-label', 'Flip the card');
    corner.title = 'Flip the card';
    corner.addEventListener('click', () => void this.flip());
    this.viewport.append(this.front, this.back, this.fx, this.layer, corner, this.notice, this.dialogs);
    this.win.append(bar, this.viewport);

    model.onChange((change) => {
      if (change === 'text') return;
      if (change === 'place' || !this.flipped) this.renderFront();
    });
  }

  /** A pointer position in card pixels, whatever the zoom. */
  toCard(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.viewport.getBoundingClientRect();
    const scale = r.width / CARD_W;
    return [Math.round((e.clientX - r.left) / scale), Math.round((e.clientY - r.top) / scale)];
  }

  /** Draws the back again after its scripts changed from outside (a recompile). */
  refreshBack(): void {
    if (this.flipped) this.showSide(true);
  }

  /**
   * A ghost holding a sign at the top of the card, for the compiler's news. It goes away on a
   * click or after a while.
   */
  boo(text: string): void {
    this.layer.querySelector('.boo')?.remove();
    const box = el('button', 'boo');
    box.appendChild(pixelSvg(GHOST, 2, 'bob'));
    const sign = el('span', 'sign');
    sign.textContent = text;
    box.appendChild(sign);
    box.addEventListener('click', () => box.remove());
    this.layer.appendChild(box);
    setTimeout(() => box.remove(), 7000);
  }

  renderFront(): void {
    this.title.textContent = this.model.stack.name;
    renderFront(this.model.card, this.front, (b) => this.onClick(b));
  }

  // ---- card changes

  changeCard(change: () => void, effect?: Effect): void {
    if (this.flipped) this.showSide(false);
    const old = this.front.cloneNode(true) as HTMLElement;
    old.classList.add('snapshot');
    change();
    if (!effect) return;
    const opts: KeyframeAnimationOptions = { duration: EFFECT_MS, easing: 'steps(10, end)' };
    let anim: Animation;
    if (effect === 'irisOpen') {
      this.viewport.insertBefore(old, this.front);
      anim = this.front.animate({ clipPath: ['circle(0% at 50% 50%)', 'circle(75% at 50% 50%)'] }, opts);
    } else {
      this.front.after(old);
      const frames: Record<Exclude<Effect, 'irisOpen'>, Keyframe[] | PropertyIndexedKeyframes> = {
        dissolve: { opacity: [1, 0] },
        wipeLeft: { clipPath: ['inset(0 0% 0 0)', 'inset(0 100% 0 0)'] },
        wipeRight: { clipPath: ['inset(0 0 0 0%)', 'inset(0 0 0 100%)'] },
        irisClose: { clipPath: ['circle(75% at 50% 50%)', 'circle(0% at 50% 50%)'] },
      };
      anim = old.animate(frames[effect], { ...opts, fill: 'forwards' });
    }
    this.pending = anim.finished.then(() => old.remove());
  }

  settled(): Promise<void> {
    return this.pending;
  }

  // ---- dialogs

  /** Closes the open answer or ask dialog, for a script the reader stopped. */
  dismiss(): void {
    this.closeDialog?.();
  }

  answer(message: string, labels: string[]): Promise<string> {
    return new Promise((resolve) => {
      const box = el('div', 'dialog');
      box.setAttribute('role', 'alertdialog');
      const msg = el('p', 'message');
      msg.textContent = message;
      const row = el('div', 'buttons');
      const done = (label: string) => {
        box.remove();
        this.closeDialog = undefined;
        resolve(label);
      };
      this.closeDialog = () => done('');
      labels.forEach((label, i) => {
        const b = el('button', i === labels.length - 1 ? 'dbtn default' : 'dbtn');
        b.textContent = label;
        b.addEventListener('click', () => done(label));
        row.appendChild(b);
      });
      box.append(msg, row);
      this.dialogs.appendChild(box);
      (row.lastElementChild as HTMLElement).focus();
    });
  }

  ask(message: string, maxLength?: number): Promise<string | null> {
    return new Promise((resolve) => {
      const box = el('form', 'dialog');
      box.setAttribute('role', 'dialog');
      const msg = el('p', 'message');
      msg.textContent = message;
      const input = el('input', 'answer-input') as HTMLInputElement;
      input.type = 'text';
      if (maxLength) input.maxLength = maxLength;
      input.setAttribute('aria-label', message);
      const row = el('div', 'buttons');
      const cancel = el('button', 'dbtn') as HTMLButtonElement;
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      const ok = el('button', 'dbtn default') as HTMLButtonElement;
      ok.type = 'submit';
      ok.textContent = 'OK';
      row.append(cancel, ok);
      box.append(msg, input, row);
      const done = (value: string | null) => {
        box.remove();
        this.closeDialog = undefined;
        resolve(value);
      };
      this.closeDialog = () => done(null);
      cancel.addEventListener('click', () => done(null));
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        done(input.value);
      });
      this.dialogs.appendChild(box);
      input.focus();
    });
  }

  /**
   * A HyperCard window over the card (settings, saves). Returns a function that closes it.
   * Escape and the close box close it too.
   */
  openPanel(title: string, body: HTMLElement): () => void {
    const panel = el('section', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    const bar = el('div', 'titlebar');
    const closeBox = el('button', 'close-box');
    closeBox.setAttribute('aria-label', `Close ${title}`);
    const name = el('span', 'title');
    name.textContent = title;
    bar.append(closeBox, el('span', 'stripes'), name, el('span', 'stripes'));
    const content = el('div', 'panel-body');
    content.appendChild(body);
    panel.append(bar, content);
    const close = () => {
      panel.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.dialogs.lastElementChild === panel) close();
    };
    closeBox.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    this.dialogs.appendChild(panel);
    closeBox.focus();
    return close;
  }

  // ---- haunts

  haunt(kind: HauntKind, from: ButtonDoc | undefined): Promise<void> {
    switch (kind) {
      case 'bat':
        return this.bat(from);
      case 'howl':
        return this.howl();
      case 'witch':
        return this.witch();
      case 'spider':
        return this.spider();
    }
  }

  private bat(from: ButtonDoc | undefined): Promise<void> {
    const onCard = from && this.model.card.buttons.includes(from) && from.visible;
    const [x, y, w, h] = onCard ? from.rect : [CARD_W / 2 - 15, CARD_H / 2, 30, 0];
    const sx = x + w / 2 - 15;
    const sy = y + h / 2 - 5;
    const sprite = el('div', 'sprite');
    const up = pixelSvg(BAT_UP, 2);
    const down = pixelSvg(BAT_DOWN, 2);
    down.style.visibility = 'hidden';
    sprite.append(up, down);
    this.fx.appendChild(sprite);
    const flap = setInterval(() => {
      const upShown = up.style.visibility !== 'hidden';
      up.style.visibility = upShown ? 'hidden' : '';
      down.style.visibility = upShown ? '' : 'hidden';
    }, 110);
    const anim = sprite.animate(
      [
        { transform: `translate(${sx}px, ${sy}px)` },
        { transform: `translate(${sx + 40}px, ${sy - 60}px)` },
        { transform: `translate(${sx - 20}px, ${sy - 120}px)` },
        { transform: `translate(${sx + 90}px, ${Math.min(sy - 180, -40)}px)` },
      ],
      { duration: 1400, easing: 'steps(14, end)' },
    );
    return anim.finished.then(() => {
      clearInterval(flap);
      sprite.remove();
    });
  }

  private howl(): Promise<void> {
    const sprite = el('div', 'sprite wolf');
    sprite.appendChild(pixelSvg(WOLF, 4));
    const bubble = el('div', 'bubble');
    bubble.textContent = 'Awoooooo!';
    sprite.appendChild(bubble);
    this.fx.appendChild(sprite);
    const anim = sprite.animate(
      [
        { transform: `translate(424px, ${CARD_H}px)` },
        { transform: `translate(424px, ${CARD_H - 80}px)`, offset: 0.2 },
        { transform: `translate(424px, ${CARD_H - 80}px)`, offset: 0.8 },
        { transform: `translate(424px, ${CARD_H}px)` },
      ],
      { duration: 2000, easing: 'steps(20, end)' },
    );
    return anim.finished.then(() => sprite.remove());
  }

  private witch(): Promise<void> {
    const sprite = el('div', 'sprite');
    sprite.appendChild(pixelSvg(WITCH, 3));
    this.fx.appendChild(sprite);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 10; i++) {
      const x = -80 + i * 62;
      const y = 50 + (i % 2 === 0 ? 0 : 10);
      frames.push({ transform: `translate(${x}px, ${y}px)` });
    }
    const anim = sprite.animate(frames, { duration: 2200, easing: 'steps(22, end)' });
    return anim.finished.then(() => sprite.remove());
  }

  private spider(): Promise<void> {
    const sprite = el('div', 'sprite spider');
    sprite.style.left = '300px';
    sprite.appendChild(pixelSvg(SPIDER, 2));
    this.fx.appendChild(sprite);
    const anim = sprite.animate(
      [{ height: '0px' }, { height: '150px', offset: 0.4 }, { height: '150px', offset: 0.6 }, { height: '0px' }],
      { duration: 2400, easing: 'steps(24, end)' },
    );
    return anim.finished.then(() => sprite.remove());
  }

  // ---- flip and the error notice

  async flip(toBack = !this.flipped): Promise<void> {
    if (this.isBusy() || toBack === this.flipped) return;
    const half = { duration: 140, easing: 'steps(4, end)' };
    await this.viewport.animate({ transform: ['scaleX(1)', 'scaleX(0)'] }, half).finished;
    this.showSide(toBack);
    await this.viewport.animate({ transform: ['scaleX(0)', 'scaleX(1)'] }, half).finished;
  }

  private showSide(back: boolean): void {
    this.onFlip(back);
    this.flipped = back;
    this.back.hidden = !back;
    this.front.hidden = back;
    this.win.classList.toggle('flipped', back);
    if (back) {
      this.backHandle = renderBack(
        this.model.card,
        this.model.stack.name,
        this.back,
        (id, source) => {
          const owner = this.model.owner(id);
          if (!owner) return;
          if (owner.kind === 'card') owner.card.script = source;
          else owner.button.script = source;
          this.model.changed('content');
        },
        (id, sentence) => this.onRecompile(id, sentence),
      );
      this.back.scrollTop = 0;
    } else {
      this.backHandle = undefined;
      this.renderFront();
    }
  }

  showError(error: ScriptError, owner: ScriptOwner): void {
    const who = owner.kind === 'card' ? `Card “${owner.card.name}”` : `Button “${owner.button.name}”`;
    this.notice.replaceChildren();
    const close = el('button', 'close-box');
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => this.hideError());
    const open = el('button', 'notice-open');
    const text = el('span', 'notice-text');
    text.textContent = `${who}, line ${error.line}: ${error.message}`;
    const hint = el('span', 'notice-hint');
    hint.textContent = 'Flip to see it';
    open.append(text, hint);
    this.notice.append(close, open);
    this.notice.hidden = false;
    open.addEventListener('click', async () => {
      this.notice.hidden = true;
      const id = owner.kind === 'card' ? owner.card.id : owner.button.id;
      if (this.model.card !== owner.card) this.model.goToOwner(owner);
      await this.flip(true);
      this.backHandle?.mark(id, error.line, error.message);
    });
  }

  hideError(): void {
    this.notice.hidden = true;
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
