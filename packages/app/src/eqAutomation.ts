/**
 * Which of a Parametric EQ's band fields a lane holds (windsor#397; record
 * `2026-10-01-song-automation-lanes` decision 6), the way `knobAutomation.ts`
 * answers it for any insert knob: a band's frequency, gain and Q, spelled
 * `bands.<i>.<field>` as #341 catalogues them. A lane on a field the EQ does
 * not read (an off band, a cut's gain, a 6 dB cut's Q) is inert and holds
 * nothing.
 *
 * The card reads three answers from it: the curve as it plays (each held
 * field at its lane's value, so a handle follows its lane), whether a press
 * on a handle may drag it (not while its frequency or gain is held), and
 * whether any other edit of the curve touches a held field. Pure over the
 * part and its insert, so a test needs no DOM.
 */
import type { DocumentPart, EqBand, EqSpec, InsertSpec } from '@windsor/engine';
import { automatableInsertFields } from '@windsor/engine';
import type { KnobAutomation } from './knobAutomation';
import { insertKnobAutomation } from './knobAutomation';

/** The band fields a lane can hold, in the band panel's order. */
export const EQ_LANE_FIELDS = ['freq', 'gain', 'q'] as const;
export type EqLaneField = (typeof EQ_LANE_FIELDS)[number];

/** What a drag on a handle moves: the band's frequency and gain. */
export const EQ_DRAG_FIELDS: readonly EqLaneField[] = ['freq', 'gain'];

/** Where an EQ's lanes are read: its part, the insert in the part's chain, and the song tick. */
export interface EqLanes {
  readonly part: DocumentPart | undefined;
  readonly insert: InsertSpec | undefined;
  /** The song tick (`knobSongTick`). */
  readonly tick: number;
}

/** Band `band`'s `field` as an insert field, `bands.3.freq`. */
export const eqBandField = (band: number, field: EqLaneField): string => `bands.${band}.${field}`;

/** The lock a lane puts on band `band`'s `field`, or null while none holds it. */
export const eqFieldLock = (at: EqLanes, band: number, field: EqLaneField): KnobAutomation | null =>
  insertKnobAutomation(at.part, at.insert, eqBandField(band, field), at.tick);

/** Whether any lane that is on targets this EQ's bands: the cheap test before the field-by-field one. */
function bandLanesOn(at: EqLanes): boolean {
  const id = at.insert?.id;
  if (!id) return false;
  const prefix = `insert.${id}.bands.`;
  return at.part?.automation?.some((lane) => lane.on && lane.target.startsWith(prefix)) ?? false;
}

/**
 * `spec` as the curve draws it at the playhead: each band field a lane holds
 * at the lane's value. `spec` itself while no lane holds one.
 */
export function eqShownSpec(at: EqLanes, spec: EqSpec): EqSpec {
  if (!bandLanesOn(at)) return spec;
  let bands: EqBand[] | null = null;
  spec.bands.forEach((band, i) => {
    for (const field of EQ_LANE_FIELDS) {
      const lock = eqFieldLock(at, i, field);
      if (!lock || lock.value === band[field]) continue;
      bands ??= [...spec.bands];
      bands[i] = { ...bands[i]!, [field]: lock.value };
    }
  });
  return bands ? { ...spec, bands } : spec;
}

/**
 * The name of the first of `fields` on band `band` a lane holds, as the
 * lane's row reads it ("Band 2 freq"), or null while none is held.
 */
export function eqHeldName(
  at: EqLanes,
  band: number,
  fields: readonly EqLaneField[] = EQ_LANE_FIELDS,
): string | null {
  if (!at.insert || !bandLanesOn(at)) return null;
  const field = fields.find((f) => eqFieldLock(at, band, f) !== null);
  if (!field) return null;
  const target = eqBandField(band, field);
  return automatableInsertFields(at.insert).find((row) => row.target === target)?.label ?? target;
}

/** The fields a lane can hold that differ between two states of one band. */
export const eqChangedFields = (before: EqBand, after: EqBand): EqLaneField[] =>
  EQ_LANE_FIELDS.filter((field) => before[field] !== after[field]);

/**
 * The name of the first held field the edit from `before` to `after`
 * changes, or null when the edit touches none: a wheel's Q, a key's nudge, a
 * double-click's reset are refused on a held field as a drag is.
 */
export function eqEditRefusal(at: EqLanes, before: EqSpec, after: EqSpec): string | null {
  if (!bandLanesOn(at)) return null;
  for (let i = 0; i < after.bands.length; i++) {
    const was = before.bands[i];
    const now = after.bands[i];
    if (!was || !now || was === now) continue;
    const held = eqHeldName(at, i, eqChangedFields(was, now));
    if (held) return held;
  }
  return null;
}

/** Whether two specs draw their lanes' fields alike: a frame redraws the curve only when not. */
export const sameLaneFields = (a: EqSpec, b: EqSpec): boolean =>
  a === b ||
  (a.bands.length === b.bands.length &&
    a.bands.every((band, i) => EQ_LANE_FIELDS.every((f) => band[f] === b.bands[i]![f])));
