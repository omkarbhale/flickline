import { css as paletteCss, type PaletteToken } from '../../config/palette';
import { icon, type IconName } from './icons';

/**
 * The UI kit: a few small DOM builders and the class names `kit.css` styles. Menus are built once
 * and updated by text and attribute (never per frame); nothing here is used inside a run.
 */

export interface ElProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** Create an element. Children may be nodes or text. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const k of Object.keys(props.attrs)) el.setAttribute(k, props.attrs[k]!);
  for (const c of children) el.append(c);
  return el;
}

/** Palette tokens as CSS custom properties on `root` (`--trim`, `--ink`, ...): the one place themed colours enter the DOM. */
export function applyPalette(root: HTMLElement): void {
  for (const k of Object.keys(paletteCss) as PaletteToken[]) root.style.setProperty(`--${k}`, paletteCss[k]);
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonOptions {
  variant?: ButtonVariant;
  /** Key hint shown on the button ("Esc", "Backspace", "S"). */
  key?: string;
  icon?: IconName;
  onClick: () => void;
}

/** A button. `onClick` runs on click and on Enter/Space (native); the key hint is only a label. */
export function button(label: string, opts: ButtonOptions): HTMLButtonElement {
  const b = h('button', { class: `fl-btn fl-btn--${opts.variant ?? 'secondary'}`, attrs: { type: 'button' } });
  if (opts.icon) b.insertAdjacentHTML('beforeend', icon(opts.icon, 18));
  b.append(h('span', { class: 'fl-btn-label', text: label }));
  if (opts.key) b.append(h('kbd', { class: 'fl-kbd', text: opts.key }));
  b.addEventListener('click', opts.onClick);
  return b;
}

/** A panel: 1 px trim border on a slate surface, optional title. Put content in `body`. */
export function panel(opts: { title?: string; class?: string } = {}): { el: HTMLElement; body: HTMLElement } {
  const el = h('section', { class: `fl-panel${opts.class ? ` ${opts.class}` : ''}` });
  if (opts.title) el.append(h('h2', { class: 'fl-panel-title', text: opts.title }));
  const body = h('div', { class: 'fl-panel-body' });
  el.append(body);
  return { el, body };
}

export interface TabsHandle {
  readonly el: HTMLElement;
  select(id: string): void;
  readonly selected: string;
}

/**
 * Tabs with arrow-key navigation (Left/Right, Home/End), roving tabindex and ARIA roles.
 * `onSelect` runs after the selection changed; the caller shows and hides the panels.
 */
export function tabs(items: readonly { id: string; label: string }[], onSelect: (id: string) => void): TabsHandle {
  const el = h('div', { class: 'fl-tabs', attrs: { role: 'tablist' } });
  const buttons = items.map((it) => {
    const b = h('button', { class: 'fl-tab', text: it.label, attrs: { type: 'button', role: 'tab', 'data-tab': it.id, 'aria-selected': 'false', tabindex: '-1' } });
    el.append(b);
    return b;
  });
  let selected = items[0]?.id ?? '';
  const select = (id: string, focus = false): void => {
    selected = id;
    for (const b of buttons) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    onSelect(id);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(items[i]!.id));
    b.addEventListener('keydown', (e) => {
      let to = -1;
      if (e.key === 'ArrowRight') to = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') to = (i + buttons.length - 1) % buttons.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = buttons.length - 1;
      if (to < 0) return;
      e.preventDefault();
      select(items[to]!.id, true);
    });
  });
  if (items.length > 0) select(items[0]!.id);
  return {
    el,
    select: (id) => select(id),
    get selected() {
      return selected;
    },
  };
}

export interface ToggleHandle {
  readonly el: HTMLLabelElement;
  readonly input: HTMLInputElement;
}

/** A switch: a real checkbox (keyboard and screen-reader native) drawn as a trim-colour track. */
export function toggle(label: string, attrs: Record<string, string> = {}): ToggleHandle {
  const input = h('input', { class: 'fl-toggle-input', attrs: { type: 'checkbox', ...attrs } });
  const el = h('label', { class: 'fl-toggle' }, [input, h('span', { class: 'fl-toggle-track', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'fl-toggle-label', text: label })]);
  return { el, input };
}
