import { defineConfig, type Plugin } from 'vite';

// Served from the root of stack-seance.enhydrink.com.
export default defineConfig({
  base: '/',
  build: { outDir: 'dist' },
  plugins: [fakeCompiler()],
});

/**
 * Dev server only: a stand-in for POST /api/compile, so the UI can be built before the real
 * compiler (a Cloudflare Worker, built in Kiro) exists. It knows a few words, nothing more.
 * Never part of the build.
 */
function fakeCompiler(): Plugin {
  return {
    name: 'fake-compiler',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/compile', (req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          const reply = fakeCompile(JSON.parse(body) as FakeRequest);
          const status = reply.ok ? 200 : reply.error === 'nothing' ? 422 : reply.error === 'limit' ? 429 : 502;
          setTimeout(() => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(reply));
          }, 1200);
        });
      });
    },
  };
}

interface FakeRequest {
  sentence: string;
  cardNames: string[];
  buttonNames: string[];
}

function fakeCompile(r: FakeRequest) {
  const s = r.sentence.toLowerCase();
  if (s.includes('limit')) return { ok: false as const, error: 'limit' as const, scope: 'site' as const };
  const lines: string[] = [];
  const skipped: string[] = [];
  const newCards: string[] = [];
  let label = '';
  const haunts: [RegExp, string][] = [
    [/\bbats?\b/, 'release bat'],
    [/howl|wolf/, 'howl'],
    [/witch/, 'summon witch'],
    [/spider/, 'drop spider'],
  ];
  for (const [re, line] of haunts) if (re.test(s)) lines.push(line);
  if (/song|music|sound|sing/.test(s)) skipped.push('play music');
  if (/\bnext\b/.test(s)) {
    lines.push('go to next card');
    label = 'Next';
  } else if (/\b(back|previous)\b/.test(s)) {
    lines.push('go to prev card');
    label = 'Back';
  } else {
    const m = /\bto (?:the )?([a-z]+)/.exec(s);
    if (m && !['go', 'be', 'say'].includes(m[1]!)) {
      const name = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
      if (!r.cardNames.some((c) => c.toLowerCase() === name.toLowerCase())) newCards.push(name);
      lines.push(`go to card "${name}"`);
      label = `To the ${name}`;
    }
  }
  if (!lines.length) {
    if (skipped.length) return { ok: false as const, error: 'nothing' as const, skipped };
    lines.push(`answer "${r.sentence.replace(/"/g, "'")}"`);
  }
  if (!label) label = r.sentence.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'Spell';
  label = label.slice(0, 24);
  let unique = label;
  for (let n = 2; r.buttonNames.some((b) => b.toLowerCase() === unique.toLowerCase()); n++) unique = `${label.slice(0, 21)} ${n}`;
  return { ok: true as const, label: unique, script: `on mouseUp\n  ${lines.join('\n  ')}\nend mouseUp`, newCards, skipped };
}
