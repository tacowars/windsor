/**
 * Keyboard focus across a rebuild of the Euclid card's rows (windsor#383,
 * decision 2). An edit changes what the rows show, and the next frame
 * rebuilds them whole (`paintRows`), which detaches the focused control: a
 * second arrow press on a pitch cell, or a second Enter on a ratchet or a
 * lane's − +, would land nowhere. So the rows note where focus was before
 * the rebuild, as the row's key (`data-row`) and the child path inside it,
 * and focus the control at the same place after. A row that is gone, or a
 * path the new row no longer has, leaves focus where the rebuild put it.
 *
 * Pure over the slice of a DOM element it walks, so a test can drive it
 * with plain objects.
 */

/** The attribute naming a row: `ratchet`, `trigger`, `accent`, `pitch`, `sound:<param>`. */
export const ROW_KEY_ATTRIBUTE = 'data-row';

/** The slice of an element the address walks. */
export interface RowNode {
  readonly parentElement: RowNode | null;
  readonly children: ArrayLike<RowNode>;
  getAttribute(name: string): string | null;
}

/** Where focus was: the row's key and the child indices from that row down to the control. */
export interface FocusAddress {
  readonly row: string;
  readonly path: readonly number[];
}

const indexIn = (parent: RowNode, child: RowNode): number =>
  Array.prototype.indexOf.call(parent.children, child) as number;

/** The address of `focused` among `scope`'s rows; null when it is outside them or in an unkeyed row. */
export function focusAddress(scope: RowNode, focused: RowNode | null): FocusAddress | null {
  const path: number[] = [];
  let node = focused;
  while (node && node.parentElement !== scope) {
    const parent = node.parentElement;
    if (!parent) return null;
    path.unshift(indexIn(parent, node));
    node = parent;
  }
  const row = node?.getAttribute(ROW_KEY_ATTRIBUTE);
  return row ? { row, path } : null;
}

/** The node at `address` among `scope`'s rows, or null when the row or the path is gone. */
export function nodeAt(scope: RowNode, address: FocusAddress): RowNode | null {
  const rows = Array.from(scope.children);
  let node = rows.find((r) => r.getAttribute(ROW_KEY_ATTRIBUTE) === address.row) ?? null;
  for (const index of address.path) node = node?.children[index] ?? null;
  return node;
}
