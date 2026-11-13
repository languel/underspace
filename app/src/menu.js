// A context menu: a short list of actions at a point. Items come from the
// action table, filtered by what is under the pointer.

import { h } from './controls.js';
import { icon } from './icons.js';

let open = null;
export function closeMenu() { open?.remove(); open = null; }

// items: [{ title, keys, icon, run } | null], null is a separator
export function showMenu(items, x, y, host = document.body) {
  closeMenu();
  const el = h('div', 'menu');
  el.setAttribute('role', 'menu');
  for (const item of items) {
    if (!item) { if (el.lastChild && el.lastChild.tagName !== 'HR') el.append(h('hr')); continue; }
    const row = h('button', 'menu-item');
    row.setAttribute('role', 'menuitem');
    const glyph = h('span', 'glyph'); glyph.innerHTML = item.icon ? icon(item.icon) : '';
    row.append(glyph, h('span', 'label', item.title), h('kbd', '', item.keys ?? ''));
    row.addEventListener('click', () => { closeMenu(); item.run(); });
    el.append(row);
  }
  if (el.lastChild?.tagName === 'HR') el.lastChild.remove();
  if (!el.children.length) return;
  host.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  open = el;
  el.querySelector('button')?.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    const rows = [...el.querySelectorAll('button')], i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); rows[(i + 1) % rows.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    e.stopPropagation();
  });
}
addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target)) closeMenu(); }, true);
addEventListener('blur', closeMenu);
