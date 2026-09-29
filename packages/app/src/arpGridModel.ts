/**
 * The Arp card's step grid without the DOM (windsor#137, epic windsor#126):
 * how many cells the strip shows, what Randomize, Rotate and a cell's slide
 * do over them, and the labels a cell reads. The cell edits themselves are
 * `gridModel.ts`'s, which take an arp cell as they take a grid step.
 *
 * **The shown count** is one cycle of the arp's style over the note list
 * the engine would walk: `arpCycleLength(style, L)`, `L` being the length
 * of `arpNoteList` for the chord the card reads (the chord under the
 * playhead inside the region, else the region's first chord,
 * `chordRegionChord.ts`). The engine's own functions decide both, so the
 * strip is the cycle the arp plays. The cells past it stay in the document,
 * as the grid keeps steps past its length, and every edit here leaves them
 * alone.
 */
import type {
  ArpSpec,
  ArpStep,
  ArpStyle,
  Harmony,
  HarmonyChord,
  StepModLane,
} from '@windsor/engine';
import {
  ARP_STEPS_MAX,
  ScaleSampler,
  arpCellPitch,
  arpCycleLength,
  arpNote,
  arpNoteList,
} from '@windsor/engine';
import { ARP_RANDOM, type ArpRandomTable } from './arpGridConstants';
import { type Draw, cycleKind, rotateLanes, rotateSteps } from './gridModel';
import { NO_SLIDE, type StepSlide } from './stepModLaneModel';

/** What the shown count reads of the arp: the fields `arpNoteList` and the cycle rule take. */
export type ArpCycleFields = Pick<ArpSpec, 'style' | 'voicing' | 'octaves' | 'register'>;

/** The key a note list is voiced in. */
export type ArpKey = Pick<Harmony, 'root' | 'scale'>;

/** The note list the arp walks over `chord` (`arpNoteList`): empty with no chord. */
export function arpShownList(
  spec: ArpCycleFields,
  key: ArpKey,
  chord: HarmonyChord | null,
): number[] {
  return chord ? arpNoteList(new ScaleSampler(key), spec, chord) : [];
}

/**
 * The cells the strip shows over `list`: one cycle of the style (epic
 * decisions 2 and 3), at most `ARP_STEPS_MAX`; 0 over an empty list, when
 * the arp plays nothing.
 */
export function arpListCount(style: ArpStyle, list: readonly number[]): number {
  return Math.min(ARP_STEPS_MAX, arpCycleLength(style, list.length));
}

/** The cells the strip shows for `chord`: `arpListCount` over its note list; 0 with no chord. */
export function arpCellCount(
  spec: ArpCycleFields,
  key: ArpKey,
  chord: HarmonyChord | null,
): number {
  return arpListCount(spec.style, arpShownList(spec, key, chord));
}

/** The top cell's cycle: note → tie → rest → a plain note. */
export const nextArpKind = (step: ArpStep): ArpStep => cycleKind(step, arpNote);

/** What a cell's top reads: a note, a tie or a rest, as the grid's strip draws the last two. */
export function arpKindLabel(step: ArpStep): string {
  if (step.kind === 'rest') return '·';
  return step.kind === 'tie' ? '—' : '♪';
}

/** What a note cell's octave shows: `oct` unshifted, else the signed shift. */
export function arpOctaveLabel(octave: number): string {
  if (octave === 0) return 'oct';
  return octave > 0 ? `+${octave}` : `${octave}`;
}

/** The cells and lanes after Rotate: the first `count` turned `by` places, the rest where they were. */
export function rotateArp(
  spec: Pick<ArpSpec, 'steps' | 'lanes'>,
  by: number,
  count: number,
): { steps: ArpStep[]; lanes: StepModLane[] } {
  if (count < 1) return { steps: [...spec.steps], lanes: [...spec.lanes] };
  return { steps: rotateSteps(spec.steps, by, count), lanes: rotateLanes(spec.lanes, by, count) };
}

/**
 * One random cell (epic decision 8): a rest or a tie now and then, else a
 * note with accent and slide each at `flag` and an octave of ±`octaveSpan`
 * at `octave`, down at `octaveDown`. Five draws in that order, always, so
 * a test can script them.
 */
function randomCell(draw: Draw, table: ArpRandomTable): ArpStep {
  const kind = draw();
  const accent = draw() < table.flag;
  const slide = draw() < table.flag;
  const shifted = draw() < table.octave;
  const down = draw() < table.octaveDown;
  const octave = shifted ? (down ? -table.octaveSpan : table.octaveSpan) : 0;
  if (kind < table.rest) return { kind: 'rest' };
  if (kind < table.rest + table.tie) return { kind: 'tie' };
  return arpNote({ octave, accent, slide });
}

/**
 * Randomize: the first `count` cells rerolled, every cell past them kept
 * (epic decision 8). The lanes, the style, the octaves and the seed are
 * not the cells', so nothing here reaches them.
 */
export function randomArpCells(
  steps: readonly ArpStep[],
  count: number,
  draw: Draw,
  table: ArpRandomTable = ARP_RANDOM,
): ArpStep[] {
  const shown = Math.max(0, Math.min(Math.trunc(count), steps.length));
  return steps.map((step, i) => (i < shown ? randomCell(draw, table) : step));
}

/**
 * How cell `index`'s note meets the note before it, for the lanes' held
 * cells and readouts (windsor#31, `StepSlide`), read over one cycle of the
 * style over `list` (the shown chord's notes) the way `arpCellPlay.ts`
 * plays it. The note before it is the latest note cell, walking back over
 * ties; a rest before it holds nothing: `none`.
 *
 * `kind`: the engine sends a slide onto the pitch already held no note-on
 * at all, so it compares the two cells' pitches (`arpCellPitch`, the walk
 * with each cell's octave shift). An ordered style's pitches are known over
 * the shown chord: `retarget` when they differ, `same` when they meet, as
 * a two-octave list can make two cells land an octave apart and a shift
 * close the gap. A random style draws its pitch in the run, so a slide
 * there is `either`, which the lanes show as playing only if it moves.
 *
 * `when`: a slide whose held note comes from wrapping round the cycle
 * (cell 1 among them) is held only once the cycle wraps, as a region's
 * entry and a retrigger reset strike it plain: `wrap`. With Skip above 0
 * the note before it may rest: `skip`. Otherwise `always`.
 */
export function arpSlideAt(
  spec: Pick<ArpSpec, 'steps' | 'skipChance' | 'style'>,
  index: number,
  list: readonly number[],
): StepSlide {
  const { steps, style } = spec;
  const n = Math.min(arpListCount(style, list), steps.length);
  const step = steps[index];
  if (!step || step.kind !== 'note' || !step.slide || index >= n) return NO_SLIDE;
  for (let back = 1; back <= n; back++) {
    const at = (((index - back) % n) + n) % n;
    const prev = steps[at];
    if (!prev || prev.kind === 'rest') return NO_SLIDE;
    if (prev.kind === 'tie') continue;
    const held = arpCellPitch(style, at, list, prev.octave);
    const next = arpCellPitch(style, index, list, step.octave);
    const kind = held === null || next === null ? 'either' : held === next ? 'same' : 'retarget';
    const when = back > index ? 'wrap' : spec.skipChance > 0 ? 'skip' : 'always';
    return { kind, when };
  }
  return NO_SLIDE;
}
