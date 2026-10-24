/**
 * Bounce to Roll's test rig (windsor#740): a one-part song to render, the
 * render itself, and the same region played by `ArrangementPlayer` from its
 * start, so a test can hold the two side by side.
 */
import type { AutomationLane } from '../automation/automationLane';
import type {
  Arrangement,
  GridSpec,
  MusicPart,
  PartRegion,
  SequencerSpec,
  Transport,
} from '../song/arrangement';
import type { Harmony } from '../harmony/harmonyTimeline';
import { ArrangementPlayer } from '../song/arrangementPlayer';
import { renderBounceRegion } from '../song/bounceRender';
import type { BounceRegion } from '../song/bounceRenderTypes';
import { PRESETS } from '../patch/presets';
import { gridNote, type GridStep } from '../sequencing/gridSequencer';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { STEP_VARIATION_DEFAULTS } from '../sequencing/stepVariationConstants';
import { recordingPart, type Call } from './recordingPart';

/** The slot the rig's part plays on. */
export const BOUNCE_SLOT = 0;
/** The rig's song: eight bars, so a four-bar region is a drawn one, not ∞. */
export const BOUNCE_BARS = 8;
export const FOUR_BARS: PartRegion = { start: 0, duration: 4 * TICKS_PER_BAR };
/** A natural minor over one chord, the acid audition's key. */
export const A_MINOR: Harmony = {
  root: 9,
  scale: 'naturalMinor',
  events: [{ start: 0, duration: BOUNCE_BARS * TICKS_PER_BAR, degree: 0, size: 3 }],
};

export interface BounceSong {
  readonly regions?: readonly PartRegion[];
  readonly transport?: Partial<Transport>;
  readonly harmony?: Harmony;
  readonly velocity?: number;
  readonly preset?: string;
  readonly automation?: readonly AutomationLane[];
  /** Other parts beside the bounced one (a canon's leader). */
  readonly others?: readonly MusicPart[];
}

/** A song of one part on `BOUNCE_SLOT` playing `sequencer`, at 120 bpm in A minor. */
export function bounceSong(sequencer: SequencerSpec, over: BounceSong = {}): Arrangement {
  const part = {
    slot: BOUNCE_SLOT,
    name: 'bounce',
    preset: over.preset ?? 'saw-arp',
    velocity: over.velocity ?? 0.8,
    regions: over.regions ?? [FOUR_BARS],
    sequencer,
    ...(over.automation ? { automation: over.automation } : {}),
  };
  return {
    transport: { bpm: 120, bars: BOUNCE_BARS, ...over.transport },
    harmony: over.harmony ?? A_MINOR,
    parts: [part, ...(over.others ?? [])],
  };
}

/** A Grid line at `divisor`, nothing varied, accents of 0.2 with mod 1, at register octave 1. */
export function gridSpec(steps: readonly GridStep[], over: Partial<GridSpec> = {}): GridSpec {
  return {
    kind: 'grid',
    divisor: DIVISORS.sixteenth,
    steps,
    length: steps.length,
    ...STEP_VARIATION_DEFAULTS,
    accentVelocity: 0.2,
    accentMod: 1,
    register: { octave: 1 },
    seed: 0,
    lanes: [],
    ...over,
  };
}

export const REST: GridStep = { kind: 'rest' };
export const TIE: GridStep = { kind: 'tie' };
export { gridNote };

/** Region `index` of the rig's part, rendered. */
export const render = (arrangement: Arrangement, index = 0): BounceRegion =>
  renderBounceRegion(arrangement, PRESETS, BOUNCE_SLOT, index);

export interface PlayedRegion {
  /** The part's calls in the region, and only the releases of the tick on its end. */
  readonly calls: readonly Call[];
  readonly transport: TickTransport;
}

/** Region `index` of the part on `slot`, played by `ArrangementPlayer` from the region's start. */
export function playRegion(arrangement: Arrangement, index = 0, slot = BOUNCE_SLOT): PlayedRegion {
  const transport = new TickTransport();
  const part = recordingPart();
  const player = new ArrangementPlayer(transport, new Map([[slot, part]]), arrangement, PRESETS);
  const region = arrangement.parts.find((p) => p.slot === slot)!.regions[index]!;
  transport.reset(region.start);
  const end = region.start + region.duration;
  while (transport.currentTick < end) transport.advance(transport.transportSeconds);
  const inside = part.calls.length;
  transport.advance(transport.transportSeconds);
  const releases = part.calls.slice(inside).filter((call) => call.kind === 'noteOffByNote');
  player.dispose();
  return { calls: [...part.calls.slice(0, inside), ...releases], transport };
}

/** A rendered note as `[tick, end, pitch]`, for the record's tables. */
export const span = (note: { tick: number; ticks: number; pitch: number }): number[] => [
  note.tick,
  note.tick + note.ticks,
  note.pitch,
];
