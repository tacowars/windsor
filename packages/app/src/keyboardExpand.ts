/**
 * The expanded keyboard view (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decisions 7 and 8): Expand on the
 * Parts tab's keys row opens the audition keyboard wide, on the console's
 * expanded-view ground below the header (`expandedViewFrame.ts`), so the
 * transport, undo and the part chips stay live above it. Its bar picks how
 * many octaves the keys show and in how many rows; the keys fit the view
 * with no sideways scrolling, and a pick the room does not allow is drawn as
 * the nearest one it does (`keyboardViewModel.ts`). Fold follows Rows
 * (windsor#919); folded, a row's slots stand in for its white keys, and the
 * pick is drawn again whenever the fold's tone count changes.
 *
 * The keyboard is the console's one `Keyboard`: its keys move into the view
 * while it is open and back into the Parts row when it closes, with their
 * held notes, Hold and the octave. Esc while the view is on screen, or
 * Close, closes it; so does another expanded view opening. A part chip moves
 * the keyboard to that part, and the title follows.
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el, html } from './dom';
import { type ExpandedFrame, mountExpandedView } from './expandedViewFrame';
import type { Keyboard } from './keyboard';
import { EXPAND_ICON_PATH, VIEW_LABELS, VIEW_OCTAVES, VIEW_ROWS } from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';
import { foldControl } from './keyboardFoldControl';
import type { KeysSurface } from './keyboardKeys';
import type { RowSlots } from './keyboardLayout';
import { normalizePick, octavesWhyNot, rowsFor, whyNot } from './keyboardViewModel';
import { readViewPick, writeViewPick } from './keyboardViewPrefs';

/** What the view needs of the console. */
export interface KeyboardViewHost {
  readonly ctx: Pick<AppCtx, 'onTabShown' | 'parts' | 'model'>;
  readonly keyboard: Keyboard;
}

/** The open view's close, or null: one keyboard, one view. */
let OPEN: (() => void) | null = null;
/** The user's pick, read from storage on the first open; kept here when storage refuses it. */
let picked: KeysPick | null = null;

/** One of Octaves' or Rows' segmented options. */
interface Segment {
  readonly box: HTMLElement;
  readonly buttons: readonly HTMLButtonElement[];
}

function segment(values: readonly number[], onTap: (value: number) => void): Segment {
  const box = el('div', 'seg kb-seg');
  const buttons = values.map((value) => {
    const button = el('button', '', String(value)) as HTMLButtonElement;
    button.type = 'button';
    button.onclick = (): void => onTap(value);
    return button;
  });
  box.append(...buttons);
  return { box, buttons };
}

/** An option pressed or not, and dimmed with its reason (still tappable) or not. */
function mark(button: HTMLButtonElement, pressed: boolean, why: string): void {
  button.setAttribute('aria-pressed', String(pressed));
  if (why) {
    button.setAttribute('aria-disabled', 'true');
    button.title = why;
  } else {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
  }
}

function labelled(label: string, options: Segment): HTMLElement {
  const group = el('span', 'kb-pick');
  group.append(el('span', 'kb-pick-label', label), options.box);
  return group;
}

function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, label) as HTMLButtonElement;
  b.type = 'button';
  b.onclick = onClick;
  return b;
}

/** The Parts row's Expand: the Roll rail's expand icon and the word (record decision 9). */
export function keysExpandButton(host: KeyboardViewHost): HTMLButtonElement {
  const svg = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${EXPAND_ICON_PATH}"/></svg>`;
  const expand = html('button', 'btn kb-expand', svg) as HTMLButtonElement;
  expand.append(VIEW_LABELS.expand);
  expand.type = 'button';
  expand.title = VIEW_LABELS.expandTitle;
  expand.onclick = (): void => openKeyboardView(host, expand);
  return expand;
}

