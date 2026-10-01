/**
 * The Euclid card's press hold (windsor#356): a press held on the rows
 * defers their rebuild until it ends, wherever the pointer is let go. Each
 * press listens for its end on `scope` (the window) with one
 * `AbortController`, so whichever of `pointerup` and `pointercancel` comes
 * first removes both, and nothing outlives the press to hold the card.
 */

/** What the hold sets: the card's `pressing` flag. */
export interface Pressable {
  pressing: boolean;
}

/** Hold `card.pressing` from a press on `rows` until the pointer is let go anywhere in `scope`. */
export function holdWhilePressed(card: Pressable, rows: EventTarget, scope: EventTarget): void {
  rows.addEventListener('pointerdown', () => {
    card.pressing = true;
    const ended = new AbortController();
    const end = (): void => {
      card.pressing = false;
      ended.abort();
    };
    scope.addEventListener('pointerup', end, { signal: ended.signal });
    scope.addEventListener('pointercancel', end, { signal: ended.signal });
  });
}
