/**
 * The life of a Roll card's popovers, tied to the card (windsor#707, PR
 * #715's fix round 2; the Shape tool joined it in windsor#708's fix round 2).
 * The envelope list sits on the page's body and the Shape popover is fixed
 * to the window, both with window listeners of their own, so the card's
 * teardown would not take them along: a Delete that removes the selected
 * region replaces the card, and a pick through the old card's editor would
 * land on the region that moved into its index; a Shape left open would
 * still take Escape and scrolls on another tab.
 *
 * So one of each kind is open at a time, held here with the card that owns
 * it, and closed:
 *
 * - by the Song pane whenever it redraws its card (`songDetailPane.ts`), as
 *   the patch bays close the sync menu (`operatorSyncPicker.ts`): all of
 *   them;
 * - by the card's playhead loop when the card leaves the page or its tab
 *   hides (`keepRollPopovers`), and by its Expand opening or closing: the
 *   card's own.
 *
 * A close drops the popover's callbacks and its listeners. A pick also asks
 * the card whether it is still the page's before it writes, and refuses
 * when it is not.
 */

/** What a list belongs to: whether its card is still on the page. */
export interface ListOwner {
  live(): boolean;
}

/** The popovers a Roll card opens, one of each at a time. */
export type RollPopover = 'list' | 'shape';

interface Held {
  readonly close: () => void;
  /** The card that opened it. */
  readonly owner: object;
}

const held = new Map<RollPopover, Held>();

/** Close the open popovers, every card's, or `owner`'s alone when given. */
export function closeRollPopovers(owner?: object): void {
  for (const [kind, open] of [...held]) {
    if (owner !== undefined && open.owner !== owner) continue;
    open.close();
    if (held.get(kind) === open) held.delete(kind);
  }
}

/** Hold `close` as `owner`'s open popover of `kind`, closing the one before it. */
export function holdRollPopover(kind: RollPopover, close: () => void, owner: object): void {
  const before = held.get(kind);
  if (before && before.close !== close) before.close();
  held.set(kind, { close, owner });
}

/** Forget `close` once its popover has closed; a later one's is kept. */
export function releaseRollPopover(kind: RollPopover, close: () => void): void {
  if (held.get(kind)?.close === close) held.delete(kind);
}

/** Keep `owner`'s popovers open only while `on`: its card on the page and shown. Returns `on`. */
export function keepRollPopovers(owner: object, on: boolean): boolean {
  if (!on) closeRollPopovers(owner);
  return on;
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
