/**
 * The Figure device's Process page without the DOM (windsor#490; record
 * `2026-10-03-figure-sequencer` decisions 4–6): the length schedule's add,
 * move, remove and edit, the drift's write, the Source picker's options and
 * choice, the readouts, and the tab bar's summary. Every function returns a
 * new value; the card writes schedule, drift and source as pattern fields
 * through `changePattern`, and the source's removal as a whole pattern.
 *
 * The stage in play and the rotation the summary names are the engine's
 * (`RegionStep.stage` and `rotation`, windsor#508), never a rule restated
 * here.
 */
import type {
  ArrangementDocument,
  FigureDrift,
  FigureSource,
  FigureSpec,
  FigureStage,
  MusicPart,
  RegionPattern,
} from '@windsor/engine';
import {
  FIGURE_DRIFT_STEPS_MAX,
  FIGURE_SCHEDULE_BARS_MAX,
  FIGURE_TRANSPOSE_MAX,
  GRID_STEPS_MAX,
  partAt,
  regionPattern,
  songTicks,
} from '@windsor/engine';
import { FIGURE_DRIFT_EVERY_DEFAULT, FIGURE_FIRST_STAGE } from './figureConstants';

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The schedule with a stage added: one cell longer than the last stage for
 * as many bars (additive growth), or the first stage of a line of `cells`.
 */
export function addStage(stages: readonly FigureStage[], cells: number): FigureStage[] {
  const last = stages[stages.length - 1];
  const length = last ? last.length + 1 : FIGURE_FIRST_STAGE.length;
  const bars = last ? last.bars : FIGURE_FIRST_STAGE.bars;
  return [...stages, { length: clampInt(length, 1, Math.max(1, cells)), bars }];
}

/** The schedule without stage `index`. */
export const removeStage = (stages: readonly FigureStage[], index: number): FigureStage[] =>
  stages.filter((_, i) => i !== index);

