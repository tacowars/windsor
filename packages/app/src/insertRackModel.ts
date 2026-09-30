/**
 * The insert rack's view state (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decision 3): which page each
 * insert shows and whether it is folded to its rail. It is session-only and
 * never in the song.
 *
 * It is keyed by the chain (a part's slot, the master, a send bus) and the
 * insert's own id (windsor#186), never by its position. The id is in the
 * song, so a move, an add or a remove needs no shifting here, and an undo,
 * a redo or an import that carries an insert somewhere else carries its
 * fold and page with it. An insert that is gone takes its state with it: no
 * other insert can show it, and an undo that brings the insert back brings
 * its fold and page back too. A render keeps the state, so a knob edit
 * elsewhere leaves a folded insert folded and a page on screen.
 *
 * Pure: every function returns a new state and leaves its argument alone.
 */
import type { InsertSpec } from '@windsor/engine';
import { withInsertIds } from '@windsor/engine';

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

/** The state's key for the insert whose id is `id` in `chain`. */
export const rackKey = (chain: RackChain, id: string): string => `${chain}#${id}`;

/**
 * The id of the insert at `index` of `list`: its own, or, for a chain the
 * code holds rather than the song (a send bus's default chain), the one
 * normalising will give it, so its state stays put once the chain is saved.
 */
export const insertIdAt = (list: readonly InsertSpec[], index: number): string =>
  list[index]?.id ?? withInsertIds(list)[index]?.id ?? '';

/**
 * The view of the insert `id`, whose card has the pages `pages` names in
 * tab order: the page kept, or the first page when the card no longer has it.
 */
export function viewAt(
  state: RackView,
  chain: RackChain,
  id: string,
  pages: readonly string[],
): ShownView {
  const view = state.get(rackKey(chain, id)) ?? STORED_OPEN;
  return { page: Math.max(0, pages.indexOf(view.page)), folded: view.folded };
}

function withView(state: RackView, key: string, view: InsertView): RackView {
  const next = new Map(state);
  if (view.page === STORED_OPEN.page && view.folded === STORED_OPEN.folded) next.delete(key);
  else next.set(key, view);
  return next;
}

/** `state` with the insert `id` showing the page at `at` of the pages `pages` names. */
export function showPage(
  state: RackView,
  chain: RackChain,
  id: string,
  pages: readonly string[],
  at: number,
): RackView {
  const key = rackKey(chain, id);
  const view = state.get(key) ?? STORED_OPEN;
  return withView(state, key, { ...view, page: at > 0 ? (pages[at] ?? '') : '' });
}

/** `state` with the insert `id` folded if it was open, or open if it was folded. */
export function toggleFold(state: RackView, chain: RackChain, id: string): RackView {
  const key = rackKey(chain, id);
  const view = state.get(key) ?? STORED_OPEN;
  return withView(state, key, { ...view, folded: !view.folded });
}
