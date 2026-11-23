import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';

import type { Effect } from '../hypertalk/index';
import { BrowserHost } from './host';
import { renderMenubar } from './menubar';
import { Authoring } from './authoring';
import { Model, copy, upgrade } from './model';
import { Runner } from './runner';
import { CARD_H, CARD_W, Screen } from './screen';
import defaults from './stacks.json';
import { openSaves, openSettings } from './panels';
import { applyFontSettings } from './settings';
import { currentTheme, setTheme, startTheme } from './theme';
import { mountTidePool } from './tidepool';
import type { StacksDoc } from './types';

const AUTOSAVE = 'stack-seance:autosave';

startTheme();
applyFontSettings();

const saved = localStorage.getItem(AUTOSAVE);
const model = new Model(saved ? upgrade(JSON.parse(saved) as StacksDoc, defaults as StacksDoc) : copy(defaults as StacksDoc));
model.stackIndex = Math.max(0, model.doc.stacks.findIndex((s) => s.id === 'home'));

const screen = new Screen(model);
const host = new BrowserHost(model, screen);
// A script that runs for more than a few seconds shows how to stop it.
const runningHint = document.createElement('div');
runningHint.className = 'running-hint';
runningHint.textContent = 'A script is running · Esc to stop';
screen.viewport.appendChild(runningHint);
let slowRun: number | undefined;
const runner = new Runner(
  model,
  host,
  (error, owner) => screen.showError(error, owner),
  (busy) => {
    document.body.classList.toggle('busy', busy);
    window.clearTimeout(slowRun);
    document.body.classList.remove('busy-long');
    if (busy) slowRun = window.setTimeout(() => document.body.classList.add('busy-long'), 3000);
  },
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '.')) runner.stop();
});
screen.onClick = (b) => {
  if (runner.running || authoring.arranging) return;
  screen.hideError();
  if (b.builtin === 'new-stack') void authoring.newStack();
  else void runner.click(b);
};
screen.isBusy = () => runner.running;

model.onChange((change) => {
  if (change === 'content' || change === 'text') localStorage.setItem(AUTOSAVE, JSON.stringify(model.doc));
});
// Another tab saved: this tab takes its stacks, so its own next save does not undo them.
window.addEventListener('storage', (e) => {
  if (e.key !== AUTOSAVE || !e.newValue) return;
  model.adopt(upgrade(JSON.parse(e.newValue) as StacksDoc, defaults as StacksDoc));
  screen.refreshBack();
});

/** A move the reader asks for from the menu: change the card, then run its openCard. */
async function navigate(move: () => void, effect?: Effect): Promise<void> {
  if (runner.running) return;
  screen.hideError();
  if (screen.flipped) await screen.flip(false);
  screen.changeCard(move, effect);
  await runner.openCard();
}

/** After the stacks were replaced (revert, load a save): the front of Home, opened. */
async function afterReplace(): Promise<void> {
  screen.hideError();
  if (screen.flipped) await screen.flip(false);
  screen.renderFront();
  await runner.openCard();
}

const panelDeps = { screen, model, defaults: defaults as StacksDoc, afterReplace };
/** Windows open only between runs, so a revert or a load never lands in the middle of one. */
const whenIdle = (open: () => void) => () => {
  if (!runner.running) open();
};

const authoring = new Authoring(model, screen, runner, (move) => navigate(move, 'dissolve'));
screen.onRecompile = (id, sentence) => authoring.recompile(id, sentence);

/** The title bar's tools for making things. */
const tool = (label: string, title: string, run: () => void) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', run);
  screen.tools.appendChild(b);
  return b;
};
/** Making things happens on the front: from the back, the card turns over first. */
const onFront = (run: () => void) => async () => {
  if (screen.flipped) await screen.flip(false);
  run();
};
const placeButton = onFront(() => authoring.place('button'));
const placeText = onFront(() => authoring.place('text'));
const toggleArrange = onFront(() => authoring.setArranging(!authoring.arranging));
tool('+ Button', 'Grow a button from one sentence', () => void placeButton());
tool('+ Text', 'Add text to this card', () => void placeText());
const arrangeTool = tool('Arrange', 'Move, delete and edit what is on this card', () => void toggleArrange());
// The tool lights up whenever arranging is on, however it was turned on or off (Escape too).
authoring.onArranging = (on) => arrangeTool.classList.toggle('on', on);
// Arranging is for the front: turning the card over stops it, so no handle is left on the back.
screen.onFlip = (back) => {
  if (back && authoring.arranging) authoring.setArranging(false);
};

