/**
 * A number box that types and drags (windsor#12), after Ableton Live's tempo
 * field: a flat number in a box, no dial and no arrows. A vertical drag moves
 * it (up increases) through the spec's `drag` rule; a click without movement
 * focuses it for typing; Enter or blur commits through `parse`, and an entry
 * `parse` refuses reverts. Escape reverts. The rules are the caller's pure
 * functions (`transportModel.ts`); this file only wires pointer and keys.
 */
import { el } from './dom';
import { pressMove, startsPress, typedEntry } from './transportModel';

export interface NumberBoxSpec {
  /** The accessible name and tooltip's subject. */
  label: string;
  /** The small unit printed beside the number. */
  unit: string;
  inputMode: 'decimal' | 'numeric';
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
  /** A typed entry's value, or null to revert. */
  parse: (text: string) => number | null;
  /** The value a drag of `upPx` pixels (up positive) reaches from `start`. */
  drag: (start: number, upPx: number, fine: boolean) => number;
}

/** A box that can be told to re-read its value (tap tempo writes the tempo it shows). */
export interface NumberBoxElement extends HTMLElement {
  refresh: () => void;
}

function boxInput(spec: NumberBoxSpec): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'transport-box-input';
  input.inputMode = spec.inputMode;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.name = spec.label.toLowerCase();
  input.setAttribute('aria-label', spec.label);
  input.title = `${spec.label} - drag up or down, shift-drag for fine, click to type`;
  return input;
}

/**
 * Press anywhere in the box (the number or its unit), drag past the threshold
 * to sweep; release without a drag to type. The gesture lives on the whole
 * box, the surface that shows the ns-resize cursor and refuses touch panning.
 */
function attachDrag(
  box: HTMLElement,
  input: HTMLInputElement,
  spec: NumberBoxSpec,
  show: () => void,
): void {
  let press: { y: number; start: number; moved: boolean } | null = null;
  box.addEventListener('pointerdown', (e) => {
    const typing = document.activeElement === input;
    if (!startsPress(e.button, e.target === input, typing)) return;
    press = { y: e.clientY, start: spec.get(), moved: false };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', (e) => {
    if (!press) return;
    const upPx = press.y - e.clientY;
    const move = pressMove(press.moved, upPx, e.buttons);
    if (move === 'end') {
      release(e, false);
      return;
    }
    if (move === 'wait') return;
    press.moved = true;
    const value = spec.drag(press.start, upPx, e.shiftKey);
    if (value !== spec.get()) spec.set(value);
    show();
  });
  const release = (e: PointerEvent, typing: boolean): void => {
    if (!press) return;
    const clicked = !press.moved;
    press = null;
    if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    if (typing && clicked) {
      input.focus();
      input.select();
    }
  };
  box.addEventListener('pointerup', (e) => release(e, true));
  box.addEventListener('pointercancel', (e) => release(e, false));
  box.addEventListener('lostpointercapture', (e) => release(e, false));
}

/**
 * Enter and blur commit a typed entry; Escape reverts it. Text left as the
 * box showed it commits nothing (`typedEntry`), so a focus and blur never
 * rewrites a value the box displays rounded.
 */
function attachTyping(input: HTMLInputElement, spec: NumberBoxSpec, show: () => void): void {
  let shown = input.value;
  input.addEventListener('focus', () => {
    shown = input.value;
  });
  const commit = (): void => {
    const value = typedEntry(input.value, shown, spec.parse);
    if (value !== null && value !== spec.get()) spec.set(value);
    show();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      show();
      input.blur();
      e.preventDefault();
    }
  });
}

/** Build one box: the number and its unit, the same height as the tab bar. */
export function makeNumberBox(spec: NumberBoxSpec): NumberBoxElement {
  const node = el('div', 'transport-box') as NumberBoxElement;
  const input = boxInput(spec);
  node.appendChild(input);
  node.appendChild(el('span', 'transport-unit', spec.unit));
  const show = (): void => {
    input.value = spec.format(spec.get());
  };
  attachDrag(node, input, spec, show);
  attachTyping(input, spec, show);
  node.refresh = show;
  show();
  return node;
}
