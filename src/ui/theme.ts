// Day or night for the whole interface. It follows the system's light or dark setting
// until the reader picks one; the pick is remembered. 'system' goes back to following it.

export type Theme = 'day' | 'night';
export type ThemeChoice = Theme | 'system';

const KEY = 'stack-seance:theme';
const dark = window.matchMedia('(prefers-color-scheme: dark)');

export function themeChoice(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  return v === 'day' || v === 'night' ? v : 'system';
}

export function currentTheme(): Theme {
  const choice = themeChoice();
  if (choice !== 'system') return choice;
  return dark.matches ? 'night' : 'day';
}

function apply(): void {
  document.documentElement.dataset.theme = currentTheme();
}

export function setTheme(choice: ThemeChoice): void {
  if (choice === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
  apply();
}

export function startTheme(): void {
  apply();
  dark.addEventListener('change', apply);
}
