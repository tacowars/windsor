/**
 * The toast stack without the DOM: what is showing, in order, oldest first.
 * A message that is already showing with the same tone is not stacked twice:
 * it moves to the newest place and counts the repeat, so a control dragged
 * past its limit reads "…  ×3" instead of filling the stack. Past the cap,
 * the oldest goes. `toast.ts` draws this and runs the timers.
 */
import { MAX_TOASTS, TOAST_DURATION_MS } from './toastConstants';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** How many times this message arrived while showing; 1 for a fresh toast. */
  count: number;
}

export interface ToastStack {
  toasts: readonly Toast[];
  nextId: number;
}

export const emptyStack = (): ToastStack => ({ toasts: [], nextId: 1 });

export interface Added {
  stack: ToastStack;
  /** The toast now showing the message (fresh, or the repeat it joined). */
  toast: Toast;
  /** Toasts pushed off the stack by the cap, for their timers to be cleared. */
  dropped: Toast[];
}

/** Add a message: join an identical one showing, else stack it, then trim to `max`. */
export function addToast(
  stack: ToastStack,
  message: string,
  tone: ToastTone,
  max: number = MAX_TOASTS,
): Added {
  const same = stack.toasts.find((toast) => toast.message === message && toast.tone === tone);
  const toast: Toast = same
    ? { ...same, count: same.count + 1 }
    : { id: stack.nextId, message, tone, count: 1 };
  const rest = stack.toasts.filter((other) => other.id !== toast.id);
  const all = [...rest, toast];
  const cut = Math.max(0, all.length - max);
  return {
    stack: { toasts: all.slice(cut), nextId: same ? stack.nextId : stack.nextId + 1 },
    toast,
    dropped: all.slice(0, cut),
  };
}

export function removeToast(stack: ToastStack, id: number): ToastStack {
  return { ...stack, toasts: stack.toasts.filter((toast) => toast.id !== id) };
}

/** How long a toast of this tone stays up; null until dismissed. */
export const toastDuration = (
  tone: ToastTone,
  table: Readonly<Record<ToastTone, number | null>> = TOAST_DURATION_MS,
): number | null => table[tone];
