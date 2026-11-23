import '../compiler/helpers/noNetwork';
// worker/wrangler.toml, read as text (Requirement 7.9, 8.4, 10.8, 11.2, 12.4).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEXT = readFileSync(fileURLToPath(new URL('../../worker/wrangler.toml', import.meta.url)), 'utf8');

interface Entry {
  /** The table the key is in: '' for the top level, else the header without brackets, such as `vars`. */
  table: string;
  key: string;
  value: string;
}

/** Drops a `#` comment that is not inside a string. */
function withoutComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (ch === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

/** Every `key = value` line with the table it is in. Enough TOML for this file: no multi-line values. */
function entries(text: string): Entry[] {
  const found: Entry[] = [];
  let table = '';
  for (const raw of text.split('\n')) {
    const line = withoutComment(raw).trim();
    if (line === '') continue;
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      table = header[1]!.trim();
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (pair) found.push({ table, key: pair[1]!, value: pair[2]!.trim() });
  }
  return found;
}

const ENTRIES = entries(TEXT);

function value(table: string, key: string): string | undefined {
  return ENTRIES.find((e) => e.table === table && e.key === key)?.value;
}

describe('worker/wrangler.toml', () => {
  it('routes the Worker to stack-seance.enhydrink.com/api/*', () => {
    expect(value('', 'routes')).toBe('[{ pattern = "stack-seance.enhydrink.com/api/*", zone_name = "enhydrink.com" }]');
    expect(value('', 'main')).toBe('"src/index.ts"');
  });

  it('turns off the workers.dev route, preview URLs and invocation logs', () => {
    expect(value('', 'workers_dev')).toBe('false');
    expect(value('', 'preview_urls')).toBe('false');
    expect(value('observability.logs', 'invocation_logs')).toBe('false');
    expect(value('observability', 'enabled')).toBe('true');
  });

  it('binds the DailyLimits Durable Object as a SQLite-backed class', () => {
    expect(value('durable_objects.bindings', 'name')).toBe('"LIMITS"');
    expect(value('durable_objects.bindings', 'class_name')).toBe('"DailyLimits"');
    expect(value('migrations', 'new_sqlite_classes')).toBe('["DailyLimits"]');
    expect(value('migrations', 'new_classes')).toBeUndefined();
  });

  it('turns on nodejs_compat for the SDK', () => {
    expect(value('', 'compatibility_flags')).toBe('["nodejs_compat"]');
  });

  it('defines the four vars, without pinning their values', () => {
    // REQUIRE_ACCESS flips to "false" on submission day, and ACCESS_AUD is set at deployment.
    const vars = ENTRIES.filter((e) => e.table === 'vars').map((e) => e.key);
    expect(vars).toEqual(expect.arrayContaining(['REQUIRE_ACCESS', 'ACCESS_AUD', 'LIMIT_PER_IP', 'LIMIT_PER_SITE']));
    for (const key of vars) expect(value('vars', key), key).toMatch(/^"[^"]*"$/);
  });

  it('holds no ANTHROPIC_API_KEY, which is a secret', () => {
    expect(ENTRIES.map((e) => e.key)).not.toContain('ANTHROPIC_API_KEY');
    expect(TEXT).not.toMatch(/^\s*ANTHROPIC_API_KEY\s*=/m);
    expect(TEXT).not.toMatch(/sk-ant-/);
  });

  it('the reader sees comments and tables the way TOML does', () => {
    expect(entries('a = "x # not a comment" # a comment\n[t]\nb = 1')).toEqual([
      { table: '', key: 'a', value: '"x # not a comment"' },
      { table: 't', key: 'b', value: '1' },
    ]);
  });
});
