/**
 * A part's voice slots, the one count both automation pickers read (epic
 * windsor#699 decision 6; windsor#707's fix round): the distinct voice
 * targets across the part's song voice lanes and the clip envelopes of
 * every roll pattern it holds, `part.sequencer` and each region's
 * `pattern`. The union stands whichever region plays, so a part kept
 * within `FM_LANES_MAX` here never asks the voice for a ninth slot.
 *
 * The Song tab's "+ Add lane" picker (`songAutomationModel.ts`) and the
 * Roll's envelope picker (`rollEnvelopePicker.ts`) both refuse a new
 * distinct target once the count is full, and both keep a target already
 * in the set open, since it holds its slot already.
 */
import type { DocumentPart, PartRegion, SequencerSpec } from '@windsor/engine';
import { targetKind, voicePathOf } from '@windsor/engine';

/** What the count reads off a part. */
export type VoiceSlotPart = Pick<DocumentPart, 'automation' | 'sequencer' | 'regions'>;

/** The voice targets `part`'s song lanes name, as paths. */
export function laneVoicePaths(part: Pick<DocumentPart, 'automation'>): Set<string> {
  const paths = (part.automation ?? []).flatMap((lane) =>
    targetKind(lane.target) === 'voice' ? [voicePathOf(lane.target) ?? ''] : [],
  );
  return new Set(paths.filter((path) => path !== ''));
}

/** The targets of a roll pattern's envelopes; none for another kind. */
const envelopeTargets = (spec: SequencerSpec | PartRegion['pattern']): string[] =>
  spec?.kind === 'roll' ? (spec.envelopes ?? []).map((envelope) => envelope.target) : [];

/** The distinct voice targets `part` holds: its song voice lanes and every roll pattern's envelopes. */
export function voiceSlotTargets(part: VoiceSlotPart): Set<string> {
  const held = laneVoicePaths(part);
  const specs = [part.sequencer, ...part.regions.map((region) => region.pattern)];
  for (const spec of specs) for (const target of envelopeTargets(spec)) held.add(target);
  return held;
}

/** How many of the voice's `FM_LANES_MAX` slots `part` holds. */
export const voiceSlotsUsed = (part: VoiceSlotPart): number => voiceSlotTargets(part).size;
