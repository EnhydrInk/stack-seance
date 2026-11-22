// While the compiler works: a sparkle that turns like a spinner and the seconds counting up,
// so a long séance never looks stuck.

import { SPARKLE, pixelSvg } from './art';

const ORDER = [0, 1, 2, 3, 4, 3, 2, 1];
const FRAME_MS = 120;

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The status line to show while waiting; call `stop` when the reply is in. */
export function spiritsWriting(): { el: HTMLElement; stop: () => void } {
  const el = document.createElement('span');
  el.className = 'writing';
  el.setAttribute('role', 'status');
  const spark = document.createElement('span');
  spark.className = 'spark';
  const text = document.createElement('span');
  text.textContent = 'The spirits are writing…';
  const time = document.createElement('span');
  time.className = 'writing-time';
  el.append(spark, text, time);

  const frames = SPARKLE.map((f) => pixelSvg(f, 2));
  const start = performance.now();
  let tick = 0;
  const draw = () => {
    spark.replaceChildren(frames[ORDER[tick++ % ORDER.length]!]!);
    time.textContent = `(${elapsed(performance.now() - start)})`;
  };
  draw();
  const timer = setInterval(draw, FRAME_MS);
  return { el, stop: () => clearInterval(timer) };
}
