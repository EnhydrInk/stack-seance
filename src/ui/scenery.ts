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

const GATE: Sprite = [
  '..oo..................oo..',
  '.oooo................oooo.',
  '.oyyo...k...k...k....oyyo.',
  '..kk....k.k.k.k.k.k...kk..',
  '.kwwk..kkkkkkkkkkkkk.kwwk.',
  '.kwwk.k.k.k.k.k.k.k.kkwwk.',
  '.kwwkkkkkkkkkkkkkkkkkkwwk.',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwkkkkkkkkkkkkkkkkkkkwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  '.kwwk.k.k.k.k.k.k.k.k.kwwk',
  'kkwwkk...............kkwwk',
  'kkkkkk..............kkkkkk',
];

const HILL: Sprite = [
  '......................................kkkkkkkkkkkkkkkkkkkk',
  '...............................kkkkkkkgggggggggwwwggggggggkkkkkkk',
  '.............................kkgggggggggggggggggwwwggggggggggggggkk',
  '...........................kkggggggggggggggggggggwwwgggggggggggggggkk',
  '.........................kkggggggggggggggggggggggwwwgggggggggggggggggkk',
  '.......................kkggggggggggggggggggggggggwwwwggggggggggggggggggkk',
  '......................kgggggggggggggggggggggggggggwwwggggggggggggggggggggk',
  '....................kkggggggggggggggggggggggggggggwwwgggggggggggggggggggggkk',
  '...................kggggggggggggggggggggggggggggggwwwgggggggggggggggggggggggk',
  '..................kggggggggggggggggggggggggggggggwwwwggggggggggggggggggggggggk',
  '.................kgggggggggggggggggggggggggggggggwwwwgggggggggggggggggggggggggk',
  '................kgggggggggggggggggggggggggggggggwwwwgggggggggggggggggggggggggggk',
  '...............kgggggggggggggggggggggggggggggggwwwwwggggggggggggggggggggggggggggk',
  '..............kggggggggggggggggggggggggggggggggwwwwggggggggggggggggggggggggggggggk',
  '.............kggggggggggggggggggggggggggggggggwwwwwgggggggggggggggggggggggggggggggk',
  '............kggggggggggggggggggggggggggggggggwwwwwgggggggggggggggggggggggggggggggggk',
  '............kgggggggggggggggggggggggggggggggwwwwwggggggggggggggggggggggggggggggggggk',
  '...........kgggggggggggggggggggggggggggggggwwwwwwgggggggggggggggggggggggggggggggggggk',
  '..........kggggggggggggggggggggggggggggggggwwwwwgggggggggggggggggggggggggggggggggggggk',
  '.........kggggggggggggggggggggggggggggggggwwwwwwggggggggggggggggggggggggggggggggggggggk',
  '........kgggggggggggggggggggggggggggggggggwwwwwwgggggggggggggggggggggggggggggggggggggggk',
  '........kggggggggggggggggggggggggggggggggwwwwwwwgggggggggggggggggggggggggggggggggggggggk',
  '.......kgggggggggggggggggggggggggggggggggwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '......kgggggggggggggggggggggggggggggggggggwwwwwwgggggggggggggggggggggggggggggggggggggggggk',
  '......kgggggggggggggggggggggggggggggggggggwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '.....kggggggggggggggggggggggggggggggggggggwwwwwwwgggggggggggggggggggggggggggggggggggggggggk',
  '....kggggggggggggggggggggggggggggggggggggggwwwwwwwgggggggggggggggggggggggggggggggggggggggggk',
  '....kggggggggggggggggggggggggggggggggggggggwwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '...kggggggggggggggggggggggggggggggggggggggggwwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '..kggggggggggggggggggggggggggggggggggggggggggwwwwwwwgggggggggggggggggggggggggggggggggggggggggk',
  '..kggggggggggggggggggggggggggggggggggggggggggwwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '.kggggggggggggggggggggggggggggggggggggggggggggwwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
  '.kggggggggggggggggggggggggggggggggggggggggggggwwwwwwwwwgggggggggggggggggggggggggggggggggggggggk',
  'kggggggggggggggggggggggggggggggggggggggggggggggwwwwwwwwggggggggggggggggggggggggggggggggggggggggk',
];


const PORTRAIT: Sprite = [
  'oooooooooooooooo',
  'okkkkkkkkkkkkkko',
  'okppppppppppppko',
  'okpppkkkkkppppko',
  'okppkGGGGGkpppko',
  'okpkGXGGXGGkppko',
  'okpkGXGGXGGkppko',
  'okpkGGGGGGGkppko',
  'okpkGGGXGGGkppko',
  'okpkGGGGGGGkppko',
  'okpkGkGGkGkkppko',
  'okpkkpkkpkpkppko',
  'okppppppppppppko',
  'okkkkkkkkkkkkkko',
  'oooooooooooooooo',
];

