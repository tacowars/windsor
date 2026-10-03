/**
 * Modal focus (#563), without the DOM: closing a modal hands focus back to
 * whatever opened it — the patch controls — so the QWERTY keys play straight
 * away. The lesson from #511 was that a control
 * keeping focus after a pick costs a click before every audition; a modal
 * that left focus on `<body>` would cost the same. Tab does nothing while a
 * modal is open (windsor#480, `tabKeys.ts`): it switches tabs everywhere else.
 */

export interface Focusable {
  focus(): void;
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
