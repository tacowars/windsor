/**
 * The envelope list's life, tied to its Roll card (windsor#707, PR #715's
 * fix round 2). The list sits on the page's body, outside the card, so the
 * card's teardown would not take it along: a Delete that removes the
 * selected region replaces the card, and a pick through the old card's
 * editor would land on the region that moved into its index.
 *
 * So one list is open at a time, held here, and the Song pane closes it
 * whenever it redraws its card (`songDetailPane.ts`), as the patch bays
 * close the sync menu (`operatorSyncPicker.ts`). A close drops the list's
 * callbacks. A pick also asks the card whether it is still the page's
 * before it writes, and refuses when it is not.
 */

/** What a list belongs to: whether its card is still on the page. */
export interface ListOwner {
  live(): boolean;
}

/** The open list's close, so a second opening or a redraw replaces it. */
let closeOpen: (() => void) | null = null;

/** Close the open envelope list, if any, dropping its callbacks. */
export function closeEnvelopeList(): void {
  closeOpen?.();
}

/** Hold `close` as the one open list's, closing the one before it. */
export function holdEnvelopeList(close: () => void): void {
  if (closeOpen !== close) closeEnvelopeList();
  closeOpen = close;
}

/** Forget `close` once its list has closed; a later list's is kept. */
export function releaseEnvelopeList(close: () => void): void {
  if (closeOpen === close) closeOpen = null;
}

/**
 * A pick that closes the list, then writes through `write` only when the
 * owner's card is still live. Returns whether it wrote.
 */
export function ownedPick(
  owner: ListOwner,
  close: () => void,
  write: (path: string) => void,
): (path: string) => boolean {
  return (path) => {
    close();
    if (!owner.live()) return false;
    write(path);
    return true;
  };
}
