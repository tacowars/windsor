/**
 * A number box that types and drags (windsor#12), after Ableton Live's tempo
 * field: a flat number in a box, no dial and no arrows. A vertical drag moves
 * it (up increases) through the spec's `drag` rule; a click without movement
 * focuses it for typing; Enter or blur commits through `parse`, and an entry
 * `parse` refuses reverts. Escape reverts. The rules are the caller's pure
 * functions (`transportModel.ts`); this file only wires pointer and keys.
 */
import { el } from './dom';
import { NUMBER_DRAG_THRESHOLD_PX } from './transportTables';

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

/** Press, drag past the threshold to sweep; release without a drag to type. */
function attachDrag(input: HTMLInputElement, spec: NumberBoxSpec, show: () => void): void {
  let press: { y: number; start: number; moved: boolean } | null = null;
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || document.activeElement === input) return;
    press = { y: e.clientY, start: spec.get(), moved: false };
    input.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  input.addEventListener('pointermove', (e) => {
    if (!press) return;
    const upPx = press.y - e.clientY;
    if (!press.moved && Math.abs(upPx) < NUMBER_DRAG_THRESHOLD_PX) return;
    press.moved = true;
    const value = spec.drag(press.start, upPx, e.shiftKey);
    if (value !== spec.get()) spec.set(value);
    show();
  });
  const release = (e: PointerEvent, typing: boolean): void => {
    if (!press) return;
    const clicked = !press.moved;
    press = null;
    if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
    if (typing && clicked) {
      input.focus();
      input.select();
    }
  };
  input.addEventListener('pointerup', (e) => release(e, true));
  input.addEventListener('pointercancel', (e) => release(e, false));
  input.addEventListener('lostpointercapture', (e) => release(e, false));
}

/** Enter and blur commit a typed entry; Escape reverts it. */
function attachTyping(input: HTMLInputElement, spec: NumberBoxSpec, show: () => void): void {
  const commit = (): void => {
    const value = spec.parse(input.value);
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
  const node = el('label', 'transport-box') as NumberBoxElement;
  const input = boxInput(spec);
  node.appendChild(input);
  node.appendChild(el('span', 'transport-unit', spec.unit));
  const show = (): void => {
    input.value = spec.format(spec.get());
  };
  attachDrag(input, spec, show);
  attachTyping(input, spec, show);
  node.refresh = show;
  show();
  return node;
}