const CANDELABRA: Sprite = [
  '.y....y....y.',
  'yoy..yoy..yoy',
  '.k....k....k.',
  'kwk..kwk..kwk',
  'kwk..kwk..kwk',
  'kwk..kwk..kwk',
  'kkkkkkkkkkkkk',
  '.....kkk.....',
  '......k......',
  '......k......',
  '......k......',
  '.....kkk.....',
  '...kkkkkkk...',
];

/** The haunted castle on the hill: dark windows by day, lit at night. */
const CASTLE: Sprite = [
  '................k',
  '....koo.........kkk.........koo',
  '....ko........kkkkk.........ko',
  '....k.........kkkkkkk.......k',
  '....kk......kkkkkkkkk.......kk',
  '...kkkk.....kkkkkkkkkkk....kkkk',
  '..kkkkkk..kkkkkkkkkkkkk...kkkkkk',
  '..kkkkkk....kkkkkkkkkk....kkkkkk',
  '.kkkkkkkk...kwwwwwwwwk...kkkkkkkk',
  'kkkkkkkkkk..kwwwwwwwwk..kkkkkkkkkk',
  'kkkkkkkkkkk.kwkkwwkkwk..kkkkkkkkkk',
  '.kkkkkkkk...kwkkwwkkwk...kkkkkkkk',
  '.kwwwwwwk...kwkkwwkkwk...kwwwwwwk',
  '.kwwwwwwk...kwwwwwwwwk...kwwwwwwk',
  '.kwwkkwwk...kwwwwwwwwk...kwwkkwwk',
  '.kwwkkwwk...kwwwkkwwwk...kwwkkwwk',
  '.kwwkkwwkk.kkwwwkkwwwk.k.kwwkkwwk',
  '.kwwwwwwkkkkkwwwwwwwwkkkkkwwwwwwk',
  '.kwwwwwwkkkkkwwwwwwwwkkkkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwkkwwkkwwkwwwwwwwwkwwkkwwkkwwk',
  '.kwwkkwwkkwwkwwwwwwwwkwwkkwwkkwwk',
  '.kwwkkwwkkwwkwwkkkkwwkwwkkwwkkwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
];

const CASTLE_LIT: Sprite = [
  '................k',
  '....koo.........kkk.........koo',
  '....ko........kkkkk.........ko',
  '....k.........kkkkkkk.......k',
  '....kk......kkkkkkkkk.......kk',
  '...kkkk.....kkkkkkkkkkk....kkkk',
  '..kkkkkk..kkkkkkkkkkkkk...kkkkkk',
  '..kkkkkk....kkkkkkkkkk....kkkkkk',
  '.kkkkkkkk...kwwwwwwwwk...kkkkkkkk',
  'kkkkkkkkkk..kwwwwwwwwk..kkkkkkkkkk',
  'kkkkkkkkkkk.kwyywwyywk..kkkkkkkkkk',
  '.kkkkkkkk...kwyywwyywk...kkkkkkkk',
  '.kwwwwwwk...kwyywwyywk...kwwwwwwk',
  '.kwwwwwwk...kwwwwwwwwk...kwwwwwwk',
  '.kwwyywwk...kwwwwwwwwk...kwwyywwk',
  '.kwwyywwk...kwwwyywwwk...kwwyywwk',
  '.kwwyywwkk.kkwwwyywwwk.k.kwwyywwk',
  '.kwwwwwwkkkkkwwwwwwwwkkkkkwwwwwwk',
  '.kwwwwwwkkkkkwwwwwwwwkkkkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwwwwwwwwkwwkkwwwwwwk',
  '.kwwyywwkkwwkwwwwwwwwkwwkkwwyywwk',
  '.kwwyywwkkwwkwwwwwwwwkwwkkwwyywwk',
  '.kwwyywwkkwwkwwkkkkwwkwwkkwwyywwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  '.kwwwwwwkkwwkwkkkkkkwkwwkkwwwwwwk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
];

const DOOR: Sprite = [
  'kkkkkkkkkkkkkk',
  'kwwwwwwwwwwwwk',
  'kwkkkkkkkkkkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkkkkkkkkkkwk',
  'kwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwk',
  'kwwwwwwwwwkokk',
  'kwwwwwwwwwwwwk',
  'kwkkkkkkkkkkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkwwwwwwwwkwk',
  'kwkkkkkkkkkkwk',
  'kwwwwwwwwwwwwk',
  'kwwwwwwwwwwwwk',
  'kkkkkkkkkkkkkk',
];

