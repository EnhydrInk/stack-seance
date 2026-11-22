// The Settings and Saves windows, opened from the File menu.

import { copy, upgrade, type Model } from './model';
import { fileName, makeSave, readSaveFile, readSlots, saveFile, writeSlot, type Save } from './saves';
import type { Screen } from './screen';
import { SCALES, fontSettings, setFontSettings } from './settings';
import { setTheme, themeChoice, type ThemeChoice } from './theme';
import type { StacksDoc } from './types';

export interface PanelDeps {
  screen: Screen;
  model: Model;
  defaults: StacksDoc;
  /** After the stacks were replaced (revert, load): show the front of Home and open it. */
  afterReplace: () => Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function choices<T extends string | number>(
  legend: string,
  name: string,
  options: { value: T; label: string }[],
  current: T,
  onPick: (value: T) => void,
): HTMLFieldSetElement {
  const set = el('fieldset', 'choices');
  set.appendChild(el('legend', '', legend));
  for (const o of options) {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.checked = o.value === current;
    input.addEventListener('change', () => onPick(o.value));
    label.append(input, document.createTextNode(o.label));
    set.appendChild(label);
  }
  return set;
}

export function openSettings(d: PanelDeps): void {
  const body = el('div', 'settings');
  const font = fontSettings();
  body.append(
    choices<ThemeChoice>(
      'Day and night',
      'theme',
      [
        { value: 'system', label: 'Same as my system' },
        { value: 'day', label: 'Day' },
        { value: 'night', label: 'Night' },
      ],
      themeChoice(),
      setTheme,
    ),
    choices(
      'Font',
      'font',
      [
        { value: 'pixel', label: 'Pixel' },
        { value: 'plain', label: 'Plain' },
      ],
      font.font,
      (f) => setFontSettings({ font: f }),
    ),
    choices(
      'Text size on the back and in dialogs',
      'scale',
      SCALES.map((s) => ({ value: s as number, label: `${Math.round(s * 100)}%` })),
      font.scale,
      (s) => setFontSettings({ scale: s }),
    ),
  );

  const revert = el('fieldset', 'choices');
  revert.appendChild(el('legend', '', 'Start over'));
  revert.appendChild(el('p', 'note', 'Puts every stack back the way it came. Your saves are kept.'));
  const button = el('button', 'dbtn', 'Revert to original…');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const pick = await d.screen.answer('Put every stack back the way it came? Your changes on screen will be lost.', ['Revert', 'Cancel']);
    if (pick !== 'Revert') return;
    close();
    d.model.replace(copy(d.defaults));
    await d.afterReplace();
  });
  revert.appendChild(button);
  body.appendChild(revert);

  const close = d.screen.openPanel('Settings', body);
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describe(save: Save | null): string {
  if (!save) return 'Empty';
  const when = new Date(save.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${save.where} · ${when}`;
}

export function openSaves(d: PanelDeps): void {
  const body = el('div', 'saves');
  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'application/json,.json';
  picker.hidden = true;
  let importInto = 0;

  const render = () => {
    const slots = readSlots();
    body.replaceChildren(picker);
    slots.forEach((save, i) => {
      const row = el('div', 'slot');
      row.append(el('div', 'slot-name', `Slot ${i + 1}`), el('div', 'slot-info', describe(save)));
      const buttons = el('div', 'slot-buttons');
      const add = (label: string, enabled: boolean, run: () => void | Promise<void>) => {
        const b = el('button', 'dbtn small', label);
        b.type = 'button';
        b.disabled = !enabled;
        b.addEventListener('click', () => void run());
        buttons.appendChild(b);
      };
      add('Save here', true, async () => {
        if (save) {
          const pick = await d.screen.answer(`Replace what is in slot ${i + 1}?`, ['Replace', 'Cancel']);
          if (pick !== 'Replace') return;
        }
        writeSlot(i, makeSave(d.model.doc, `${d.model.stack.name} › ${d.model.card.name}`));
        render();
      });
      add('Load', !!save, async () => {
        const pick = await d.screen.answer(`Load slot ${i + 1}? What is on screen now will be replaced.`, ['Load', 'Cancel']);
        if (pick !== 'Load' || !save) return;
        close();
        d.model.replace(upgrade(copy(save.doc), d.defaults));
        await d.afterReplace();
      });
      add('Export', !!save, () => {
        if (save) download(fileName(i, save), saveFile(save));
      });
      add('Import…', true, () => {
        importInto = i;
        picker.value = '';
        picker.click();
      });
      row.appendChild(buttons);
      body.appendChild(row);
    });
  };

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    const save = readSaveFile(await file.text());
    if (!save) {
      await d.screen.answer('That file is not a Stack Séance save.', ['OK']);
      return;
    }
    if (readSlots()[importInto]) {
      const pick = await d.screen.answer(`Replace what is in slot ${importInto + 1} with this file?`, ['Replace', 'Cancel']);
      if (pick !== 'Replace') return;
    }
    writeSlot(importInto, save);
    render();
  });

  render();
  const close = d.screen.openPanel('Saves', body);
}
