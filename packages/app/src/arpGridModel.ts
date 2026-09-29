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
import type { ArpSpec, ArpStep, Harmony, HarmonyChord, StepModLane } from '@windsor/engine';
import { ARP_STEPS_MAX, ScaleSampler, arpCycleLength, arpNote, arpNoteList } from '@windsor/engine';
import { ARP_RANDOM, type ArpRandomTable } from './arpGridConstants';
import { type Draw, cycleKind, rotateLanes, rotateSteps } from './gridModel';
import type { StepSlide } from './stepModLaneModel';

/** What the shown count reads of the arp: the fields `arpNoteList` and the cycle rule take. */
export type ArpCycleFields = Pick<ArpSpec, 'style' | 'voicing' | 'octaves' | 'register'>;

/** The key a note list is voiced in. */
export type ArpKey = Pick<Harmony, 'root' | 'scale'>;

/**
 * The cells the strip shows for `chord`: one cycle of the style over the
 * arp's note list (epic decisions 2 and 3), at most `ARP_STEPS_MAX`; 0 with
 * no chord or an empty list, when the arp plays nothing.
 */
export function arpCellCount(
  spec: ArpCycleFields,
  key: ArpKey,
  chord: HarmonyChord | null,
): number {
  if (!chord) return 0;
  const list = arpNoteList(new ScaleSampler(key), spec, chord);
  return Math.min(ARP_STEPS_MAX, arpCycleLength(spec.style, list.length));
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
 * cells and readouts (windsor#31, `StepSlide`), read over the shown cycle
 * the way `arpCellPlay.ts` plays it. A slide after a note (walking back
 * over ties) hands the voice over: `retarget`, since the arp walks to a
 * new pitch at each onset. A rest before it holds nothing: `none`.
 *
 * `when`: a slide whose held note comes from wrapping round the cycle
 * (cell 1 among them) is held only once the cycle wraps, as a region's
 * entry and a retrigger reset strike it plain: `wrap`. With Skip above 0
 * the note before it may rest: `skip`. Otherwise `always`.
 */
export function arpSlideAt(
  spec: Pick<ArpSpec, 'steps' | 'skipChance'>,
  index: number,
  count: number,
): StepSlide {
  const { steps } = spec;
  const none: StepSlide = { kind: 'none', when: 'always' };
  const n = Math.min(Math.trunc(count), steps.length);
  const step = steps[index];
  if (!step || step.kind !== 'note' || !step.slide || index >= n) return none;
  for (let back = 1; back <= n; back++) {
    const prev = steps[(((index - back) % n) + n) % n];
    if (!prev || prev.kind === 'rest') return none;
    if (prev.kind === 'tie') continue;
    const when = back > index ? 'wrap' : spec.skipChance > 0 ? 'skip' : 'always';
    return { kind: 'retarget', when };
  }
  return none;
}
