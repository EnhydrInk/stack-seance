// Font settings, remembered in the browser. The text size only changes the back of the card
// and the dialogs; the front keeps HyperCard's layout and the whole card zooms instead.

export interface FontSettings {
  font: 'pixel' | 'plain';
  /** Multiplies the text on the back and in dialogs. */
  scale: number;
}

export const SCALES = [1, 1.15, 1.3, 1.5] as const;

const KEY = 'stack-seance:settings';
const DEFAULTS: FontSettings = { font: 'pixel', scale: 1 };

export function fontSettings(): FontSettings {
  const saved = localStorage.getItem(KEY);
  return saved ? { ...DEFAULTS, ...(JSON.parse(saved) as Partial<FontSettings>) } : { ...DEFAULTS };
}

export function setFontSettings(change: Partial<FontSettings>): void {
  const next = { ...fontSettings(), ...change };
  localStorage.setItem(KEY, JSON.stringify(next));
  applyFontSettings(next);
}

export function applyFontSettings(s: FontSettings = fontSettings()): void {
  const root = document.documentElement;
  root.classList.toggle('plain-font', s.font === 'plain');
  root.style.setProperty('--font-scale', String(s.scale));
}
