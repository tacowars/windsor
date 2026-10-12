/**
 * Bounce to Roll (windsor#741, the second half of windsor#732; record
 * `2026-10-11-bounce-to-roll` decisions 2, 4, 5, 6 and 8): a generated
 * part rewritten in place as a Roll part holding the notes it played.
 *
 * Every region is rendered as it plays from its start
 * (`renderBounceRegion`), and its loop found (`shortestLoop`). An empty
 * region gets an empty roll as long as the region, as a newly drawn one
 * has, so its loop keeps following the region. A loop over `ROLL_NOTES_MAX`
 * notes or `ROLL_LOOP_TICKS_MAX` ticks refuses the whole bounce, naming the
 * region. The part's Vel rises to the highest level it played, and every
 * note is written at what it played divided by that Vel (at a Vel of 0,
 * at its event's own velocity), so every played level is kept. An accent
 * written as `accent` (windsor#755) counts at its level without the bump,
 * which its region's roll adds back (`accentVelocity`, `accentMod`, written
 * only where they differ from the defaults), so only a baked accent raises
 * the Vel; a ratchet is written as its note's `ratchet`. The part's
 * sequencer lanes (`seq.*`) are read by the render and removed; every other
 * lane stays. Regions keep their windows, a single ∞ region included.
 *
 * The result is one partial, applied in one step, which leaves the
 * normaliser nothing to trim; a Figure canon this part led loses its
 * source to the normaliser, as at any kind change of its leader. Pure.
 */
import { ACCENT_MOD_DEFAULT, ACCENT_VELOCITY_DEFAULT, ROLL_NOTES_MAX } from '../audioConstants';
import type { AutomationLane } from '../automation/automationLane';
import { targetKind } from '../automation/automationTargets';
import { ticksPerBar } from '../sequencing/meter';
import type { SeqField } from '../sequencing/regionGate';
import { defaultRollConfig, ROLL_LOOP_TICKS_MAX, type RollNote } from '../sequencing/rollSequencer';
import type { PartRegion, RollSpec } from './arrangement';
import type { ArrangementDocument, DocumentPart, DocumentPartial } from './arrangementDocument';
import { bounceCounts, renderBounceRegion } from './bounceRender';
import { BOUNCE_KINDS } from './bounceRenderTables';
import type { AccentAmounts, BounceNote } from './bounceRenderTypes';
import { shortestLoop, type BounceLoop } from './bounceToRollLoop';
import type { BounceFollower, BounceRefusal, BounceResult } from './bounceToRollTypes';
import { partAt } from './documentParts';

/** The loops of every region, or the first region's refusal, with the lanes the render read. */
type Rendered =
  | { readonly loops: readonly BounceLoop[]; readonly lanes: readonly SeqField[] }
  | { readonly refusal: BounceRefusal };

/** Region `region` (from 1)'s loop over a cap, or null. */
function capRefusal(loop: BounceLoop, region: number, barTicks: number): BounceRefusal | null {
  const { notes, loopTicks } = loop;
  if (notes.length > ROLL_NOTES_MAX) return { cap: 'notes', region, notes: notes.length };
  if (loopTicks > ROLL_LOOP_TICKS_MAX) {
    return { cap: 'loop', region, ticks: loopTicks, bars: Math.ceil(loopTicks / barTicks) };
  }
  return null;
}

/** Every region of the part rendered and looped, stopping at the first over a cap. */
function renderLoops(doc: ArrangementDocument, part: DocumentPart): Rendered {
  const barTicks = ticksPerBar(doc.transport.meter);
  const loops: BounceLoop[] = [];
  let lanes: readonly SeqField[] = [];
  for (const [index, { duration }] of part.regions.entries()) {
    const region = renderBounceRegion(doc, doc.patches ?? {}, part.slot, index);
    lanes = region.seqLanes;
    const loop =
      region.notes.length === 0
        ? {
            loopTicks: Math.min(duration, ROLL_LOOP_TICKS_MAX),
            notes: [],
            envelopes: [],
            accent: null,
          }
        : shortestLoop(region, duration, barTicks);
    const refusal = capRefusal(loop, index + 1, barTicks);
    if (refusal) return { refusal };
    loops.push(loop);
  }
  return { loops, lanes };
}

/**
 * A rendered note as the Roll holds it, at `vel`: the level it played ÷
 * the part's Vel, no key at 1, with its accent and ratchet.
 */
