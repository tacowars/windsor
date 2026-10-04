/**
 * The Roll's selection (windsor#603 decisions 1 and 4), kept for the
 * session outside any one device, per part slot and region: an undo or any
 * other render draws a new device, and the selection must still be there.
 *
 * A selection is the onset and pitch of each selected note, which the
 * normaliser keeps unique, so it survives a write's sort. It is also kept
 * against the very note list it was made on: an undo puts back the
 * document it left, the same objects, so the list from before an edit comes
 * back with the selection it had then (a moved note, moved back, still
 * selected). A key that matches no note any more is dropped when it is
 * read, and a place whose part or region has gone, or whose part is no
 * longer a roll, is forgotten (`forgetGone`).
 */
import type { ArrangementDocument, RollNote } from '@windsor/engine';
import { partAt } from '@windsor/engine';

/** Which roll: a part's slot and the region the device edits (none: the part's own). */
export interface RollPlace {
  readonly slot: number;
  readonly region: number | undefined;
}

type Keys = ReadonlySet<string>;

/** The selections: the last one by place, and the one each note list had, by place. */
export interface RollSelections {
  readonly places: Map<string, { readonly at: RollPlace; readonly keys: Keys }>;
  readonly lists: WeakMap<readonly RollNote[], Map<string, Keys>>;
}

/** A fresh store; the session keeps one. */
export const rollSelections = (): RollSelections => ({ places: new Map(), lists: new WeakMap() });

const SELECTIONS = rollSelections();

/** A note's key in a selection: its onset and pitch. */
export const noteKey = (note: RollNote): string => `${note.tick}:${note.pitch}`;

const placeKey = (at: RollPlace): string => `${at.slot}:${at.region ?? 'part'}`;

function keepKeys(
  at: RollPlace,
  notes: readonly RollNote[],
  keys: Keys,
  store: RollSelections,
): void {
  const place = placeKey(at);
  if (keys.size === 0) store.places.delete(place);
  else store.places.set(place, { at, keys });
  const byPlace = store.lists.get(notes) ?? new Map<string, Keys>();
  byPlace.set(place, keys);
  store.lists.set(notes, byPlace);
}

/**
 * The indices of the selected notes in `notes`, the roll at `at` as the
 * document has it now: the selection this list had, else the place's last,
 * its keys that match none of the notes dropped.
 */
export function selectedIn(
  at: RollPlace,
  notes: readonly RollNote[],
  store: RollSelections = SELECTIONS,
): number[] {
  const keys = store.lists.get(notes)?.get(placeKey(at)) ?? store.places.get(placeKey(at))?.keys;
  if (!keys) return [];
  const out: number[] = [];
  const live = new Set<string>();
  notes.forEach((note, i) => {
    const key = noteKey(note);
    if (!keys.has(key)) return;
    out.push(i);
    live.add(key);
  });
  if (store.places.get(placeKey(at))?.keys !== keys || live.size !== keys.size)
    keepKeys(at, notes, live, store);
  return out;
}

/** Select the notes at `indices` of `notes`, alone. */
export function keepSelected(
  at: RollPlace,
  notes: readonly RollNote[],
  indices: readonly number[],
  store: RollSelections = SELECTIONS,
): void {
  const keys = new Set(indices.flatMap((i) => (notes[i] ? [noteKey(notes[i])] : [])));
  keepKeys(at, notes, keys, store);
}

/** Forget the selections whose part or region `doc` no longer has, or whose part is not a roll. */
export function forgetGone(doc: ArrangementDocument, store: RollSelections = SELECTIONS): void {
  for (const [key, { at }] of store.places) {
    const part = partAt(doc, at.slot);
    const gone =
      part?.sequencer.kind !== 'roll' ||
      (at.region !== undefined && at.region >= part.regions.length);
    if (gone) store.places.delete(key);
  }
}
