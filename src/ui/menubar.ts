// The menu bar across the top of the page, as on a classic Mac: a pumpkin, then menus.
// A menu opens on click and closes when an item is chosen or the click lands elsewhere.

import { PUMPKIN, pixelSvg } from './art';

export interface MenuItem {
  label: string | (() => string);
  run: () => void;
}

export interface Menu {
  title: string;
  items: MenuItem[];
}

export function renderMenubar(menus: Menu[]): HTMLElement {
  const bar = document.createElement('nav');
  bar.className = 'menubar';
  const logo = document.createElement('span');
  logo.className = 'menu-logo';
  logo.appendChild(pixelSvg(PUMPKIN, 2, 'pumpkin lit'));
  bar.appendChild(logo);

  let open: HTMLElement | undefined;
  const close = () => {
    open?.classList.remove('open');
    open = undefined;
  };
  document.addEventListener('click', (e) => {
    if (open && !open.contains(e.target as Node)) close();
  });

  for (const menu of menus) {
    const wrap = document.createElement('div');
    wrap.className = 'menu';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'menu-title';
    title.textContent = menu.title;
    const list = document.createElement('div');
    list.className = 'menu-list';
    title.addEventListener('click', () => {
      const wasOpen = open === wrap;
      close();
      if (wasOpen) return;
      list.replaceChildren(
        ...menu.items.map((item) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'menu-item';
          b.textContent = typeof item.label === 'function' ? item.label() : item.label;
          b.addEventListener('click', () => {
            close();
            item.run();
          });
          return b;
        }),
      );
      wrap.classList.add('open');
      open = wrap;
    });
    wrap.append(title, list);
    bar.appendChild(wrap);
  }
  return bar;
}
