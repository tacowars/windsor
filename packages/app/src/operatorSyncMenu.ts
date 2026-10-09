/**
 * The operator Sync picker's words and choices (windsor#649, mockup
 * `docs/research/2026-10-09-operator-sync-mockup/mockup.html`, its
 * "Beside the wave picker" placement): the face on the wave line, its title,
 * and the menu it opens — Off, Note and each other operator, a letter that
 * would close a loop disabled with the path that would close it.
 *
 * Whether a choice closes a loop is the engine's one rule,
 * `normaliseOpSyncs` (windsor#646): the choice is a loop exactly when that
 * rule would turn the operator off. Pure over the four sync fields, so the
 * test needs no DOM; `operatorSyncPicker.ts` draws it.
 */
import type { OpSync } from '@windsor/engine';
import { OP_NAMES, OP_SYNC_VALUES, normaliseOpSyncs } from '@windsor/engine';

/** One row of the menu: what it writes, what it shows, and whether it can be chosen. */
export interface SyncMenuItem {
  readonly value: OpSync;
  /** The mark in the menu's first column: `–`, `♪` or the operator's letter. */
  readonly glyph: string;
  readonly label: string;
  /** What the choice does, or for a disabled letter, the loop it would close. */
  readonly hint: string;
  readonly disabled: boolean;
  readonly checked: boolean;
}

/** The operator masters among `OP_SYNC_VALUES`, in operator order: index `i` is operator `i`. */
const OP_MASTERS: readonly OpSync[] = OP_SYNC_VALUES.filter((v) => v !== 'off' && v !== 'note');

/** The operator index a master names, or -1 for `'off'` and `'note'`. */
export const masterIndex = (sync: OpSync): number => OP_MASTERS.indexOf(sync);

const opName = (i: number): string => OP_NAMES[i] ?? '?';

/** What the face reads: `Sync` while off, `♪` for the note, else the master's letter. */
export function syncFaceText(sync: OpSync): string {
  if (sync === 'off') return 'Sync';
  return sync === 'note' ? '♪' : sync;
}

/** The face's title: `Sync: off`, or what restarts operator `i`. */
export function syncFaceTitle(syncs: readonly OpSync[], i: number): string {
  const sync = syncs[i] ?? 'off';
  if (sync === 'off') return 'Sync: off';
  const master = sync === 'note' ? 'the note' : sync;
  return `Sync: ${opName(i)} restarts on every cycle of ${master}`;
}

/** The menu's heading. */
export const syncMenuHeading = (i: number): string => `${opName(i)} syncs to`;

/** Whether syncing operator `i` to `master` closes a loop: the engine's rule would turn it off. */
export function closesLoop(syncs: readonly OpSync[], i: number, master: OpSync): boolean {
  const next = syncs.map((v, at) => (at === i ? master : v));
  return normaliseOpSyncs(next)[i] === 'off' && master !== 'off';
}

/**
 * The chain of letters from `master` through the masters it follows until it
 * reaches operator `i` (`C → B → A`), the path the hint names. Bounded by the
 * operator count, so a malformed list can't spin.
 */
export function loopPath(syncs: readonly OpSync[], i: number, master: OpSync): string {
  const chain: string[] = [];
  let at = masterIndex(master);
  for (let step = 0; at >= 0 && step < syncs.length; step++) {
    chain.push(opName(at));
    if (at === i) break;
    at = masterIndex(syncs[at] ?? 'off');
  }
  return chain.join(' → ');
}

/** The hint under a letter that would close a loop. */
const loopHint = (syncs: readonly OpSync[], i: number, master: OpSync): string =>
  `${loopPath(syncs, i, master)} already, so ${opName(i)} → ${master} would close a loop`;

/** Operator `i`'s menu: Off, Note, then every other operator in order, never `i` itself. */
export function syncMenuItems(syncs: readonly OpSync[], i: number): SyncMenuItem[] {
  const current = syncs[i] ?? 'off';
  const item = (value: OpSync, glyph: string, label: string, hint: string): SyncMenuItem => ({
    value,
    glyph,
    label,
    hint,
    disabled: false,
    checked: current === value,
  });
  const items = [
    item('off', '–', 'Off', 'Runs free, as today'),
    item('note', '♪', 'Note', "Restarts on every cycle of the note's pitch"),
  ];
  OP_MASTERS.forEach((master, m) => {
    if (m === i) return;
    const loop = closesLoop(syncs, i, master);
    const hint = loop ? loopHint(syncs, i, master) : `Restarts on every cycle of ${master}`;
    items.push({ ...item(master, master, `Operator ${master}`, hint), disabled: loop });
  });
  return items;
}
