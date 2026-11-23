// Pixel art as strings: one character per art pixel. Drawn as inline SVG so the colours
// follow the day and night theme through CSS classes.
//   .  nothing        k  ink          w  paper        g  50% ink dither (1-bit grey)
//   o  pumpkin        p  ghost        y  glow (lit windows, eyes, moon)
//   f  face of the button pumpkin: paper while unlit, glow when lit
//   G  ghost white and X ghost eyes: the same by day and by night, so a ghost stays a ghost

const SVG = 'http://www.w3.org/2000/svg';

export type Sprite = readonly string[];

/**
 * Builds an SVG of `rows`, `px` card pixels per art pixel. Runs of one colour on a row
 * become one rect, so a 16×16 icon is a few dozen elements.
 */
export function pixelSvg(rows: Sprite, px = 2, className = ''): SVGSVGElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w * px));
  svg.setAttribute('height', String(h * px));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === '.' || c === ' ') {
        x++;
        continue;
      }
      if (c === 'g') {
        // Dither: every other pixel, offset per row.
        if ((x + y) % 2 === 0) svg.appendChild(rect(x, y, 1, 'k'));
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      svg.appendChild(rect(x, y, end - x, c));
      x = end;
    }
  });
  return svg;
}

function rect(x: number, y: number, w: number, c: string): SVGRectElement {
  const r = document.createElementNS(SVG, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(w));
  r.setAttribute('height', '1');
  r.setAttribute('class', `c-${c}`);
  return r;
}

// ---- button pumpkin (9×9)

export const PUMPKIN: Sprite = [
  '....kk...',
  '...k.....',
  '.ooo.ooo.',
  'ooooooooo',
  'oofooofoo',
  'ooooooooo',
  'oofffffoo',
  '.oofofoo.',
  '..ooooo..',
];

// ---- Home stack icons (16×16, drawn at 2×)

export const ICONS: Record<string, Sprite> = {
  house: [
    '..........k.....',
    '.......kk.k.....',
    '......kkkkk.....',
    '.....kkkkkkk....',
    '....kkkkkkkkk...',
    '...kkkkkkkkkkk..',
    '..kkkkkkkkkkkkk.',
    '....kwwwwwwwk...',
    '....kwyywyywk...',
    '....kwyywyywk...',
    '....kwwwwwwwk...',
    '....kwwkkkwwk...',
    '....kwwkykwwk...',
    '....kwwkkkwwk...',
    '..kkkkkkkkkkkkk.',
    '................',
  ],
  grave: [
    '................',
    '.....kkkkkk.....',
    '....kwwwwwwk....',
    '...kwwwkwwwwk...',
    '...kwwkkkwwwk...',
    '...kwwwkwwwwk...',
    '...kwwwkwwwwk...',
    '...kwwwwwwwwk...',
    '...kwgwgwgwwk...',
    '...kwwwwwwwwk...',
    '...kwwwwwwwwk...',
    '...kwwwwwwwwk...',
    '.ggkkkkkkkkkkgg.',
    'gggggggggggggggg',
    '.g.g.g.g.g.g.g.g',
    '................',
  ],
  cauldron: [
    '.....p....p.....',
    '...p...pp...p...',
    '.......pp.......',
    '..kkkkkkkkkkkk..',
    '..kppppppppppk..',
    '.kkkkkkkkkkkkkk.',
    '..kkkkkkkkkkkk..',
    '..kkkwkkkkkkkk..',
    '..kkwkkkkkkkkk..',
    '...kkkkkkkkkk...',
    '....kkkkkkkk....',
    '...k........k...',
    '..k..o..o.o..k..',
    '.....oo.ooo.....',
    '....ooyoyyoo....',
    '...kkkkkkkkkk...',
  ],
  patch: [
    '.......k........',
    '......kk..kk....',
    '.......k.k..k...',
    '...oooo.oooo....',
    '..oooooooooooo..',
    '.oooooooooooooo.',
    '.oookooooookooo.',
    '.oookkooookkooo.',
    '.oooooooooooooo.',
    '.ooookkkkkkoooo.',
    '.oooookookooooo.',
    '..oooooooooooo..',
    '...oooooooooo...',
    '.gggggggggggggg.',
    'g.g.g.g.g.g.g.g.',
    '................',
  ],
  sparkle: [
    '.......k........',
    '.......k........',
    '......kpk.......',
    '......kpk.......',
    '..kk.kpppk.kk...',
    '....kpppppk.....',
    'kkkkpppppppkkkk.',
    '....kpppppk.....',
    '..kk.kpppk.kk...',
    '......kpk.......',
    '......kpk.......',
    '.......k........',
    '.......k........',
    '................',
    '................',
    '................',
  ],
  /** Help: Frankenstein's flask with a bolt of lightning over it. */
  help: [
    '........yy......',
    '.......yy.......',
    '......yyyy......',
    '........yy......',
    '.......yy.......',
    '.....kkkkkk.....',
    '......kwwk......',
    '......kwwk......',
    '.....kwwwwk.....',
    '....kwwwwwwk....',
    '...kppppppppk...',
    '..kppwppppppppk.',
    '..kpppppwpppppk.',
    '..kpppppppppppk.',
    '...kpppppppppk..',
    '....kkkkkkkkk...',
  ],
  /** A stack someone made: a pile of cards, the top one with a title bar and a button. */
  cards: [
    'kkkkkkkkkkkk....',
    'kwwwwwwwwwwk....',
    'kwppppppppwkkk..',
    'kwwwwwwwwwwkwk..',
    'kwkkkkkkkwwkwkkk',
    'kwwwwwwwwwwkwkwk',
    'kwkkkkkwwwwkwkwk',
    'kwwwwwwwwwwkwkwk',
    'kwwkoooookwkwkwk',
    'kwwwwwwwwwwkwkwk',
    'kkkkkkkkkkkkwkwk',
    '..kwwwwwwwwwwkwk',
    '..kkkkkkkkkkkkwk',
    '....kwwwwwwwwwwk',
    '....kkkkkkkkkkkk',
    '................',
  ],
};