function written(note: BounceNote, vel: number): RollNote {
  const velocity = vel === 0 ? note.own : note.velocity / vel;
  const { tick, ticks, pitch, accent, ratchet } = note;
  return {
    tick,
    ticks,
    pitch,
    ...(velocity === 1 ? {} : { velocity }),
    ...(accent ? { accent } : {}),
    ...(ratchet ? { ratchet } : {}),
  };
}

/** The roll's accent amounts, each only where it is not the default, as the normaliser writes them. */
function accentAmounts(
  accent: AccentAmounts | null,
): Pick<RollSpec, 'accentVelocity' | 'accentMod'> {
  if (!accent) return {};
  const { velocity, mod } = accent;
  return {
    ...(velocity === ACCENT_VELOCITY_DEFAULT ? {} : { accentVelocity: velocity }),
    ...(mod === ACCENT_MOD_DEFAULT ? {} : { accentMod: mod }),
  };
}

/** Region `region`, its window kept, playing `loop` at `vel`. */
function rollRegion(region: PartRegion, loop: BounceLoop, vel: number): PartRegion {
  const { loopTicks, envelopes } = loop;
  const pattern: RollSpec = {
    kind: 'roll',
    loopTicks,
    notes: loop.notes.map((note) => written(note, vel)),
    ...accentAmounts(loop.accent),
    ...(envelopes.length > 0 ? { envelopes } : {}),
  };
  return { start: region.start, duration: region.duration, pattern };
}

/** The Figure parts whose canon, on their sequencer or a region's pattern, follows `slot`. */
function followersOf(doc: ArrangementDocument, slot: number): BounceFollower[] {
  const follows = (spec: object | undefined): boolean =>
    (spec as { source?: { slot: number } } | undefined)?.source?.slot === slot;
  return doc.parts
    .filter((part) => part.slot !== slot && part.sequencer.kind === 'figure')
    .filter((part) => follows(part.sequencer) || part.regions.some((r) => follows(r.pattern)))
    .map(({ slot: follower, name }) => ({ slot: follower, name }));
}

/** The part's lanes without its sequencer ones, or undefined when it has none to remove. */
function withoutSeqLanes(
  lanes: readonly AutomationLane[] | undefined,
): AutomationLane[] | undefined {
  if (!lanes?.some((lane) => targetKind(lane.target) === 'seq')) return undefined;
  return lanes.filter((lane) => targetKind(lane.target) !== 'seq');
}

/**
 * The part on `slot` bounced to Roll: the partial and its summary, or the
 * refusal that changes nothing. Throws for a slot the song lacks, a kind
 * that does not bounce (`roll`, `none`), or a song the player would refuse.
 */
export function bounceToRoll(doc: ArrangementDocument, slot: number): BounceResult {
  const part = partAt(doc, slot);
  if (!part) throw new RangeError(`no part on slot ${slot}`);
  if (!BOUNCE_KINDS.includes(part.sequencer.kind)) {
    throw new RangeError(`part ${slot}: a ${part.sequencer.kind} part does not bounce`);
  }
  const rendered = renderLoops(doc, part);
  if ('refusal' in rendered) return { ok: false, refusal: rendered.refusal };
  const { loops, lanes } = rendered;
  const notes = loops.flatMap((loop) => loop.notes);
  const velocity = notes.reduce((top, note) => Math.max(top, note.velocity), part.velocity);
  const regions = part.regions.map((region, i) => rollRegion(region, loops[i]!, velocity));
  const automation = withoutSeqLanes(part.automation);
  const sequencer: RollSpec = { kind: 'roll', ...defaultRollConfig(doc.transport.meter) };
  const partial: DocumentPartial = {
    parts: { [slot]: { velocity, regions, sequencer, ...(automation && { automation }) } },
  };
  const counts = bounceCounts(notes);
  return {
    ok: true,
    partial,
    summary: {
      notes: counts.notes,
      regions: regions.length,
      ticksRounded: counts.ticksRounded,
      ratchetHitsLost: counts.ratchetHitsLost,
      accentsLostMod: counts.accentsLostMod,
      repeatsTrimmed: counts.repeatsTrimmed,
      euclidTailsCut: counts.euclidTailsCut,
      silenced: notes.filter((note) => written(note, velocity).velocity === 0).length,
      lanesBaked: lanes,
      velocity,
      followers: followersOf(doc, slot),
    },
  };
}
