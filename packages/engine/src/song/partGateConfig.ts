/**
 * What one part's region gate reads (#705, windsor#488): its regions over
 * the song's length, the harmony and the meter, and the reader of the
 * sequencer lanes its kind offers. The player builds one per part at bind
 * and on every partial or lane edit. Pure.
 */
import type { AutomationLane } from '../automation/automationLane';
import { seqOverridesReader } from '../automation/automationSeqLanes';
import type { RegionGateConfig } from '../sequencing/regionGate';
import type { Arrangement, MusicPart } from './arrangement';
import { songTicksOf } from './songClock';

/** A part's lanes, where the arrangement carries them (a document's part does). */
const lanesOf = (part: MusicPart): readonly AutomationLane[] =>
  (part as { readonly automation?: readonly AutomationLane[] }).automation ?? [];

/** `part`'s gate config in `arrangement`, reading `lanes`, or the part's own when none are handed. */
export function partGateConfig(
  arrangement: Arrangement,
  part: MusicPart,
  lanes: readonly AutomationLane[] = lanesOf(part),
): RegionGateConfig {
  return {
    regions: part.regions,
    songTicks: songTicksOf(arrangement),
    harmony: arrangement.harmony,
    meter: arrangement.transport.meter,
    overridesAt: seqOverridesReader(lanes, part.sequencer.kind),
  };
}