/** Open the keyboard wide below the header; `from` is on the Parts tab, which the view belongs to. */
// eslint-disable-next-line max-lines-per-function -- composition: the view's bar, its keys box, its picks and its open and close, in one place
export function openKeyboardView(host: KeyboardViewHost, from: HTMLElement): void {
  if (OPEN) return;
  const { ctx, keyboard } = host;
  let stored = (picked ??= readViewPick());
  let hint = '';
  const keys = el('div', 'kb-keys');
  const room = (): number => keys.clientWidth;
  const drawn = (slots: RowSlots = keyboard.rowSlots()): KeysPick =>
    normalizePick(room(), stored, slots);

  const choose = (why: string, next: KeysPick): void => {
    hint = why;
    if (!why) {
      stored = picked = next;
      writeViewPick(next);
      keyboard.relayout();
    }
    sync();
  };
  const octaves = segment(VIEW_OCTAVES, (count) => {
    const pick = { octaves: count, rows: drawn().rows };
    const slots = keyboard.rowSlots();
    choose(octavesWhyNot(room(), pick, slots), {
      octaves: count,
      rows: rowsFor(room(), pick, slots) ?? pick.rows,
    });
  });
  const rows = segment(VIEW_ROWS, (count) => {
    const next = { octaves: drawn().octaves, rows: count };
    choose(whyNot(room(), next, keyboard.rowSlots()), next);
  });
  const hintEl = el('span', 'roll-overlay-note kb-hint');
  hintEl.setAttribute('aria-live', 'polite');
  const title = el('span', 'roll-overlay-title kb-title');
  const retitle = (): void => {
    const name = partAt(ctx.model.doc, ctx.parts.selected)?.name ?? '';
    title.textContent = `${name} — ${VIEW_LABELS.title}`;
  };
  /** The bar for the room now: the drawn pick pressed, what the room does not allow dimmed. */
  function sync(): void {
    hintEl.textContent = hint;
    const width = room();
    if (width === 0) return; // On another tab.
    const slots = keyboard.rowSlots();
    const now = drawn(slots);
    octaves.buttons.forEach((b, i) => {
      const count = VIEW_OCTAVES[i] ?? now.octaves;
      mark(
        b,
        count === now.octaves,
        octavesWhyNot(width, { octaves: count, rows: now.rows }, slots),
      );
    });
    rows.buttons.forEach((b, i) => {
      const count = VIEW_ROWS[i] ?? now.rows;
      mark(b, count === now.rows, whyNot(width, { octaves: now.octaves, rows: count }, slots));
    });
  }

  const label = el('span', 'status kb-oct', '');
  label.dataset.octLabel = '';
  const hold = button(VIEW_LABELS.hold, () => keyboard.toggleHold());
  hold.dataset.keysHold = '';
  const close = button(VIEW_LABELS.close, () => shut(), 'btn kb-close');
  close.title = VIEW_LABELS.closeTitle;
  const head = el('div', 'roll-overlay-head kb-head');
  head.append(
    title,
    button(VIEW_LABELS.octDown, () => keyboard.shiftOctave(-1)),
    label,
    button(VIEW_LABELS.octUp, () => keyboard.shiftOctave(1)),
    labelled(VIEW_LABELS.octaves, octaves),
    labelled(VIEW_LABELS.rows, rows),
    foldControl((fold) => keyboard.chooseFold(fold)),
    hintEl,
    hold,
    button(VIEW_LABELS.panic, () => keyboard.panic()),
    close,
  );
  const overlay = el('div', 'roll-overlay kb-view');
  overlay.append(head, keys);

  const surface: KeysSurface = {
    box: keys,
    nested: true,
    // The pick is normalized for the fold's slots at every build: a fold switch or a chord change.
    shape: (slots) => (room() === 0 ? null : drawn(slots)),
    built: () => sync(),
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && frame.shown()) {
      e.preventDefault();
      shut();
    }
  };
  const resizes = new ResizeObserver(sync);
  const stopFollowing = ctx.parts.onSelect(retitle);
  function shut(): void {
    if (OPEN !== shut) return;
    OPEN = null;
    document.removeEventListener('keydown', onKey);
    resizes.disconnect();
    stopFollowing();
    frame.remove();
    keyboard.collapse();
  }
  const frame: ExpandedFrame = mountExpandedView({ ctx, overlay, from, close: shut });
  OPEN = shut;
  retitle();
  keyboard.expand(surface);
  sync();
  resizes.observe(keys);
  document.addEventListener('keydown', onKey);
}
