// A context menu: a short list of actions at a point. Items come from the
// action table, filtered by what is under the pointer.

import { h } from './controls.js';
import { icon } from './icons.js';

let open = null, subs = [];
export function closeMenu() { open?.remove(); open = null; closeSubs(0); }
function closeSubs(depth) { while (subs.length > depth) subs.pop().remove(); }

// items: [{ title, keys, icon, run, items?, header? } | null], null is a separator.
// An item with `items` opens them beside it; a header is a row that does nothing.
export function showMenu(items, x, y, host = document.body) {
  closeMenu();
  const el = build(items, host, 0);
  if (!el) return;
  place(el, x, y);
  open = el;
  el.querySelector('button')?.focus({ preventScroll: true });
}

function place(el, x, y) {
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}

function build(items, host, depth) {
  const el = h('div', 'menu');
  el.setAttribute('role', 'menu');
  for (const item of items) {
    if (!item) { if (el.lastChild && el.lastChild.tagName !== 'HR') el.append(h('hr')); continue; }
    if (item.header) { el.append(h('div', 'menu-head', item.title)); continue; }
    if (item.items && !item.items.some(Boolean)) continue;
    const row = h('button', 'menu-item' + (item.items ? ' sub' : '') + (item.on ? ' on' : ''));
    row.setAttribute('role', 'menuitem');
    const glyph = h('span', 'glyph'); glyph.innerHTML = item.icon ? icon(item.icon) : '';
    row.append(glyph, h('span', 'label', item.title), h('kbd', '', item.items ? '›' : item.keys ?? ''));
    if (item.items) {
      const openSub = () => {
        if (subs[depth]?.dataset.of === item.title) return;
        closeSubs(depth);
        const sub = build(item.items, host, depth + 1);
        if (!sub) return;
        sub.dataset.of = item.title;
        subs.push(sub);
        const r = row.getBoundingClientRect(), w = sub.getBoundingClientRect().width;
        place(sub, r.right + w + 4 > innerWidth ? r.left - w - 2 : r.right + 2, r.top - 4);
      };
      row.addEventListener('pointerenter', openSub);
      row.addEventListener('click', openSub);
      row.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { openSub(); subs[depth]?.querySelector('button')?.focus(); } });
    } else {
      row.addEventListener('pointerenter', () => closeSubs(depth));
      row.addEventListener('click', () => { closeMenu(); item.run(); });
    }
    el.append(row);
  }
  while (el.lastChild?.tagName === 'HR') el.lastChild.remove();
  if (!el.querySelector('button')) return null;
  host.append(el);
  el.addEventListener('keydown', (e) => {
    const rows = [...el.querySelectorAll(':scope > button')], i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); rows[(i + 1) % rows.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length].focus(); }
    else if (e.key === 'ArrowLeft' && depth) { e.preventDefault(); closeSubs(depth - 1); (depth > 1 ? subs[depth - 2] : open)?.querySelector('button')?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    e.stopPropagation();
  });
  return el;
}
// A popover holds controls. build() -> nodes; refresh() rebuilds it in place
// unless a field in it is being typed in.
export function showPopover(build, x, y) {
  closeMenu();
  const el = h('div', 'menu popover props');
  el.append(...build());
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeMenu(); });
  open = el;
  return {
    refresh() {
      if (open !== el || (el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
      el.replaceChildren(...build());
    },
  };
}
addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target) && !subs.some((m) => m.contains(e.target))) closeMenu(); }, true);
addEventListener('blur', closeMenu);
