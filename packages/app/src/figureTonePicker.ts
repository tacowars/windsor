/**
 * The Figure's tone picker (windsor#490; the mockup's "a picker chooses
 * −8..8"): a right-click on a note's tone cell (or the context-menu key)
 * opens a small grid of the seventeen tones, each labelled over the chord
 * the cell reads (`figureModel.ts`'s `toneOptions`), the current one
 * pressed. A pick writes and closes; Escape, a press outside it or a
 * second opening closes it without writing. It hangs from the page body at
 * a fixed position under the cell (over it when the window has no room
 * below), so the device's clipped frame never cuts it.
 */
import { el } from './dom';
import { SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';

/** One tone and the label it reads. */
export interface ToneChoice {
  readonly tone: number;
  readonly label: string;
}

/** The open picker's close, so a second opening replaces the first. */
let closeOpen: (() => void) | null = null;

/** Close the open picker, if one is. */
export function closeTonePicker(): void {
  closeOpen?.();
}

function choiceButton(choice: ToneChoice, current: number, pick: () => void): HTMLButtonElement {
  const button = el('button', 'figure-pick-tone', choice.label) as HTMLButtonElement;
  button.type = 'button';
  button.title = `tone ${choice.tone > 0 ? '+' : ''}${choice.tone}`;
  button.setAttribute('aria-pressed', String(choice.tone === current));
  button.onclick = pick;
  return button;
}

/** Place the picker under `anchor`, or over it when the window has no room below. */
function place(menu: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const height = menu.offsetHeight;
  const below = box.bottom + 2;
  const top = below + height > window.innerHeight ? Math.max(0, box.top - height - 2) : below;
  const left = Math.max(0, Math.min(box.left, window.innerWidth - menu.offsetWidth));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/** Open the picker on `anchor` over `choices`, `current` pressed; `pick` writes the chosen tone. */
export function openTonePicker(
  anchor: HTMLElement,
  choices: readonly ToneChoice[],
  current: number,
  pick: (tone: number) => void,
): void {
  closeTonePicker();
  const menu = el('div', 'figure-tone-picker');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Tone');
  menu.style.setProperty('--figure-pick', `${SEQUENCER_DEVICE_PX['--figure-pick']}px`);
  const close = (): void => {
    if (closeOpen !== close) return;
    closeOpen = null;
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
  const outside = (e: PointerEvent): void => {
    if (!(e.target instanceof Node) || !menu.contains(e.target)) close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    anchor.focus();
  };
  for (const choice of choices) {
    menu.appendChild(
      choiceButton(choice, current, () => {
        close();
        pick(choice.tone);
      }),
    );
  }
  closeOpen = close;
  document.body.appendChild(menu);
  place(menu, anchor);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  menu.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
}
