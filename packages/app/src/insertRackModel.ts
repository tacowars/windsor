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
 * Those shifts follow the rack's own edits. A document that changes some
 * other way (an undo or redo of a move, add or remove, an import, an edit on
 * another tab) would leave the state on the wrong insert, so each chain also
 * records the kinds it last saw (`RackSeen`). A render whose chain holds
 * other kinds resets that chain to page 1 and open (`syncChain`), as
 * decision 4 allows; a knob edit or its undo keeps the kinds, and the state.
 *
 * Pure: every function returns a new state and leaves its argument alone.
 */

/**
 * One insert's view as the state keeps it: the page shown, by its tab's
 * name ('' for the first page), and the fold. A page is kept by name so a
 * card whose pages change (Advanced Drive's stages follow its routing,
 * windsor#174 decision 3) stays on that page while it has it, and shows its
 * first page once it does not.
 */
export interface InsertView {
  readonly page: string;
  readonly folded: boolean;
}

/** One insert's view as the shell draws it: the index of the page shown, and the fold. */
export interface ShownView {
  readonly page: number;
  readonly folded: boolean;
}

/** A chain: a part's slot, `'master'`, or any other name a chain takes. */
export type RackChain = number | string;

/** Every insert's view that differs from `STORED_OPEN`, by `rackKey`. */
export type RackView = ReadonlyMap<string, InsertView>;

/** The first page, open, as the state keeps it: where every insert starts. */
const STORED_OPEN: InsertView = { page: '', folded: false };

/** The first page, open, as the shell draws it. */
export const OPEN_VIEW: ShownView = { page: 0, folded: false };

export const emptyRack = (): RackView => new Map();

/** The state's key for the insert at `index` of `chain`. */
export const rackKey = (chain: RackChain, index: number): string => `${chain}#${index}`;

/**
 * The view of the insert at `index`, whose card has the pages `pages` names
 * in tab order: the page kept, or the first page when the card no longer
 * has it.
 */
export function viewAt(
  state: RackView,
  chain: RackChain,
  index: number,
  pages: readonly string[],
): ShownView {
  const view = state.get(rackKey(chain, index)) ?? STORED_OPEN;
  return { page: Math.max(0, pages.indexOf(view.page)), folded: view.folded };
}

function withView(
  state: RackView,
  chain: RackChain,
  index: number,
  view: InsertView,
): Map<string, InsertView> {
  const next = new Map(state);
  const key = rackKey(chain, index);
  if (view.page === STORED_OPEN.page && view.folded === STORED_OPEN.folded) next.delete(key);
  else next.set(key, view);
  return next;
}

/** `state` with the insert at `index` showing the page at `at` of the pages `pages` names. */
export function showPage(
  state: RackView,
  chain: RackChain,
  index: number,
  pages: readonly string[],
  at: number,
): RackView {
  const view = state.get(rackKey(chain, index)) ?? STORED_OPEN;
  const page = at > 0 ? (pages[at] ?? '') : '';
  return withView(state, chain, index, { ...view, page });
}

/** `state` with the insert at `index` folded if it was open, or open if it was folded. */
export function toggleFold(state: RackView, chain: RackChain, index: number): RackView {
  const view = state.get(rackKey(chain, index)) ?? STORED_OPEN;
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
  const from = state.get(rackKey(chain, index)) ?? STORED_OPEN;
  const other = state.get(rackKey(chain, to)) ?? STORED_OPEN;
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
    next = withView(next, chain, at, state.get(rackKey(chain, at + 1)) ?? STORED_OPEN);
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
    next = withView(next, chain, at, state.get(rackKey(chain, at - 1)) ?? STORED_OPEN);
  }
  return withView(next, chain, index, STORED_OPEN);
}

/** The kinds each chain held when its view state last matched it, by chain. */
export type RackSeen = ReadonlyMap<string, string>;

export const emptySeen = (): RackSeen => new Map();

const kindsKey = (kinds: readonly string[]): string => kinds.join(',');

/** `seen` with `chain` recorded as holding `kinds`: after one of the rack's own edits. */
export function recordKinds(seen: RackSeen, chain: RackChain, kinds: readonly string[]): RackSeen {
  const next = new Map(seen);
  next.set(String(chain), kindsKey(kinds));
  return next;
}

/** `state` with every view of `chain` gone: its inserts all on page 1, open. */
export function resetChain(state: RackView, chain: RackChain): RackView {
  const prefix = rackKey(chain, 0).slice(0, -1);
  const next = new Map(state);
  for (const key of state.keys()) if (key.startsWith(prefix)) next.delete(key);
  return next;
}

/**
 * The state for a render of `chain` holding `kinds`. If the chain holds
 * other kinds than `seen` recorded, the document changed outside the rack's
 * own edits and the views may belong to other inserts: that chain resets.
 * Otherwise nothing changes, and the same objects come back.
 */
export function syncChain(
  rack: { readonly view: RackView; readonly seen: RackSeen },
  chain: RackChain,
  kinds: readonly string[],
): { readonly view: RackView; readonly seen: RackSeen } {
  if (rack.seen.get(String(chain)) === kindsKey(kinds)) return rack;
  return { view: resetChain(rack.view, chain), seen: recordKinds(rack.seen, chain, kinds) };
}
