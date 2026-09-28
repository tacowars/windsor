/** The toasts' tunables: how long each tone stays up, and how many show at once. */
import type { ToastTone } from './toastModel';

/**
 * Milliseconds a toast stays up, by tone; `null` stays until dismissed. An
 * error waits for the user, because it names something they have to act on.
 */
export const TOAST_DURATION_MS: Readonly<Record<ToastTone, number | null>> = {
  info: 4000,
  success: 4000,
  warning: 8000,
  error: null,
};

/** At most this many toasts show; a new one past it drops the oldest. */
export const MAX_TOASTS = 4;
