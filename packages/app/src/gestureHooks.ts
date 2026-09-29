/**
 * The gesture hook (windsor#130 decision 1; epic windsor#112 decision 3):
 * how a control with no `ctx` in scope — a knob, a number box, the harmonic
 * editor — marks where one undo step starts and ends. The hook is a settable
 * `{ begin(label), end() }` pair, a no-op until `AppContext`'s constructor
 * points it at its own `beginGesture` / `endGesture`.
 *
 * Over it sit three brackets, each closing exactly once however many ways it
 * is told to:
 * - `withGesture`: a click that makes several edits (Choose preset, Copy to
 *   new), closed when the function returns or throws;
 * - `dragGesture`: a press held across moves (a knob drag, a paint), closed by
 *   the control's own release or, when the control never sees one (its
 *   element removed mid-drag, the window losing focus), by the window's
 *   `pointerup`, `pointercancel` or `blur` (decision 3);
 * - `mergedGesture`: presses a short time apart (arrow keys on a knob, tap
 *   tempo), closed by its timer, by `close()`, or by the first input anywhere
 *   that does not continue it (decision 4).
 *
 * A merge waiting on its timer is "lingering": any other bracket opening
 * closes it first, so the next edit is never folded into it, and
 * `settleGestures` closes it on demand.
 */
import { UNDO_MERGE_MS } from './undoConstants';

export interface GestureHook {
  begin(label: string): void;
  end(): void;
}

/** One open step. `close` is safe to call any number of times: only the first closes. */
export interface OpenGesture {
  readonly open: boolean;
  close(): void;
}

const NO_HOOK: GestureHook = { begin: () => {}, end: () => {} };
let hook: GestureHook = NO_HOOK;
const lingering = new Set<OpenGesture>();

/** Point the controls' gestures at a history (the context's constructor), or back at nothing. */
export function setGestureHook(next: GestureHook | null): void {
  hook = next ?? NO_HOOK;
}

/** Close every merge still waiting on its timer (before an undo, say). */
export function settleGestures(): void {
  for (const gesture of [...lingering]) gesture.close();
}

/** Open a step on the current hook; `onClose` runs once, before the hook's `end`. */
function bracket(label: string, onClose?: () => void): OpenGesture {
  settleGestures();
  // The hook that opened the step closes it, even if another was set meanwhile.
  const target = hook;
  target.begin(label);
  let open = true;
  return {
    get open() {
      return open;
    },
    close() {
      if (!open) return;
      open = false;
      onClose?.();
      target.end();
    },
  };
}

/** Run `edit` as one step named `label`: every change it makes, however many, undoes together. */
export function withGesture<T>(label: string, edit: () => T): T {
  const gesture = bracket(label);
  try {
    return edit();
  } finally {
    gesture.close();
  }
}

const RELEASES = ['pointerup', 'pointercancel', 'blur'] as const;

/**
 * Open a drag's step. The control closes it on its own release; the window's
 * release or blur closes it when the control never hears one. The window
 * listeners live exactly as long as the step.
 */
export function dragGesture(label: string, win: EventTarget = window): OpenGesture {
  const end = (): void => gesture.close();
  const gesture = bracket(label, () => {
    for (const type of RELEASES) win.removeEventListener(type, end);
  });
  for (const type of RELEASES) win.addEventListener(type, end);
  return gesture;
}

/** The keys that only modify another (Shift for a fine step): they never end a merge. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/** True for a `keydown` of a modifier key alone. */
export function isModifierKey(e: Event): boolean {
  return e.type === 'keydown' && MODIFIER_KEYS.has((e as KeyboardEvent).key);
}

export interface MergeOptions {
  label: string;
  /** Whether an input anywhere (a `pointerdown` or `keydown`, seen first) continues the step rather than ending it. */
  continues: (e: Event) => boolean;
  /** How long after the last press the step closes. */
  ms?: number;
  win?: EventTarget;
}

/** Presses merged into one step: `touch` on each, before its edit. */
export interface MergedGesture {
  /** A press: opens the step on the first, and holds it open `ms` longer. */
  touch(): void;
  /** End the step now (the control lost focus). */
  close(): void;
}

/**
 * Presses less than `ms` apart are one step. While it is open, a window
 * capture listener sees every press and key before any control does, so an
 * input that does not continue the merge (a click elsewhere, Cmd+Z) closes it
 * before its own edit, and a window blur closes it too.
 */
export function mergedGesture(options: MergeOptions): MergedGesture {
  const { label, continues, ms = UNDO_MERGE_MS, win = window } = options;
  let gesture: OpenGesture | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => gesture?.close();
  const input = (e: Event): void => {
    if (!continues(e)) close();
  };
  const open = (): OpenGesture => {
    const opened = bracket(label, () => {
      clearTimeout(timer);
      lingering.delete(opened);
      win.removeEventListener('pointerdown', input, true);
      win.removeEventListener('keydown', input, true);
      win.removeEventListener('blur', close);
    });
    lingering.add(opened);
    win.addEventListener('pointerdown', input, true);
    win.addEventListener('keydown', input, true);
    win.addEventListener('blur', close);
    return opened;
  };
  return {
    touch() {
      if (!gesture?.open) gesture = open();
      clearTimeout(timer);
      timer = setTimeout(close, ms);
    },
    close,
  };
}
