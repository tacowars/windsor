/** Small DOM and formatting helpers shared by every console tab (#70). */

export const $ = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`console is missing #${id}`);
  return found;
};

export function el(tag: string, className = '', html = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/** Text for an `innerHTML` slot: a part's name is a user label (#597), never markup. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A titled panel section, matching the template's furniture. */
export function section(title: string, hint = ''): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', 'section');
  root.appendChild(el('div', 'section-title', `<span>${title}</span>`));
  if (hint) root.appendChild(el('p', 'hint', hint));
  const body = el('div');
  root.appendChild(body);
  return { root, body };
}

/** A segmented picker. Returns the element; `sync` re-reads the current value. */
export function seg(
  options: readonly { value: string; label: string }[],
  current: () => string,
  onPick: (value: string) => void,
  color?: string,
): HTMLElement {
  const box = el('div', 'seg');
  if (color) box.style.setProperty('--seg-color', color);
  const sync = (): void => {
    [...box.children].forEach((child, i) => {
      child.setAttribute('aria-pressed', String(options[i]?.value === current()));
    });
  };
  for (const option of options) {
    const b = el('button', '', option.label) as HTMLButtonElement;
    b.type = 'button';
    b.onclick = (): void => {
      onPick(option.value);
      sync();
    };
    box.appendChild(b);
  }
  sync();
  return box;
}

/** A labelled `<select class="field">`. */
export function select(
  label: string,
  options: readonly { value: string; label: string }[],
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', label));
  const sel = document.createElement('select');
  sel.className = 'field';
  sel.name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  sel.setAttribute('aria-label', label);
  for (const option of options) sel.add(new Option(option.label, option.value));
  sel.value = current;
  sel.onchange = (): void => onPick(sel.value);
  wrap.appendChild(sel);
  return wrap;
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const noteName = (midi: number): string =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export const fmt2 = (v: number): string => v.toFixed(2);
export const fmt0 = (v: number): string => v.toFixed(0);
export const fmtMs = (v: number): string =>
  v < 1 ? `${(v * 1000).toFixed(0)}m` : `${v.toFixed(2)}s`;
export const fmtHz = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(2)}k` : v.toFixed(0);
export const fmtSigned = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(2);

/** Step divisors of the 96-tick bar, longest first, with musician-facing names. */
export const DIVISOR_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '96', label: '1 bar' },
  { value: '48', label: '1/2' },
  { value: '32', label: '1/2T' },
  { value: '24', label: '1/4' },
  { value: '16', label: '1/4T' },
  { value: '12', label: '1/8' },
  { value: '8', label: '1/8T' },
  { value: '6', label: '1/16' },
  { value: '4', label: '1/16T' },
  { value: '3', label: '1/32' },
];
