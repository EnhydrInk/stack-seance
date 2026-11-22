// Tide Pool sprites: a witch otter, a zombie octopus, and the two of them afloat. Generated
// pixel art; otter and octopus colours are fixed, the hat and wand use the card colours.

import type { Sprite } from './art';

export const TIDE_COLORS: Record<string, string> = {
  "H": "#9c8163",
  "C": "#f1e3cc",
  "B": "#5e4331",
  "b": "#a47d5a",
  "L": "#bf9a76",
  "N": "#3b2a23",
  "R": "#eda9a4",
  "F": "#7d6657",
  "U": "#56719a",
  "u": "#86a3c7",
  "T": "#b4c9e2",
  "W": "#ffffff",
  "K": "#27303f",
  "Q": "#f3a8b8",
  "S": "#3f5578",
  "Z": "#8fbf6a"
};

export const otterWitch: Sprite = [
  "......................",
  "......................",
  "......................",
  "...........kk.........",
  "..........kpk.........",
  ".........kppk.........",
  "........kpppk.........",
  ".......kppppk.........",
  "......kkkkkkk.........",
  "......kooookk.........",
  "..kkkkkkkkkkkkkk......",
  "......HCCCCCH.........",
  ".....HCCCCCCCH....y...",
  "....bHCCCCCCCHb..yyy..",
  "....bHCNCCCNCHb...y...",
  ".....HRCCNCCRH...k....",
  "......HCCCCCHB..k.....",
  ".....BbHHHHHbbBk......",
  ".....BbBBLLLbBk.......",
  ".....BbLLLLLLbB.......",
  ".....BbLLLLLLbB.BB....",
  ".....BbLLLLLLbbBbB....",
  ".....BbbLLLLbbbbbB....",
  "......BbbLLbbBbbB.....",
  "......FFBBBBFFBB......",
  "......................"
];

export const otterCast: Sprite = [
  "......................",
  "......................",
  "......................",
  "...........kk.........",
  "..........kpk.........",
  ".........kppk.........",
  "........kpppk.........",
  ".......kppppk........o",
  "......kkkkkkk....o....",
  "......kooookk.......y.",
  "..kkkkkkkkkkkkkk...yyy",
  "......HCCCCCH......ky.",
  ".....HCCCCCCCH....k...",
  "....bHCCCCCCCHb..k....",
  "....bHCNCCCNCHb.k.....",
  ".....HRCCNCCRH.k......",
  "......HCCCCCHBk.......",
  ".....BbHHHHHbBB.......",
  ".....BbBBLLLbbB.......",
  ".....BbLLLLLLbB.......",
  ".....BbLLLLLLbB.BB....",
  ".....BbLLLLLLbbBbB....",
  ".....BbbLLLLbbbbbB....",
  "......BbbLLbbBbbB.....",
  "......FFBBBBFFBB......",
  "......................"
];

export const zombie: Sprite = [
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  "..............................",
  ".............UUUUU............",
  "...........UNuNuNuUU..........",
  "..........UuuNuNuZZuU.........",
  ".........UuuuuuuuuZTuU........",
  ".....UUUUUuKKWuuuKKWuU........",
  "...UUuuuuUuKKKuuuKKKuU........",
  "..UuUUUUUUuWKKuSuWKKuU........",
  "..UU.....UQQZuuuuuuQQU....UU..",
  "...U.UUUUUUZuuuuuuuZUU....UU..",
  "...UUuuuuuuUUuuuuuUUuuUUUUuU..",
  "..UuUUUUUUUUuuUuUuuUuuuuuuTU..",
  "..UU......UUuuUuUuuUUUUUUUU...",
  ".........UuUuUUuUUuUuU........",
  "..........UuuUUuUUuuU.........",
  "..........UuU.UuU.UuU.........",
  "..........UuU.UuU.UuU.........",
  ".........UuU..UuU..UuU........",
  ".........UuU..UuU..UuU........",
  ".........UuU..UuU..UuU........",
  "..........UTU.UU..UTU.........",
  "..........UUU.UU..UUU.........",
  "............UUU...............",
  ".............U................",
  ".............................."
];

export const octopus: Sprite = [
  "..............................",
  "..............................",
  "..............................",
  ".......UU.....................",
  "......UTUU....................",
  "......UU.....UUUUU............",
  "......UuU..UUuuuuuUU..........",
  "......UuU.UuuuuuuTTuU.........",
  ".......UuUuuuuuuuuuTuU........",
  ".......UuUuKKWuuuKKWuU........",
  "........UUuKKKuuuKKKuU........",
  ".........UuWKKuSuWKKuU........",
  "...UU....UQQuuuuuuuQQU....UU..",
  "...UU....UUuuuuuuuuuUU....UU..",
  "...UuUUUUuuUUuuuuuUUuuUUUUuU..",
  "...UTuuuuuuUuuUuUuuUuuuuuuTU..",
  "....UUUUUUUUuuUuUuuUUUUUUUU...",
  ".........UuUuUUuUUuUuU........",
  "..........UuuUUuUUuuU.........",
  "..........UuU.UuU.UuU.........",
  "..........UuU.UuU.UuU.........",
  ".........UuU..UuU..UuU........",
  ".........UuU..UuU..UuU........",
  ".........UuU..UuU..UuU........",
  "..........UTU.UU..UTU.........",
  "..........UUU.UU..UUU.........",
  "............UUU...............",
  ".............U................",
  ".............................."
];

export const otterFloat: Sprite = [
  "...............................",
  "...HHHHH.................FF....",
  "..HCCCCCHBB..BBBBBB.BB...FF....",
  ".HCCCCCCCHbBBBBLLBBBbbBFFFF....",
  "bHCCCCCCCHbLLbLLLLbbbbBFFF.....",
  "bHCNCCCNCHbLLLLLLLbbbbBFFF.....",
  ".HRCCNCCRHbbLbLLLLbbbbbBB......",
  "..HCCCCCHbbbbbbbbbbbbbbbbBB.B..",
  "...HHHHHBBBBBbbbbbbbbbbBBbbBB..",
  ".............BBBBBBBBBB..BB.B..",
  "..............................."
];

export const octopusFloat: Sprite = [
  ".........UUUUU......",
  ".......UUuuuuuUU....",
  "......UuTTuuuuuuU...",
  ".....UuTuuuuuuuuuU..",
  "..UU.UuuKuuuuuKuuU..",
  "..UU.UuKuKuuuKuKuU..",
  "..UU.UuuuuuSuuuuuU..",
  "..UuUUQQuuuuuuuQQU..",
  "...UUuUuuuuuuuuuU...",
  ".....UUUUuuuuuUU....",
  ".......UUU..........",
  "....................",
  "...................."
];

export const heart: Sprite = [
  ".RR.RR.",
  "RRRRRRR",
  "RRRRRRR",
  ".RRRRR.",
  "..RRR..",
  "...R..."
];

export const sparks: Sprite = [
  "..o.....y..",
  ".ooo...yyy.",
  "..o..y..y..",
  "....yyy....",
  ".y...y...o.",
  "yyy.....ooo",
  ".y.......o."
];