/** The schedule with stage `from` moved to `to` (clamped), the rest keeping their order. */
export function moveStage(stages: readonly FigureStage[], from: number, to: number): FigureStage[] {
  const moving = stages[from];
  if (!moving) return [...stages];
  const rest = removeStage(stages, from);
  const at = clampInt(to, 0, rest.length);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** The schedule with stage `index`'s `field` set: a length of 1..`cells`, bars of 1..64. */
export function setStage(
  stages: readonly FigureStage[],
  index: number,
  field: keyof FigureStage,
  value: number,
  cells: number,
): FigureStage[] {
  const max = field === 'length' ? Math.max(1, cells) : FIGURE_SCHEDULE_BARS_MAX;
  return stages.map((stage, i) =>
    i === index ? { ...stage, [field]: clampInt(value, 1, max) } : stage,
  );
}

/** The schedule's whole cycle, in bars; 0 with no schedule. */
export const scheduleBars = (stages: readonly FigureStage[] | undefined): number =>
  (stages ?? []).reduce((sum, stage) => sum + stage.bars, 0);

/**
 * The leader region the engine's canon reads at `tick`
 * (`PartBinding.figureAt`, windsor#512): the one that started last on the
 * song's cycle, which is the one holding the tick while one does; -1 with
 * no region, where the leader plays its base. The engine's index exports
 * neither `regionPhase` nor the binding's choice, so its rule is restated
 * here: `(tick - start) mod songTicks`, the smallest wins, the first on a tie.
 */
function leaderRegionAt(
  doc: Pick<ArrangementDocument, 'transport'>,
  part: Pick<MusicPart, 'regions'>,
  tick: number,
): number {
  const cycle = songTicks(doc.transport.bars, doc.transport.meter);
  if (!(cycle > 0)) return -1;
  let last = -1;
  let since = Infinity;
  part.regions.forEach((region, index) => {
    const phase = (((tick - region.start) % cycle) + cycle) % cycle;
    if (phase < since) {
      since = phase;
      last = index;
    }
  });
  return last;
}

/**
 * The leader a canon on `source` plays at the follower's `tick`, and its
 * name: the pattern of the leader region the engine's canon reads there
 * (`regionPattern`; the base with no region), so the stage the engine
 * reports indexes the schedule shown; null when the slot holds no Figure.
 */
export function leaderOf(
  doc: Pick<ArrangementDocument, 'parts' | 'transport'>,
  source: FigureSource,
  tick: number,
): { spec: FigureSpec; name: string } | null {
  const part = partAt(doc, source.slot);
  if (!part || part.sequencer.kind !== 'figure') return null;
  const spec = regionPattern(part, leaderRegionAt(doc, part, tick));
  return spec.kind === 'figure' ? { spec, name: part.name } : null;
}

/** The Schedule readout: the full cycle, or that every cell of the line plays. */
export function scheduleReadout(
  stages: readonly FigureStage[] | undefined,
  length: number,
): string {
  if (!stages?.length) return `no schedule · all ${plural(length, 'cell')}`;
  return `cycle ${plural(scheduleBars(stages), 'bar')} · ${plural(stages.length, 'stage')} · restarts at cell 1`;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The Drift readout: `+1 step / 12 bars · back in 144 bars` (when the line
 * of `length` cells has turned all the way round), or `no drift`.
 */
export function driftReadout(drift: FigureDrift | undefined, length: number): string {
  if (!drift || drift.steps === 0) return 'no drift';
  const steps = Math.abs(drift.steps);
  const n = Math.max(1, length);
  const back = (n / gcd(n, steps)) * drift.everyBars;
  return `${signed(drift.steps)} ${steps === 1 ? 'step' : 'steps'} / ${plural(drift.everyBars, 'bar')} · back in ${plural(back, 'bar')}`;
}

/** The drift after a Steps or Every knob: the other field kept, or its default before any drift. */
export function driftChange(
  drift: FigureDrift | undefined,
  field: keyof FigureDrift,
  value: number,
): FigureDrift {
  const now = drift ?? { steps: 0, everyBars: FIGURE_DRIFT_EVERY_DEFAULT };
  const next =
    field === 'steps'
      ? clampInt(value, -FIGURE_DRIFT_STEPS_MAX, FIGURE_DRIFT_STEPS_MAX)
      : clampInt(value, 1, FIGURE_SCHEDULE_BARS_MAX);
  return { ...now, [field]: next };
}

/** The Source picker's value for the part's own cells. */
export const OWN_CELLS = '';

/**
 * The Source picker (decision 4): "Own cells", then every other Figure part
 * in the song by name, keyed by slot. Never the part itself, never another
 * kind.
 */
export function sourceOptions(
  doc: Pick<ArrangementDocument, 'parts'>,
  slot: number,
): { value: string; label: string }[] {
  const leaders = doc.parts.filter((p) => p.slot !== slot && p.sequencer.kind === 'figure');
  return [
    { value: OWN_CELLS, label: 'Own cells' },
    ...leaders.map((p) => ({ value: String(p.slot), label: p.name })),
  ];
}

/** What choosing `value` writes: null for the own cells, else the slot with the offset and transpose kept. */
export function sourceChoice(
  value: string,
  current: FigureSource | undefined,
): FigureSource | null {
  if (value === OWN_CELLS) return null;
  return { slot: Number(value), offset: current?.offset ?? 0, transpose: current?.transpose ?? 0 };
}

/** The source after an Offset or Transpose knob, clamped to the normaliser's ranges. */
export function sourceChange(
  source: FigureSource,
  field: 'offset' | 'transpose',
  value: number,
): FigureSource {
  const max = field === 'offset' ? GRID_STEPS_MAX : FIGURE_TRANSPOSE_MAX;
  return { ...source, [field]: clampInt(value, -max, max) };
}

/** A pattern without its source: the own cells again, which a merge cannot say. */
export function withoutSource(pattern: RegionPattern): RegionPattern {
  const copy: Record<string, unknown> = { ...pattern };
  delete copy.source;
  // The copy is the pattern less an optional key, so it is still the same member.
  return copy as RegionPattern;
}

/** The Source readout: what a canon plays, or which parts it could follow. */
export function sourceReadout(source: FigureSource | undefined, names: readonly string[]): string {
  if (source) {
    const late = plural(Math.abs(source.offset), 'step');
    const when = source.offset >= 0 ? `${late} late` : `${late} early`;
    return `plays ${names[0] ?? 'its leader'}'s cell ${when}, ${signed(source.transpose)} st`;
  }
  return names.length ? `Figure parts only: ${names.join(', ')}` : 'no other Figure part yet';
}

/** The picker's hint: windsor#487 decision 5. */
export const SOURCE_HINT = 'A chain follows one level: a follower’s follower plays its own cells.';

/** What the tab bar's summary names: the cells, the chord, the stage, the rotation and the leader. */
export interface FigureSummaryInput {
  readonly cells: number;
  readonly chord: string | null;
  readonly stages: readonly FigureStage[] | undefined;
  readonly stage: number;
  readonly drift: FigureDrift | undefined;
  readonly rotation: number;
  readonly source: FigureSource | undefined;
  readonly leader: string | null;
}

/** The tab bar's summary (the mockup's): `8 cells · A min · stage 1/4 · 4 cells · rot +1 · from Lead +4`. */
export function figureSummary(input: FigureSummaryInput): string {
  const parts = [plural(input.cells, 'cell')];
  if (input.chord) parts.push(input.chord);
  const stage = input.stages?.[input.stage];
  if (input.stages?.length && stage) {
    parts.push(`stage ${input.stage + 1}/${input.stages.length} · ${plural(stage.length, 'cell')}`);
  }
  if (input.drift && input.drift.steps !== 0) parts.push(`rot ${signed(input.rotation)}`);
  if (input.source) parts.push(`from ${input.leader ?? '—'} ${signed(input.source.offset)}`);
  return parts.join(' · ');
}
