/**
 * What the Roll device reads of the document (windsor#602): the roll the
 * region plays, the region's place and length, the bar, the harmony and
 * the song's length, and a key that changes only when one of those does,
 * so the card's loop repaints when the document moved under it and not on
 * every edit elsewhere in the song.
 */
import type { ArrangementDocument, Harmony, RollNote } from '@windsor/engine';
import { partAt, songTicksOf, ticksPerBar } from '@windsor/engine';
import type { AppCtx } from './context';
import { patternOf } from './partEdits';
import { regionReadAt } from './regionPlayhead';
import type { RollClock } from './rollGuide';

/** The roll, its region and the song around it. */
export interface RollSource {
  readonly notes: readonly RollNote[];
  readonly loopTicks: number;
  /** The region's index in the part: the named one, else the first. */
  readonly regionIndex: number;
  readonly regionStart: number;
  /** The region's length, never past the song's; the loop's with no region. */
  readonly regionTicks: number;
  readonly barTicks: number;
  readonly harmony: Harmony;
  readonly songTicks: number;
  /** The objects read, compared by identity before the key is. */
  readonly inputs: readonly unknown[];
}

/** Region `region`'s roll on `slot` (the first region's with none named), from `doc`. */
export function readRollSource(
  doc: ArrangementDocument,
  slot: number,
  region: number | undefined,
): RollSource {
  const part = partAt(doc, slot);
  const pattern = patternOf(doc, slot, region);
  const spec = pattern?.kind === 'roll' ? pattern : null;
  const songTicks = songTicksOf(doc);
  const barTicks = ticksPerBar(doc.transport.meter);
  const regionIndex = region ?? 0;
  const target = part?.regions[regionIndex];
  const loopTicks = spec?.loopTicks ?? barTicks;
  const regionTicks = target
    ? Math.min(target.duration, songTicks > 0 ? songTicks : target.duration)
    : loopTicks;
  return {
    notes: spec?.notes ?? [],
    loopTicks,
    regionIndex,
    regionStart: target?.start ?? 0,
    regionTicks,
    barTicks,
    harmony: doc.harmony,
    songTicks,
    inputs: [spec, target, doc.harmony, doc.transport.meter, songTicks],
  };
}

/** Whether two reads saw the very same objects. */
export const sameInputs = (a: RollSource, b: RollSource): boolean =>
  a.inputs.length === b.inputs.length && a.inputs.every((value, i) => value === b.inputs[i]);

/** What a paint depends on, as one string. */
export const sourceKey = (source: RollSource): string => JSON.stringify(source.inputs);

/** The region's clock at the audible tick, with the engine's reading there, for the guide and the playhead. */
export function regionClock(ctx: AppCtx, slot: number, source: RollSource): RollClock {
  const { at, tick } = regionReadAt(ctx, slot, source.regionIndex);
  return {
    regions: partAt(ctx.model.doc, slot)?.regions ?? [],
    songTicks: source.songTicks,
    region: source.regionIndex,
    regionTicks: source.regionTicks,
    loopTicks: source.loopTicks,
    tick,
    at,
  };
}
