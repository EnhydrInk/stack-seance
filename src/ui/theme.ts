// Day or night for the whole interface. It follows the system's light or dark setting
// until the reader picks one; the pick is remembered.

export type Theme = 'day' | 'night';

const KEY = 'stack-seance:theme';
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function chosen(): Theme | null {
  const v = localStorage.getItem(KEY);
  return v === 'day' || v === 'night' ? v : null;
}

export function currentTheme(): Theme {
  return chosen() ?? (dark.matches ? 'night' : 'day');
}

function apply(): void {
  document.documentElement.dataset.theme = currentTheme();
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  apply();
}

export function startTheme(): void {
  apply();
  dark.addEventListener('change', apply);
}
