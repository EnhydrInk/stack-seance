// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOT_COUNT, fileName, makeSave, readSaveFile, readSlots, saveFile, writeSlot } from '../../src/ui/saves';
import { applyFontSettings, fontSettings, setFontSettings } from '../../src/ui/settings';
import stacks from '../../src/ui/stacks.json';
import type { StacksDoc } from '../../src/ui/types';

const doc = () => JSON.parse(JSON.stringify(stacks)) as StacksDoc;

// Newer Node has a localStorage of its own that shadows jsdom's; use the page's.
vi.stubGlobal('localStorage', (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window.localStorage);

beforeEach(() => localStorage.clear());

describe('save slots', () => {
  it('starts with every slot empty', () => {
    expect(readSlots()).toEqual(Array(SLOT_COUNT).fill(null));
  });

  it('keeps what was written to a slot and leaves the others alone', () => {
    const save = makeSave(doc(), 'Haunted House › Hall', new Date('2026-11-22T10:00:00Z'));
    writeSlot(1, save);
    expect(readSlots()).toEqual([null, save, null]);
  });

  it('copies the stacks, so later edits do not change a save', () => {
    const d = doc();
    const save = makeSave(d, 'Home › Home');
    d.stacks[0]!.cards[0]!.script = 'changed';
    expect(save.doc.stacks[0]!.cards[0]!.script).toBe('');
  });

  it('exports to a file that imports back to the same save', () => {
    const save = makeSave(doc(), 'Home › Home', new Date('2026-11-22T10:00:00Z'));
    expect(readSaveFile(saveFile(save))).toEqual(save);
    expect(fileName(0, save)).toBe('stack-seance-slot-1-2026-11-22.json');
  });

  it('refuses files that are not saves', () => {
    expect(readSaveFile('not json')).toBeUndefined();
    expect(readSaveFile('{"stacks": []}')).toBeUndefined();
    expect(readSaveFile('{"app": "stack-seance"}')).toBeUndefined();
  });
});

describe('font settings', () => {
  it('defaults to the pixel font at 100%', () => {
    expect(fontSettings()).toEqual({ font: 'pixel', scale: 1 });
  });

  it('remembers a change and applies it to the page', () => {
    setFontSettings({ font: 'plain', scale: 1.3 });
    expect(fontSettings()).toEqual({ font: 'plain', scale: 1.3 });
    applyFontSettings();
    expect(document.documentElement.classList.contains('plain-font')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.3');
  });
});

describe('older saves', () => {
  it('get the built-in stacks they were made without, and keep their own', async () => {
    const { withMissingStacks } = await import('../../src/ui/model');
    const old = doc();
    old.stacks = old.stacks.filter((s) => s.id !== 'help');
    old.stacks[0]!.cards[0]!.fields[1]!.text = 'mine';
    const upgraded = withMissingStacks(old, doc());
    expect(upgraded.stacks.map((s) => s.id)).toEqual(['home', 'haunted', 'help']);
    expect(upgraded.stacks[0]!.cards[0]!.fields[1]!.text).toBe('mine');
  });
});
