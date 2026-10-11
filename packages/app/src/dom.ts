/**
 * The DOM builders every console tab shares (#70). Builders only: the number
 * formatters are `consoleFormat.ts`, the sequencer vocabulary
 * `sequencerConstants.ts`, the palette `consoleColors.ts` (#618).
 */

export const $ = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`console is missing #${id}`);
  return found;
};

/** An element with a class and, optionally, its text — text, never markup (#618). */
export function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The explicit opt-in: an element whose content is markup the caller wrote. */
export function html(tag: string, className = '', markup = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (markup) node.innerHTML = markup;
  return node;
}

/** Text for an `innerHTML` slot: a part's name is a user label (#597), never markup. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A titled panel section, matching the template's furniture. */
export function section(title: string, hint = ''): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', 'section');
  const head = el('div', 'section-title');
  head.appendChild(el('span', '', title));
  root.appendChild(head);
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

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/** Options under an `<optgroup>` labelled `group`. */
export interface SelectGroup {
  readonly group: string;
  readonly options: readonly SelectOption[];
}

/** A labelled `<select class="field">`. */
export function select(
  label: string,
  options: readonly SelectOption[],
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  return groupedSelect(label, options, current, onPick);
}

/** `select()` whose items may be `<optgroup>`s, each in the order given. */
export function groupedSelect(
  label: string,
  items: readonly (SelectOption | SelectGroup)[],
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', label));
  const sel = document.createElement('select');
  sel.className = 'field';
  sel.name = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  sel.setAttribute('aria-label', label);
  for (const item of items) {
    if (!('group' in item)) {
      sel.add(new Option(item.label, item.value));
      continue;
    }
    const group = document.createElement('optgroup');
    group.label = item.group;
    for (const option of item.options) group.appendChild(new Option(option.label, option.value));
    sel.appendChild(group);
  }
  sel.value = current;
  sel.onchange = (): void => onPick(sel.value);
  wrap.appendChild(sel);
  return wrap;
}
