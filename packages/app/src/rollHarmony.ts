/**
 * How the Roll reads the harmony (windsor#602 decisions 5–7), without the
 * DOM: the tones a pitch is measured against at a song tick, and the tier
 * that gives it — the chord's root, another chord tone, a tone of the key's
 * scale, or outside the key. The harmony comes through `@windsor/engine` as
 * the Figure gets it: `chordAt` for the chord, its `stack` from the key
 * root, and `scaleOffsets` for the scale, read at each tick, so a change in
 * the harmony inside a region is read per onset as chords are.
 */
import type { Harmony, HarmonyChord } from '@windsor/engine';
import {
  CHORD_NOTE_NAMES,
  chordAt,
  chordName,
  eventBounds,
  eventChord,
  scaleOffsets,
} from '@windsor/engine';
import { pitchClassOf } from './rollRows';
import { ROLL_CUSTOM_SCALE_NAME, ROLL_SCALE_NAMES } from './rollTables';

/** How a pitch sits on a chord. */
export type RollTier = 'root' | 'chord' | 'scale' | 'out';

/** A note's colour: the root reads as a chord tone. */
export type NoteTier = Exclude<RollTier, 'root'>;

/** The pitch classes a pitch is measured against. */
export interface RollTones {
  /** The chord's root; null with no chord. */
  readonly rootPc: number | null;
  readonly chordPcs: ReadonlySet<number>;
  readonly scalePcs: ReadonlySet<number>;
}

/** The key's scale as pitch classes. */
export function scalePitchClasses(harmony: Harmony): ReadonlySet<number> {
  return new Set(scaleOffsets(harmony.scale).map((offset) => pitchClassOf(harmony.root + offset)));
}

/** The tones of `chord` in `harmony`'s key; with no chord, the scale alone. */
export function tonesOf(harmony: Harmony, chord: HarmonyChord | null): RollTones {
  const scalePcs = scalePitchClasses(harmony);
  if (!chord) return { rootPc: null, chordPcs: new Set(), scalePcs };
  const chordPcs = new Set(chord.stack.map((tone) => pitchClassOf(harmony.root + tone)));
  return { rootPc: pitchClassOf(harmony.root + chord.tonesRoot), chordPcs, scalePcs };
}

/** The chord and its tones at song tick `songTick`. */
export function tonesAt(
  harmony: Harmony,
  songTicks: number,
  songTick: number,
): { chord: HarmonyChord | null; tones: RollTones } {
  const chord = chordAt(harmony, songTicks, songTick);
  return { chord, tones: tonesOf(harmony, chord) };
}

/** Where `pitch` sits on `tones`. */
export function tierOf(pitch: number, tones: RollTones): RollTier {
  const pc = pitchClassOf(pitch);
  if (pc === tones.rootPc) return 'root';
  if (tones.chordPcs.has(pc)) return 'chord';
  if (tones.scalePcs.has(pc)) return 'scale';
  return 'out';
}

/** A note's colour on `tones`: amber on the root or a chord tone, teal on a scale tone, grey outside. */
export function noteTier(pitch: number, tones: RollTones): NoteTier {
  const tier = tierOf(pitch, tones);
  return tier === 'root' ? 'chord' : tier;
}

/** The chord's name as the harmony lane spells it (`A min`); empty with none. */
export function chordLabel(harmony: Harmony, chord: HarmonyChord | null): string {
  if (!chord) return '';
  return chordName(harmony.root, eventChord(scaleOffsets(harmony.scale), chord.event));
}

/** The key as the summary names it: `A minor`. */
export function keyName(harmony: Harmony): string {
  const root = CHORD_NOTE_NAMES[pitchClassOf(harmony.root)] ?? String(harmony.root);
  const scale =
    typeof harmony.scale === 'string' ? ROLL_SCALE_NAMES[harmony.scale] : ROLL_CUSTOM_SCALE_NAME;
  return `${root} ${scale}`;
}

/** One block of the chord strip, in the region's local ticks. */
export interface ChordSpan {
  readonly start: number;
  readonly end: number;
  /** The event's index in the harmony. */
  readonly index: number;
  readonly name: string;
}

/**
 * The chord strip over a region at song tick `regionStart`, `regionTicks`
 * long: each harmony block cut to the region and moved to its local ticks.
 * A region that runs past the song's end reads the timeline from bar 1, as
 * the transport does.
 */
export function chordSpans(
  harmony: Harmony,
  songTicks: number,
  regionStart: number,
  regionTicks: number,
): ChordSpan[] {
  const blocks = eventBounds(harmony, songTicks);
  const out: ChordSpan[] = [];
  if (blocks.length === 0 || !(songTicks > 0)) return out;
  const offset = Math.floor(regionStart / songTicks) * songTicks;
  for (let lap = offset; lap < regionStart + regionTicks; lap += songTicks) {
    for (const block of blocks) {
      const start = Math.max(block.start + lap, regionStart) - regionStart;
      const end = Math.min(block.end + lap, regionStart + regionTicks) - regionStart;
      if (end <= start) continue;
      const event = harmony.events[block.index];
      const chord = event ? eventChord(scaleOffsets(harmony.scale), event) : null;
      out.push({
        start,
        end,
        index: block.index,
        name: chord ? chordName(harmony.root, chord) : '',
      });
    }
  }
  return out;
}
