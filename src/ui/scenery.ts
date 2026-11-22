// The pixel art behind each card's fields and buttons. A card names its art in stacks.json.
// Pieces marked day or night only show in that theme.

import { GHOST, ICONS, MOON, STAR, SUN, pixelSvg, type Sprite } from './art';

interface Piece {
  sprite: Sprite;
  x: number;
  y: number;
  px?: number;
  only?: 'day' | 'night';
  className?: string;
}

const CANDLE: Sprite = ['.y.', 'yoy', '.k.', 'kwk', 'kwk', 'kwk', 'kwk', 'kkk'];

const WINDOW: Sprite = [
  'kkkkkkkkkkkk',
  'kwwwwkkwwwwk',
  'kwwwwkkwwwwk',
  'kwwwwkkwwwwk',
  'kkkkkkkkkkkk',
  'kwwwwkkwwwwk',
  'kwwwwkkwwwwk',
  'kwwwwkkwwwwk',
  'kkkkkkkkkkkk',
];

const WINDOW_LIT: Sprite = WINDOW.map((r) => r.replace(/w/g, 'y'));

const FENCE: Sprite = [
  '.k...k...k...k...k...k...k...k..',
  'kkk.kkk.kkk.kkk.kkk.kkk.kkk.kkk.',
  'kwk.kwk.kwk.kwk.kwk.kwk.kwk.kwk.',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'kwk.kwk.kwk.kwk.kwk.kwk.kwk.kwk.',
  'kwk.kwk.kwk.kwk.kwk.kwk.kwk.kwk.',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'kwk.kwk.kwk.kwk.kwk.kwk.kwk.kwk.',
  'kkk.kkk.kkk.kkk.kkk.kkk.kkk.kkk.',
];

const CLOUD: Sprite = ['...kkkk.....', '..kwwwwkkk..', '.kwwwwwwwwk.', 'kwwwwwwwwwwk', '.kkkkkkkkkk.'];

/** A ground band of dither, `h` card pixels high, across the bottom of the card. */
function ground(h: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ground';
  el.style.height = `${h}px`;
  return el;
}

const STARS: Piece[] = [
  [40, 24], [110, 60], [170, 18], [250, 44], [330, 20], [470, 70], [22, 110], [420, 120], [300, 96],
].map(([x, y]) => ({ sprite: STAR, x: x!, y: y!, px: 2, only: 'night' as const }));

const SKY: Piece[] = [
  ...STARS,
  { sprite: MOON, x: 440, y: 14, px: 3, only: 'night' },
  { sprite: SUN, x: 436, y: 10, px: 3, only: 'day' },
  { sprite: CLOUD, x: 350, y: 92, px: 3, only: 'day' },
  { sprite: CLOUD, x: 250, y: 104, px: 2, only: 'day' },
];

const ART: Record<string, { pieces: Piece[]; ground?: number }> = {
  home: {
    ground: 46,
    pieces: [
      ...SKY,
      { sprite: GHOST, x: 34, y: 228, px: 3, className: 'bob' },
      { sprite: ICONS.patch!, x: 420, y: 262, px: 3 },
      { sprite: ICONS.patch!, x: 466, y: 284, px: 2 },
    ],
  },
  gate: {
    ground: 40,
    pieces: [
      ...SKY,
      { sprite: ICONS.house!, x: 200, y: 120, px: 4 },
      { sprite: FENCE, x: 0, y: 270, px: 3 },
      { sprite: FENCE, x: 330, y: 270, px: 3 },
    ],
  },
  hall: {
    pieces: [
      { sprite: CANDLE, x: 380, y: 120, px: 4 },
      { sprite: CANDLE, x: 420, y: 112, px: 4 },
      { sprite: CANDLE, x: 460, y: 120, px: 4 },
      { sprite: GHOST, x: 420, y: 230, px: 2, className: 'bob', only: 'night' },
    ],
  },
  attic: {
    pieces: [
      { sprite: WINDOW, x: 400, y: 40, px: 4, only: 'day' },
      { sprite: WINDOW_LIT, x: 400, y: 40, px: 4, only: 'night' },
      { sprite: CANDLE, x: 200, y: 64, px: 3 },
    ],
  },
  garden: {
    ground: 60,
    pieces: [
      ...SKY,
      { sprite: ICONS.grave!, x: 40, y: 236, px: 3 },
      { sprite: ICONS.grave!, x: 110, y: 252, px: 2 },
      { sprite: ICONS.grave!, x: 200, y: 236, px: 3 },
      { sprite: ICONS.patch!, x: 280, y: 270, px: 2 },
    ],
  },
};

export function drawScenery(art: string | undefined, layer: HTMLElement): void {
  const scene = art ? ART[art] : undefined;
  if (!scene) return;
  if (scene.ground) layer.appendChild(ground(scene.ground));
  for (const p of scene.pieces) {
    const svg = pixelSvg(p.sprite, p.px ?? 2, ['piece', p.only ? `${p.only}-only` : '', p.className ?? ''].join(' ').trim());
    svg.style.left = `${p.x}px`;
    svg.style.top = `${p.y}px`;
    layer.appendChild(svg);
  }
}
