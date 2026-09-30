/**
 * The insert rack's view state (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decision 3): which page each
 * insert shows and whether it is folded to its rail. It is session-only and
 * never in the song, keyed by the chain (a part's slot, the master) and the
 * insert's position in it. A render keeps it, so a knob edit elsewhere or an
 * undo leaves a folded insert folded and a page on screen. A move swaps two
 * inserts' state with them, a remove shifts the later ones down, and an add
 * starts the new insert on page 1, open, shifting the ones after it up.
 *
 * Pure: every function returns a new state and leaves its argument alone.
 */

/** One insert's view: the page shown (0-based) and the fold. */
export interface InsertView {
  readonly page: number;
  readonly folded: boolean;
}

/** A chain: a part's slot, `'master'`, or any other name a chain takes. */
export type RackChain = number | string;

/** Every insert's view that differs from `OPEN_VIEW`, by `rackKey`. */
export type RackView = ReadonlyMap<string, InsertView>;

/** Page 1, open: where every insert starts. */
export const OPEN_VIEW: InsertView = { page: 0, folded: false };

export const emptyRack = (): RackView => new Map();

/** The state's key for the insert at `index` of `chain`. */
export const rackKey = (chain: RackChain, index: number): string => `${chain}#${index}`;

/** The view of the insert at `index`, its page kept inside the `pageCount` pages its card has. */
export function viewAt(
  state: RackView,
  chain: RackChain,
  index: number,
  pageCount: number,
): InsertView {
  const view = state.get(rackKey(chain, index)) ?? OPEN_VIEW;
  const last = Math.max(0, pageCount - 1);
  return view.page > last ? { ...view, page: last } : view;
}

function withView(
  state: RackView,
  chain: RackChain,
  index: number,
  view: InsertView,
): Map<string, InsertView> {
  const next = new Map(state);
  const key = rackKey(chain, index);
  if (view.page === OPEN_VIEW.page && view.folded === OPEN_VIEW.folded) next.delete(key);
  else next.set(key, view);
  return next;
}

/** `state` with the insert at `index` showing `page`. */
export function showPage(state: RackView, chain: RackChain, index: number, page: number): RackView {
  const view = state.get(rackKey(chain, index)) ?? OPEN_VIEW;
  return withView(state, chain, index, { ...view, page: Math.max(0, page) });
}

/** `state` with the insert at `index` folded if it was open, or open if it was folded. */
export function toggleFold(state: RackView, chain: RackChain, index: number): RackView {
  const view = state.get(rackKey(chain, index)) ?? OPEN_VIEW;
  return withView(state, chain, index, { ...view, folded: !view.folded });
}

/**
 * `state` after the insert at `index` swapped places with its neighbour
 * `delta` along (`insertEdits.ts`'s `moveInsert`): the two views swap with
 * them. A move off either end of a chain of `length` changes nothing.
 */
export function afterMove(
  state: RackView,
  chain: RackChain,
  move: { readonly index: number; readonly delta: number; readonly length: number },
): RackView {
  const { index, delta, length } = move;
  const to = index + delta;
  if (index < 0 || index >= length || to < 0 || to >= length) return state;
  const from = state.get(rackKey(chain, index)) ?? OPEN_VIEW;
  const other = state.get(rackKey(chain, to)) ?? OPEN_VIEW;
  return withView(withView(state, chain, index, other), chain, to, from);
}

/** `state` after the insert at `index` left a chain of `length`: the later views shift down one. */
export function afterRemove(
  state: RackView,
  chain: RackChain,
  index: number,
  length: number,
): RackView {
  let next: RackView = state;
  for (let at = index; at < length; at++) {
    next = withView(next, chain, at, state.get(rackKey(chain, at + 1)) ?? OPEN_VIEW);
  }
  return next;
}

/**
 * `state` after a new insert went in at `index` of a chain that held
 * `length`: the new one starts on page 1, open, and the views from `index`
 * on shift up one. The right Add slot adds at `length`, the left at 0.
 */
export function afterAdd(
  state: RackView,
  chain: RackChain,
  index: number,
  length: number,
): RackView {
  let next: RackView = state;
  for (let at = length; at > index; at--) {
    next = withView(next, chain, at, state.get(rackKey(chain, at - 1)) ?? OPEN_VIEW);
  }
  return withView(next, chain, index, OPEN_VIEW);
}
