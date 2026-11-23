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
const runner = new Runner(
  model,
  host,
  (error, owner) => screen.showError(error, owner),
  (busy) => document.body.classList.toggle('busy', busy),
);
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
tool('+ Button', 'Grow a button from one sentence', () => authoring.place('button'));
tool('+ Text', 'Add text to this card', () => authoring.place('text'));
const arrangeTool = tool('Arrange', 'Move, delete and edit what is on this card', () => toggleArrange());
function toggleArrange(): void {
  authoring.setArranging(!authoring.arranging);
  arrangeTool.classList.toggle('on', authoring.arranging);
}
// Arranging is for the front: turning the card over stops it, so no handle is left on the back.
screen.onFlip = (back) => {
  if (back && authoring.arranging) toggleArrange();
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
      { label: 'New Button…', run: () => authoring.place('button') },
      { label: 'New Text', run: () => authoring.place('text') },
      { label: () => (authoring.arranging ? 'Stop arranging' : 'Arrange'), run: () => toggleArrange() },
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

/** Whole-number zoom so pixels stay crisp; below 1 only when the screen is too small. */
function fit(): void {
  const w = CARD_W + 8;
  const h = CARD_H + 32;
  const dw = desk.clientWidth;
  const dh = desk.clientHeight;
  const avail = Math.min((dw - 16) / w, (dh - 16) / h);
  // The Tide Pool sits in the bottom-right corner. The card may shrink to make room for it,
  // but not below 2×; when there is still no room, the Tide Pool hides.
  tide.hidden = false;
  tide.style.zoom = '1';
  const t = tide.getBoundingClientRect();
  const roomFor = (z: number) => (dw - w * z) / 2 >= t.width + 20 || (dh - h * z) / 2 >= t.height + 20;
  let zoom = avail >= 1 ? Math.floor(avail) : Math.max(avail, 0.4);
  while (zoom > 2 && !roomFor(zoom)) zoom--;
  tide.hidden = !roomFor(zoom);
  screen.win.style.zoom = String(zoom);
}
window.addEventListener('resize', fit);
fit();

screen.renderFront();
void runner.openCard();

if (import.meta.env.DEV) Object.assign(window, { seance: { model, screen, runner, navigate } });
