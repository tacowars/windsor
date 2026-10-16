/**
 * The part colour picker (windsor#642; record `2026-10-07-part-colours`,
 * decision 9; the mockup `docs/research/2026-10-07-part-colours/`). A
 * right-click on a chip in the part strip, or a touch or pen long press on
 * it, opens a 7 × 2 grid of the palette's swatches (`PART_COLORS`) under the
 * chip, the part's colour ringed and the name of the swatch under the
 * pointer, or else of the part's colour, below the grid. One click writes
 * and closes; Escape, a press outside it, a scroll or a second opening
 * closes it without writing. A long press that opened it does not also
 * select the chip.
 *
 * It hangs from the page body at a fixed position, as the Figure's tone
 * picker (`figureTonePicker.ts`) does, so it shows on every tab the strip
 * does. The rules are `partColourPickerModel.ts`.
 */
import { PART_COLORS } from './consoleColors';
import { el } from './dom';
import { wireLongPress } from './longPress';
import type { Box } from './partColourPickerModel';
import { pickerPosition, swatchCaption } from './partColourPickerModel';

/** The part the picker colours: its name for the title and its colour, ringed. */
export interface PickedPart {
  readonly name: string;
  readonly colour: number;
}

/** The open picker's close, so a second opening replaces the first. */
let closeOpen: (() => void) | null = null;

/** Close the open picker, if one is, without writing. */
export function closePartColourPicker(): void {
  closeOpen?.();
}

function swatch(colour: number, current: number, caption: HTMLElement): HTMLButtonElement {
  const entry = PART_COLORS[colour];
  const button = el('button', 'pcp-swatch') as HTMLButtonElement;
  button.type = 'button';
  button.title = entry?.name ?? '';
  button.setAttribute('aria-label', entry?.name ?? '');
  button.setAttribute('aria-pressed', String(colour === current));
  button.style.setProperty('--pc', entry?.hex ?? '');
  button.addEventListener('pointerenter', () => {
    caption.textContent = swatchCaption(colour, current);
  });
  button.addEventListener('pointerleave', () => {
    caption.textContent = swatchCaption(null, current);
  });
  return button;
}

/** What the picker opens under: a chip, or a point such as where a context menu opened (windsor#826). */
export type PickerAnchor = HTMLElement | Box;

function place(menu: HTMLElement, anchor: PickerAnchor): void {
  const { x, y } = pickerPosition(
    anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor,
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: document.documentElement.clientWidth, height: window.innerHeight },
  );
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

/** Open the picker under `anchor` for `part`; `pick` writes the chosen colour. */
export function openPartColourPicker(
  anchor: PickerAnchor,
  part: PickedPart,
  pick: (colour: number) => void,
): void {
  closePartColourPicker();
  const menu = el('div', 'part-colour-picker');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Part color');
  const title = el('div', 'pcp-title', 'Color');
  title.appendChild(el('span', '', part.name));
  const caption = el('div', 'pcp-name', swatchCaption(null, part.colour));
  const grid = el('div', 'pcp-grid');
  const close = (): void => {
    if (closeOpen !== close) return;
    closeOpen = null;
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', close, true);
  };
  const outside = (e: PointerEvent): void => {
    if (!(e.target instanceof Node) || !menu.contains(e.target)) close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    if (anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  };
  PART_COLORS.forEach((_, colour) => {
    const button = swatch(colour, part.colour, caption);
    button.onclick = (): void => {
      close();
      pick(colour);
    };
    grid.appendChild(button);
  });
  menu.append(title, grid, caption);
  closeOpen = close;
  document.body.appendChild(menu);
  place(menu, anchor);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', close, { capture: true, passive: true });
  menu.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
}

/**
 * Open the picker from `chip` on a right-click, or on a touch or pen long
 * press (`wireLongPress`, shared with the context menus). The returned call
 * says, once, whether the click now arriving ends a long press that opened
 * the picker, so the chip's own click can leave the selection alone.
 */
export function wireChipColour(chip: HTMLElement, open: () => void): () => boolean {
  const hold = wireLongPress(chip, open);
  chip.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // A touch long press may bring the platform's own context menu; one opening is enough.
    if (hold.claimContextMenu()) open();
  });
  return hold.took;
}
