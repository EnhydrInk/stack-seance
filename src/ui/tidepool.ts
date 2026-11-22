// Tide Pool: a tiny stack in the corner of the page. A witch otter and a zombie octopus wait
// there. Clicking them runs a real HyperTalk script that flips through the stack's cards like
// a flip book; then the little card turns over and shows that script on its back.

import { runHandler, type CardRef, type Effect, type Host } from '../hypertalk/index';
import { pixelSvg, type Sprite } from './art';
import { heart as HEART, sparks as SPARKS, TIDE_COLORS, octopus, octopusFloat, otterCast, otterFloat, otterWitch, zombie } from './tidepool-art';

const PX = 2;
const W = 68;
const H = 34;

interface Piece {
  sprite: Sprite;
  x: number;
  y: number;
}

interface TideCard {
  name: string;
  pieces: Piece[];
  water?: boolean;
}

const WITCH = (x = 1): Piece => ({ sprite: otterWitch, x, y: 6 });

const CARDS: TideCard[] = [
  { name: 'Costumes', pieces: [WITCH(), { sprite: zombie, x: 38, y: 3 }] },
  { name: 'Shamble 1', pieces: [WITCH(), { sprite: zombie, x: 33, y: 4 }] },
  { name: 'Shamble 2', pieces: [WITCH(), { sprite: zombie, x: 28, y: 3 }] },
  { name: 'Shamble 3', pieces: [WITCH(), { sprite: zombie, x: 24, y: 4 }] },
  {
    name: 'Spell',
    pieces: [{ sprite: otterCast, x: 1, y: 6 }, { sprite: zombie, x: 24, y: 4 }, { sprite: SPARKS, x: 30, y: 2 }],
  },
  { name: 'Octopus', pieces: [WITCH(), { sprite: octopus, x: 24, y: 4 }] },
  {
    name: 'Floating',
    water: true,
    pieces: [{ sprite: otterFloat, x: 4, y: 15 }, { sprite: octopusFloat, x: 35, y: 15 }],
  },
];

const SENTENCE = 'When someone clicks, the zombie goes to the witch, she lifts the spell, and they float away together.';

export const SCRIPT = `on mouseUp
  -- a zombie shuffles toward the witch
  go to card "Shamble 1"
  wait 0.3 seconds
  go to next card
  wait 0.3 seconds
  go to next card
  wait 0.4 seconds
  -- she lifts the spell
  go to card "Spell"
  wait 0.7 seconds
  visual effect dissolve
  go to card "Octopus"
  wait 0.9 seconds
  -- off come the costumes, and they float together
  visual effect iris open
  go to card "Floating"
  show field "heart"
end mouseUp`;

class TideHost implements Host {
  index = 0;
  heart = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly draw: (effect: Effect | undefined) => Promise<void>) {}

  cardCount(): number {
    return CARDS.length;
  }
  currentCard(): CardRef {
    return this.ref(this.index);
  }
  findCardByName(name: string): CardRef | undefined {
    const i = CARDS.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    return i < 0 ? undefined : this.ref(i);
  }
  cardAt(index: number): CardRef | undefined {
    return index >= 1 && index <= CARDS.length ? this.ref(index - 1) : undefined;
  }
  goToCard(card: CardRef, effect?: Effect): void {
    this.index = card.index - 1;
    this.pending = this.draw(effect);
  }
  findStackByName(): undefined {
    return undefined;
  }
  getField(name: string): string | undefined {
    return name.toLowerCase() === 'heart' ? '♥' : undefined;
  }
  setField(): boolean {
    return false;
  }
  setVisible(kind: 'button' | 'field', name: string, visible: boolean): boolean {
    if (kind !== 'field' || name.toLowerCase() !== 'heart') return false;
    this.heart = visible;
    void this.draw(undefined);
    return true;
  }
  async answer(): Promise<string> {
    return 'OK';
  }
  async ask(): Promise<string | null> {
    return null;
  }
  async wait(seconds: number): Promise<void> {
    await this.pending;
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
  async haunt(): Promise<void> {}
  getCardScript(): string {
    return '';
  }

  private ref(i: number): CardRef {
    return { index: i + 1, id: `tide-${i}`, name: CARDS[i]!.name };
  }
}

function colourStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = Object.entries(TIDE_COLORS)
    .map(([c, hex]) => `.tide .c-${c} { fill: ${hex}; }`)
    .join('\n');
  return style;
}

export function mountTidePool(): HTMLElement {
  document.head.appendChild(colourStyles());
  const win = document.createElement('aside');
  win.className = 'tide';
  win.setAttribute('aria-label', 'Tide Pool');
  const bar = document.createElement('div');
  bar.className = 'titlebar';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'Tide Pool';
  bar.append(document.createElement('span'), title, document.createElement('span'));
  bar.firstElementChild!.className = 'stripes';
  bar.lastElementChild!.className = 'stripes';

  const stage = document.createElement('button');
  stage.type = 'button';
  stage.className = 'tide-stage';
  stage.setAttribute('aria-label', 'Trick or treat');
  stage.style.width = `${W * PX}px`;
  stage.style.height = `${H * PX}px`;
  const scene = document.createElement('div');
  scene.className = 'tide-scene';
  stage.appendChild(scene);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'tide-back';
  back.hidden = true;
  const head = document.createElement('div');
  head.className = 'who';
  head.textContent = 'Button “Trick or treat”';
  const sentence = document.createElement('p');
  sentence.className = 'sentence';
  sentence.textContent = `“${SENTENCE}”`;
  const code = document.createElement('pre');
  code.className = 'tide-code';
  code.textContent = SCRIPT;
  const hint = document.createElement('p');
  hint.className = 'tide-hint';
  hint.textContent = 'Click to flip back.';
  back.append(head, sentence, code, hint);

  win.append(bar, stage, back);

  const render = (card: TideCard, heart: boolean): HTMLElement => {
    const frame = document.createElement('div');
    frame.className = 'tide-frame';
    for (const p of card.pieces) {
      const svg = pixelSvg(p.sprite, PX);
      svg.style.left = `${p.x * PX}px`;
      svg.style.top = `${p.y * PX}px`;
      frame.appendChild(svg);
    }
    if (card.water) {
      const water = document.createElement('div');
      water.className = 'tide-water';
      frame.appendChild(water);
    }
    if (heart) {
      const svg = pixelSvg(HEART, PX, 'tide-heart');
      svg.style.left = `${31 * PX}px`;
      svg.style.top = `${2 * PX}px`;
      frame.appendChild(svg);
    }
    return frame;
  };

  const host: TideHost = new TideHost(async (effect) => {
    const next = render(CARDS[host.index]!, host.heart);
    const old = scene.firstElementChild as HTMLElement | null;
    scene.appendChild(next);
    if (!old) return;
    if (!effect) {
      old.remove();
      return;
    }
    const opts = { duration: 420, easing: 'steps(7, end)' };
    const anim =
      effect === 'irisOpen'
        ? next.animate({ clipPath: ['circle(0% at 50% 50%)', 'circle(75% at 50% 50%)'] }, opts)
        : next.animate({ opacity: [0, 1] }, opts);
    await anim.finished;
    old.remove();
  });

  const showCostumes = () => {
    host.index = 0;
    host.heart = false;
    scene.replaceChildren(render(CARDS[0]!, false));
  };
  showCostumes();

  const flip = async (toBack: boolean) => {
    const half = { duration: 140, easing: 'steps(4, end)' };
    await win.animate({ transform: ['scaleX(1)', 'scaleX(0)'] }, half).finished;
    stage.hidden = toBack;
    back.hidden = !toBack;
    win.classList.toggle('flipped', toBack);
    if (!toBack) showCostumes();
    await win.animate({ transform: ['scaleX(0)', 'scaleX(1)'] }, half).finished;
  };

  let busy = false;
  stage.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    await runHandler(SCRIPT, 'mouseUp', { host, globals: new Map(), scriptId: 'tide' });
    await new Promise((r) => setTimeout(r, 1800));
    await flip(true);
    busy = false;
  });
  back.addEventListener('click', () => void flip(false));
  return win;
}
