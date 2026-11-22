// The front of the current card: scenery, fields and buttons, laid out in card pixels.

import { ICONS, PUMPKIN, pixelSvg } from './art';
import { drawScenery } from './scenery';
import type { ButtonDoc, CardDoc, Rect } from './types';

function place(el: HTMLElement, [x, y, w, h]: Rect): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

export function renderFront(card: CardDoc, el: HTMLElement, onClick: (b: ButtonDoc) => void): void {
  el.replaceChildren();
  const scenery = document.createElement('div');
  scenery.className = 'scenery';
  drawScenery(card.art, scenery);
  el.appendChild(scenery);

  for (const f of card.fields) {
    const div = document.createElement('div');
    div.className = `field field-${f.style}${f.align === 'center' ? ' center' : ''}`;
    div.hidden = !f.visible;
    div.textContent = f.text;
    place(div, f.rect);
    el.appendChild(div);
  }

  for (const b of card.buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-${b.style}`;
    btn.hidden = !b.visible;
    btn.dataset.id = b.id;
    place(btn, b.rect);
    if (b.style === 'icon') {
      const icon = ICONS[b.icon ?? ''];
      if (icon) btn.appendChild(pixelSvg(icon, 3, 'icon'));
    } else {
      btn.appendChild(pixelSvg(PUMPKIN, 2, 'pumpkin'));
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = b.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => onClick(b));
    el.appendChild(btn);
  }
}
