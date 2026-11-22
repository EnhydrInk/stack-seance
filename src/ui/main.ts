import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';

import type { Effect } from '../hypertalk/index';
import { BrowserHost } from './host';
import { renderMenubar } from './menubar';
import { Model, copy } from './model';
import { Runner } from './runner';
import { CARD_H, CARD_W, Screen } from './screen';
import defaults from './stacks.json';
import { currentTheme, setTheme, startTheme } from './theme';
import type { StacksDoc } from './types';

const AUTOSAVE = 'stack-seance:autosave';

startTheme();

const saved = localStorage.getItem(AUTOSAVE);
const model = new Model(saved ? (JSON.parse(saved) as StacksDoc) : copy(defaults as StacksDoc));
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
  if (runner.running) return;
  screen.hideError();
  void runner.click(b);
};
screen.isBusy = () => runner.running;

model.onChange((change) => {
  if (change === 'content') localStorage.setItem(AUTOSAVE, JSON.stringify(model.doc));
});

/** A move the reader asks for from the menu: change the card, then run its openCard. */
async function navigate(move: () => void, effect?: Effect): Promise<void> {
  if (runner.running) return;
  screen.hideError();
  if (screen.flipped) await screen.flip(false);
  screen.changeCard(move, effect);
  await runner.openCard();
}

const cards = () => model.stack.cards.length;
const menubar = renderMenubar([
  {
    title: 'Go',
    items: [
      { label: 'Home', run: () => void navigate(() => model.goToStack('home'), 'dissolve') },
      { label: 'First card', run: () => void navigate(() => model.goToCard(0)) },
      { label: 'Previous card', run: () => void navigate(() => model.goToCard((model.cardIndex - 1 + cards()) % cards())) },
      { label: 'Next card', run: () => void navigate(() => model.goToCard((model.cardIndex + 1) % cards())) },
      { label: 'Last card', run: () => void navigate(() => model.goToCard(cards() - 1)) },
    ],
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
document.getElementById('app')!.append(menubar, desk);

/** Whole-number zoom so pixels stay crisp; below 1 only when the screen is too small. */
function fit(): void {
  const w = CARD_W + 8;
  const h = CARD_H + 32;
  const avail = Math.min((desk.clientWidth - 16) / w, (desk.clientHeight - 16) / h);
  const zoom = avail >= 1 ? Math.floor(avail) : Math.max(avail, 0.4);
  screen.win.style.zoom = String(zoom);
}
window.addEventListener('resize', fit);
fit();

screen.renderFront();
void runner.openCard();

if (import.meta.env.DEV) Object.assign(window, { seance: { model, screen, runner, navigate } });
