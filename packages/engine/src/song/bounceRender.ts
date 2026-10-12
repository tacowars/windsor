/**
 * Bounce to Roll's render (windsor#740, the first half of windsor#732;
 * record `2026-10-11-bounce-to-roll` decisions 3, 4 and 8): one region of
 * a generated part, rendered to Roll notes and clip envelopes exactly as
 * the region plays from its start, with every approximation marked on the
 * note it touched.
 *
 * The region is played offline through the player's own wiring
 * (`bounceRenderCapture.ts`), its notes are put on the tick grid by
 * decision 4's rules (`bounceRenderNotes.ts`), and its step offsets become
 * envelopes (`bounceRenderEnvelopes.ts`). Whether an onset cuts another
 * pitch is read from the part's patch as the player resolves it. Since
 * windsor#755 a ratchet one note plays exactly is written as that note
 * (`bounceRenderRatchets.ts`), and the region's accents as `accent` with
 * the amounts its roll plays (`bounceRenderAccents.ts`).
 *
 * Not here, and the bounce's: the loop search, the note and loop caps, the
 * Vel rescale across regions, removing the sequencer lanes, the canon's
 * leader, and the export through the engine's index. Pure, and internal to
 * `song/` for now.
 */
import type { Arrangement, MusicPart } from './arrangement';
import { partLabel, presetFor, validateArrangement, type PresetTable } from './arrangementValidate';
import { settleAccents } from './bounceRenderAccents';
import { captureRegion } from './bounceRenderCapture';
import { stepModEnvelopes } from './bounceRenderEnvelopes';
import { writeNotes } from './bounceRenderNotes';
import { BOUNCE_KINDS } from './bounceRenderTables';
import type { BounceCounts, BounceNote, BounceRegion } from './bounceRenderTypes';
import { partGateConfig } from './partGateConfig';
import type { SeqField } from '../sequencing/regionGate';

/**
 * Decision 8's counts over `notes`: a region's, or the notes a loop keeps of
 * it. A note carrying `accent` plays `bump` over its velocity (its region's
 * `accentVelocity`), so it counts at velocity 0 only where both are 0.
 */
export function bounceCounts(notes: readonly BounceNote[], bump = 0): BounceCounts {
  let ticksRounded = 0;
  let ratchetHitsLost = 0;
  let accentsLostMod = 0;
  let repeatsTrimmed = 0;
  let euclidTailsCut = 0;
  let zeroVelocity = 0;
  for (const { marks, velocity, accent } of notes) {
    ticksRounded += marks.rounded;
    ratchetHitsLost += marks.lost;
    accentsLostMod += Number(marks.accentMod);
    repeatsTrimmed += Number(marks.trimmed);
    euclidTailsCut += Number(marks.tailCut);
    zeroVelocity += Number(velocity + (accent ? bump : 0) === 0);
  }
  return {
    notes: notes.length,
    ticksRounded,
    ratchetHitsLost,
    accentsLostMod,
    repeatsTrimmed,
    euclidTailsCut,
    zeroVelocity,
  };
}

/** The sequencer lanes the part's gate reads: on, offered by its kind, with points. */
function seqLanesRead(arrangement: Arrangement, part: MusicPart): SeqField[] {
  const overrides = partGateConfig(arrangement, part).overridesAt?.(0) ?? {};
  return Object.keys(overrides) as SeqField[];
}

/**
 * Region `regionIndex` of the part on `slot`, rendered as it plays from
 * its start. Throws for a slot the song lacks, a kind that does not bounce,
 * an index naming no region, or a song the player would refuse.
 */
export function renderBounceRegion(
  arrangement: Arrangement,
  presets: PresetTable,
  slot: number,
  regionIndex: number,
): BounceRegion {
  validateArrangement(arrangement, presets);
  const part = arrangement.parts.find((candidate) => candidate.slot === slot);
  if (!part) throw new RangeError(`no part on slot ${slot}`);
  const where = partLabel(part);
  if (!BOUNCE_KINDS.includes(part.sequencer.kind)) {
    throw new RangeError(`${where}: a ${part.sequencer.kind} part does not bounce`);
  }
  const region = part.regions[regionIndex];
  if (!region) throw new RangeError(`${where}: no region ${regionIndex}`);
  const { mono } = presetFor(presets, where, part.preset);
  const { notes: played, clock, ratchetClock } = captureRegion(arrangement, slot, region);
  const written = writeNotes(played, {
    start: region.start,
    duration: region.duration,
    mono,
    clock,
    ratchetClock,
  });
  const { notes, accent } = settleAccents(written);
  const onsets = written.map(({ note, stepMod }) => ({ tick: note.tick, stepMod }));
  return {
    notes,
    accent,
    envelopes: stepModEnvelopes(onsets),
    counts: bounceCounts(notes, accent?.velocity),
    seqLanes: seqLanesRead(arrangement, part),
  };
}
