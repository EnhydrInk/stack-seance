import { describe, expect, it } from 'vitest';
import { parse } from '../../src/hypertalk/index';
import stacks from '../../src/ui/stacks.json';
import type { StacksDoc } from '../../src/ui/types';

const doc = stacks as StacksDoc;
const scripts = doc.stacks.flatMap((s) =>
  s.cards.flatMap((c) => [
    { who: `${s.name} / card ${c.name}`, source: c.script },
    ...c.buttons.map((b) => ({ who: `${s.name} / ${c.name} / button ${b.name}`, source: b.script })),
  ]),
);

describe('built-in stacks', () => {
  it.each(scripts)('$who parses', ({ source }) => {
    const parsed = parse(source);
    expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
  });

  it('has unique ids across stacks, cards, fields and buttons', () => {
    const ids = doc.stacks.flatMap((s) => [s.id, ...s.cards.flatMap((c) => [c.id, ...c.fields.map((f) => f.id), ...c.buttons.map((b) => b.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens at a stack named Home', () => {
    expect(doc.stacks.some((s) => s.id === 'home' && s.name === 'Home')).toBe(true);
  });
});

describe('Tide Pool', () => {
  it('its script parses', async () => {
    const { SCRIPT } = await import('../../src/ui/tidepool');
    const parsed = parse(SCRIPT);
    expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
  });
});
