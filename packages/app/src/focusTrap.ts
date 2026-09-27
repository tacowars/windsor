/**
 * Modal focus (#563), without the DOM: Tab wraps inside the dialog, and
 * closing hands focus back to whatever opened it — the patch controls — so
 * the QWERTY keys play straight away. The lesson from #511 was that a control
 * keeping focus after a pick costs a click before every audition; a modal
 * that left focus on `<body>` would cost the same.
 */

export interface Focusable {
  focus(): void;
}

/**
 * Where a Tab press inside the dialog should land when it would leave it:
 * from the last focusable forward to the first, from the first back to the
 * last. Null means the browser's own move stays inside and is left alone.
 */
export function tabWrapTarget<T extends Focusable>(
  focusables: readonly T[],
  active: T | null,
  shift: boolean,
): T | null {
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) return null;
  if (active === null || !focusables.includes(active)) return shift ? last : first;
  if (!shift && active === last) return first;
  if (shift && active === first) return last;
  return null;
}

/** Remembers the opener while a modal is up and returns focus to it on close. */
export class FocusReturn<T extends Focusable> {
  private opener: T | null = null;
  private readonly fallback: () => T | null;

  constructor(fallback: () => T | null) {
    this.fallback = fallback;
  }

  /** Called as the modal opens, with the element that had focus. */
  open(opener: T | null): void {
    this.opener = opener;
  }

  /** Called as the modal closes: focuses the opener, else the fallback; returns what it focused. */
  close(): T | null {
    const target = this.opener ?? this.fallback();
    this.opener = null;
    target?.focus();
    return target;
  }
}
