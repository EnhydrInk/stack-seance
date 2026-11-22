// Save slots: a few named copies of every stack, kept in the browser. Each slot can be
// exported to a file and filled from a file. Loading a slot replaces what is on screen.

import type { StacksDoc } from './types';

export const SLOT_COUNT = 3;

export interface Save {
  app: 'stack-seance';
  version: 1;
  /** ISO time the save was made. */
  savedAt: string;
  /** Where the reader was, shown in the slot list. */
  where: string;
  doc: StacksDoc;
}

const KEY = 'stack-seance:slots';

export function readSlots(): (Save | null)[] {
  const saved = localStorage.getItem(KEY);
  const slots = saved ? (JSON.parse(saved) as (Save | null)[]) : [];
  return Array.from({ length: SLOT_COUNT }, (_, i) => slots[i] ?? null);
}

export function writeSlot(index: number, save: Save | null): void {
  const slots = readSlots();
  slots[index] = save;
  localStorage.setItem(KEY, JSON.stringify(slots));
}

export function makeSave(doc: StacksDoc, where: string, now = new Date()): Save {
  return { app: 'stack-seance', version: 1, savedAt: now.toISOString(), where, doc: JSON.parse(JSON.stringify(doc)) as StacksDoc };
}

/** The text of a save file. */
export function saveFile(save: Save): string {
  return JSON.stringify(save, null, 2);
}

/** Reads a save file; undefined when the text is not one. */
export function readSaveFile(text: string): Save | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  const save = data as Partial<Save> | null;
  if (!save || save.app !== 'stack-seance' || !Array.isArray(save.doc?.stacks)) return undefined;
  return save as Save;
}

export function fileName(slot: number, save: Save): string {
  return `stack-seance-slot-${slot + 1}-${save.savedAt.slice(0, 10)}.json`;
}