const cards = () => model.stack.cards.length;
const menubar = renderMenubar([
  {
    title: 'File',
    items: [
      { label: 'New Stack…', run: whenIdle(() => void authoring.newStack()) },
      { label: 'Saves…', run: whenIdle(() => openSaves(panelDeps)) },
      { label: 'Settings…', run: whenIdle(() => openSettings(panelDeps)) },
    ],
  },
  {
    title: 'Go',
    items: [
      { label: 'Home', run: () => void navigate(() => model.goToStack('home'), 'dissolve') },
      { label: 'Help', run: () => void navigate(() => model.goToStack('help'), 'dissolve') },
      { label: 'First card', run: () => void navigate(() => model.goToCard(0)) },
      { label: 'Previous card', run: () => void navigate(() => model.goToCard((model.cardIndex - 1 + cards()) % cards())) },
      { label: 'Next card', run: () => void navigate(() => model.goToCard((model.cardIndex + 1) % cards())) },
      { label: 'Last card', run: () => void navigate(() => model.goToCard(cards() - 1)) },
    ],
  },
  {
    title: 'Objects',
    items: [
      { label: 'New Button…', run: () => void placeButton() },
      { label: 'New Text', run: () => void placeText() },
      { label: () => (authoring.arranging ? 'Stop arranging' : 'Arrange'), run: () => void toggleArrange() },
    ],
  },
  {
    title: 'Stacks',
    items: () => model.doc.stacks.map((s) => ({ label: s.name, run: () => void navigate(() => model.goToStack(s.id), 'dissolve') })),
  },
  {
    title: 'View',
    items: [
      { label: () => (screen.flipped ? 'Flip to the front' : 'Flip to the back'), run: () => void screen.flip() },
      {
        label: () => (currentTheme() === 'day' ? 'Night' : 'Day'),
        run: () => setTheme(currentTheme() === 'day' ? 'night' : 'day'),
      },
    ],
  },
]);

const desk = document.createElement('main');
desk.className = 'desk';
desk.appendChild(screen.win);
const tide = mountTidePool();
document.getElementById('app')!.append(menubar, desk, tide);

/** The Tide Pool's size with its scene showing, measured once; its back is larger. */
let tideSize: { width: number; height: number } | undefined;

/**
 * The largest zoom that fits, in steps that land on whole device pixels (1× on a plain
 * screen, ½× on a Retina one) so the pixels stay crisp; below 1 only when the screen is too small.
 */
function fit(): void {
  const w = CARD_W + 8;
  const h = CARD_H + 32;
  const dw = desk.clientWidth;
  const dh = desk.clientHeight;
  const avail = Math.min((dw - 16) / w, (dh - 16) / h);
  const step = 1 / Math.max(1, Math.round(window.devicePixelRatio || 1));
  // The Tide Pool sits in the bottom-right corner. The card may shrink to make room for it,
  // but not below 2×; when there is still no room, the Tide Pool hides.
  if (!tideSize) {
    tide.hidden = false;
    tide.style.zoom = '1';
    const r = tide.getBoundingClientRect();
    tideSize = { width: r.width, height: r.height };
  }
  const t = tideSize;
  const roomFor = (z: number) => (dw - w * z) / 2 >= t.width + 20 || (dh - h * z) / 2 >= t.height + 20;
  let zoom = avail >= 1 ? Math.floor(avail / step) * step : Math.max(avail, 0.4);
  while (zoom > 2 && !roomFor(zoom)) zoom -= step;
  tide.hidden = !roomFor(zoom);
  screen.win.style.zoom = String(zoom);
}
window.addEventListener('resize', fit);
fit();

screen.renderFront();
void runner.openCard();

if (import.meta.env.DEV) Object.assign(window, { seance: { model, screen, runner, navigate } });