// ---- haunts

export const BAT_UP: Sprite = [
  'kk...........kk',
  '.kkk..k.k..kkk.',
  '..kkkkkkkkkkk..',
  '...kkkykykkk...',
  '......kkk......',
];

export const BAT_DOWN: Sprite = [
  '......k.k......',
  '...kkkkkkkkk...',
  '.kkkkkykykkkkk.',
  'kkk...kkk...kkk',
  'kk...........kk',
];

export const WOLF: Sprite = [
  'k................k',
  'kk..............kk',
  'kwk............kwk',
  'kwwk..........kwwk',
  'kwwkk.kkkkkk.kkwwk',
  '.kkkkkkkkkkkkkkkk.',
  'kkkkkkkkkkkkkkkkkk',
  '.kkwwkkkkkkkkwwkk.',
  'kkkkwwkkkkkkwwkkkk',
  '.kkkkkkkkkkkkkkkk.',
  'kkkkkkkwwwwkkkkkkk',
  '.kkkkkwwkkwwkkkkk.',
  '..kkkkwwwwwwkkkk..',
  '...kkkwwkkwwkkk...',
  '...kkkwkkkkwkkk...',
  '....kkwkkkkwkk....',
  '....kkwwkkwwkk....',
  '.....kkwwwwkk.....',
  '......kkkkkk......',
];

export const WITCH: Sprite = [
  '..........k.............',
  '.........kk.............',
  '........kkk.............',
  '.......kkkk.............',
  '......kppkk.............',
  '...kkkkkkkkkkk..........',
  '.......kwwk.............',
  '.......kwwwk............',
  '......kkwwkk............',
  '.....kkkkkkkk...........',
  'oo..kkkkkkkkkk..........',
  'ooookkkkkkkkkkkkkkkkkkk.',
  'oooooo..kk..kk..........',
  'oo......................',
];

export const SPIDER: Sprite = [
  'k....kkk....k',
  '.k..kkkkk..k.',
  'kk.kkkkkkk.kk',
  '..kkykkkykk..',
  'kk.kkkkkkk.kk',
  '.k..kkkkk..k.',
  'k...k...k...k',
];

// ---- scenery

export const GHOST: Sprite = [
  '....kkkk....',
  '..kkGGGGkk..',
  '.kGGGGGGGGk.',
  '.kGGXGGXGGk.',
  'kGGGXGGXGGGk',
  'kGpGGGGGGpGk',
  'kGGGGXXGGGGk',
  'kGGGGGGGGGGk',
  'kGGGGGGGGGGk',
  'kGGGGGGGGGGk',
  'kGkGGkkGGkGk',
  'kk.kk..kk.kk',
];

/** A sparkle that grows from a dot to a star, the frames of the spinner while the spirits write. */
export const SPARKLE: readonly Sprite[] = [
  ['.......', '.......', '.......', '...o...', '.......', '.......', '.......'],
  ['.......', '.......', '...p...', '..pop..', '...p...', '.......', '.......'],
  ['.......', '...p...', '...p...', '.ppopp.', '...p...', '...p...', '.......'],
  ['...p...', '.p.p.p.', '..ppp..', 'pppoppp', '..ppp..', '.p.p.p.', '...p...'],
  ['p..p..p', '.p.p.p.', '..ppp..', 'pppoppp', '..ppp..', '.p.p.p.', 'p..p..p'],
];

export const MOON: Sprite = [
  '....yyyy....',
  '..yyyyyy....',
  '.yyyyy......',
  '.yyyy.......',
  'yyyy........',
  'yyyy........',
  'yyyy........',
  'yyyy........',
  '.yyyy.......',
  '.yyyyy......',
  '..yyyyyy....',
  '....yyyy....',
];

export const SUN: Sprite = [
  '.....k..k.....',
  '..k..........k',
  '....kkkkkk....',
  '...kyyyyyyk...',
  'k.kyyyyyyyyk..',
  '..kykkyykkyk.k',
  '..kyyyyyyyyk..',
  'k.kyyyykyyyk..',
  '..kyyyyyyyyk.k',
  '...kyyyyyyk...',
  '....kkkkkk....',
  '..k.......k...',
  '.....k..k.....',
];

export const STAR: Sprite = ['.y.', 'yyy', '.y.'];
