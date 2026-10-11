/**
 * Where a part's clip envelopes are at a transport tick (windsor#702, epic
 * windsor#699 decisions 1, 4 and 7): the roll a region plays, read through
 * `regionPattern`, and the region-local loop tick its envelopes are read at.
 *
 * The position is the one the roll's own performer plays from
 * (`rollSequencer.ts`): the region's local tick by `regionState`'s rule
 * (`regionClock.ts`: the song position folded by the song's length, the ∞
 * region free-running on the transport tick), then that tick mod the roll's
 * `loopTicks`. So a seek, a start mid-region, the transport loop's jump and
 * the song's wrap all land where the notes do, and a region entered again
 * starts at its own tick 0.
 *
 * An envelope plays while it is on and has a point inside its roll's loop
 * (`envelopeHeard`, the rule `envelopeValueAt` reads by); any other reads 0
 * throughout and takes no slot. A part none of whose regions plays such an envelope has no
 * source at all (`clipEnvelopeSource` is null), so the automation player
 * does nothing new for it (decision 8). `frameAt` fills a frame the caller
 * owns and allocates nothing. `clipEnvelopeSource.test.ts`.
 *
 * Whether an envelope that plays can change the sound also depends on the
 * part's patch, which the source does not read: `envelopeSounds` is the one
 * rule a track is admitted by (windsor#718), and `ClipEnvelopeTracks` runs
 * it again at every resync (a patch edit, a preset switch).
 */
import { isInfiniteRegion } from '../sequencing/regionClock';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { envelopeHeard } from '../sequencing/rollEnvelopeValue';
import type { RollSequencerConfig } from '../sequencing/rollSequencer';
import type { MusicPart } from '../song/arrangement';
import { regionPattern } from '../song/regionPattern';
import type { AutomationHandle, OffsetHandle } from './automationHandles';
import { isOffsetHandle } from './automationHandles';

/** What a part's region plays at one transport tick, as `frameAt` fills it. */
export interface ClipEnvelopeFrame {
  /** The roll's envelopes, every one: the caller skips those that do not play. */
  envelopes: readonly RollEnvelope[];
  /** The roll's loop. */
  loopTicks: number;
  /** The transport tick of this pass's entry into the region: which region pass it is. */
  entryTick: number;
  /** Ticks since that entry. */
  localTick: number;
  /** `localTick` mod `loopTicks`: where the envelopes are read. */
  loopTick: number;
}

/** A frame to fill, before its first fill. */
export const emptyClipEnvelopeFrame = (): ClipEnvelopeFrame => ({
  envelopes: [],
  loopTicks: 1,
  entryTick: 0,
  localTick: 0,
  loopTick: 0,
});

/** Whether `envelope` plays over a loop of `loopTicks`: on, with a point inside the loop. */
export const envelopePlays = (envelope: RollEnvelope, loopTicks: number): boolean =>
  envelopeHeard(envelope, loopTicks);

/**
 * Whether an offset through `handle`, the part's handle on an envelope's
 * target, can change the sound: there is a slot handle (no macro of the
 * patch maps the target, windsor#560), and the patch has a value there (a
 * macro past the patch's count has none, windsor#718).
 */
export const targetSounds = (handle: AutomationHandle | undefined): handle is OffsetHandle =>
  handle !== undefined && isOffsetHandle(handle) && handle.defined();

/**
 * Whether `envelope` can change the sound over a loop of `loopTicks`
 * through `handle` (windsor#718): it plays, and its target sounds. Only such
 * an envelope takes a voice slot.
 */
export const envelopeSounds = (
  envelope: RollEnvelope,
  loopTicks: number,
  handle: AutomationHandle | undefined,
): handle is OffsetHandle => envelopePlays(envelope, loopTicks) && targetSounds(handle);

/** The roll `pattern` plays when it carries an envelope that plays; null otherwise. */
function rollWithEnvelopes(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
): RollSequencerConfig | null {
  const spec = regionPattern(part, index);
  if (spec.kind !== 'roll') return null;
  return spec.envelopes?.some((envelope) => envelopePlays(envelope, spec.loopTicks)) ? spec : null;
}

/** A part's regions and the rolls they play, read at transport ticks. */
export class ClipEnvelopeSource {
  /** Per region, the roll it plays when that roll has envelopes; null otherwise. */
  private readonly rolls: readonly (RollSequencerConfig | null)[];
  private readonly infinite: boolean;

  constructor(
    private readonly part: Pick<MusicPart, 'regions' | 'sequencer'>,
    private readonly songTicks: number,
  ) {
    this.rolls = part.regions.map((_, i) => rollWithEnvelopes(part, i));
    this.infinite = isInfiniteRegion(part.regions, songTicks);
  }

  /** Whether any region plays an envelope. */
  get plays(): boolean {
    return this.rolls.some((roll) => roll !== null);
  }

  /**
   * Fill `out` with what the part plays at transport tick `tick`, as
   * `regionState` places it; false, leaving `out` as it was, outside the
   * regions or in one whose roll plays no envelope.
   */
  frameAt(tick: number, out: ClipEnvelopeFrame): boolean {
    const { regions } = this.part;
    const { songTicks } = this;
    if (!(songTicks > 0)) return false;
    if (this.infinite) return this.fill(out, 0, 0, tick);
    const songTick = ((tick % songTicks) + songTicks) % songTicks;
    for (let index = 0; index < regions.length; index++) {
      const region = regions[index]!;
      const localTick = songTick - region.start;
      if (localTick >= 0 && localTick < region.duration) {
        return this.fill(out, index, tick - localTick, localTick);
      }
    }
    return false;
  }

  private fill(out: ClipEnvelopeFrame, index: number, entryTick: number, local: number): boolean {
    const roll = this.rolls[index];
    if (!roll) return false;
    out.envelopes = roll.envelopes ?? [];
    out.loopTicks = roll.loopTicks;
    out.entryTick = entryTick;
    out.localTick = local;
    out.loopTick = local % roll.loopTicks;
    return true;
  }
}

/** The part's source, or null when none of its regions plays an envelope. */
export function clipEnvelopeSource(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  songTicks: number,
): ClipEnvelopeSource | null {
  const source = new ClipEnvelopeSource(part, songTicks);
  return source.plays ? source : null;
}