const STAIRS: Sprite = [
  '......................kk',
  '.....................kk',
  '....................k.k',
  '..................kk..k',
  '.................kk.kkkkk',
  '................k.k.kgggg',
  '..............kk..k.kgggg',
  '.............kk.kkkkkgggg',
  '............k.k.kgggggggg',
  '..........kk..k.kgggggggg',
  '.........kk.kkkkkgggggggg',
  '........k.k.kgggggggggggg',
  '......kk..k.kgggggggggggg',
  '.....kk.kkkkkgggggggggggg',
  '....k.k.kgggggggggggggggg',
  '..kk..k.kgggggggggggggggg',
  '..k.kkkkkgggggggggggggggg',
  '..k.kgggggggggggggggggggg',
  '..k.kgggggggggggggggggggg',
  'kkkkkgggggggggggggggggggg',
  'kgggggggggggggggggggggggg',
  'kgggggggggggggggggggggggg',
  'kkkkkkkkkkkkkkkkkkkkkkkkk',
];

const WEB: Sprite = [
  'kkkkkkkkkkkk',
  '.k...k...k.k',
  '..k..k..k..k',
  '...kkkkk...k',
  '....k.k.k..k',
  '.....kk..k.k',
  '......k...kk',
  '.......k...k',
  '........k..k',
  '.........k.k',
  '..........kk',
  '...........k',
];

/** A ground band of dither, `h` card pixels high, across the bottom of the card. */
function ground(h: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ground';
  el.style.height = `${h}px`;
  return el;
}

/** Night stars at these spots of a card, kept clear of its text. */
const stars = (...at: [number, number][]): Piece[] =>
  at.map(([x, y]) => ({ sprite: STAR, x, y, px: 2, only: 'night' as const }));

const SKY: Piece[] = [
  { sprite: MOON, x: 440, y: 14, px: 3, only: 'night' },
  { sprite: SUN, x: 436, y: 10, px: 3, only: 'day' },
];

/** Day clouds at two spots of a card. */
const clouds = (a: [number, number], b: [number, number]): Piece[] => [
  { sprite: CLOUD, x: a[0], y: a[1], px: 3, only: 'day' },
  { sprite: CLOUD, x: b[0], y: b[1], px: 2, only: 'day' },
];

const ART: Record<string, { pieces: Piece[]; ground?: number }> = {
  home: {
    ground: 46,
    pieces: [
      ...SKY,
      ...stars([40, 24], [110, 58], [470, 74], [22, 110], [404, 100], [70, 214]),
      ...clouds([350, 92], [250, 104]),
      { sprite: GHOST, x: 34, y: 228, px: 3, className: 'bob' },
      { sprite: ICONS.patch!, x: 420, y: 262, px: 3 },
      { sprite: ICONS.patch!, x: 466, y: 284, px: 2 },
    ],
  },
  gate: {
    ground: 40,
    pieces: [
      ...SKY,
      ...stars([390, 60], [130, 70], [60, 150], [470, 130], [20, 220], [340, 110]),
      ...clouds([380, 100], [60, 104]),
      // The castle sits on a hill that rises from the ground; a path winds down to the gate.
      { sprite: HILL, x: 64, y: 168, px: 4 },
      { sprite: CASTLE, x: 205, y: 76, px: 3, only: 'day' },
      { sprite: CASTLE_LIT, x: 205, y: 76, px: 3, only: 'night' },
      { sprite: FENCE, x: 25, y: 275, px: 3 },
      { sprite: FENCE, x: 121, y: 275, px: 3 },
      { sprite: GATE, x: 217, y: 248, px: 3 },
      { sprite: FENCE, x: 295, y: 275, px: 3 },
      { sprite: FENCE, x: 391, y: 275, px: 3 },
    ],
  },
  hall: {
    ground: 34,
    pieces: [
      { sprite: WEB, x: 476, y: 0, px: 3 },
      { sprite: PORTRAIT, x: 380, y: 26, px: 4 },
      { sprite: DOOR, x: 196, y: 212, px: 4 },
      { sprite: STAIRS, x: 262, y: 216, px: 4 },
      { sprite: CANDELABRA, x: 96, y: 243, px: 5 },
      { sprite: GHOST, x: 250, y: 120, px: 3, className: 'bob', only: 'night' },
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
      ...stars([400, 60], [150, 74], [300, 96], [470, 120], [230, 160], [420, 200]),
      ...clouds([330, 96], [230, 132]),
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
