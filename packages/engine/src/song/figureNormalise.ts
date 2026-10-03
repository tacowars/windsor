/**
 * The Figure's sequencer fields, normalised (windsor#484, record
 * `2026-10-03-figure-sequencer`): the `figure` branch of
 * `normaliseSequencer`, built from `sequencerFields.ts`'s vocabulary.
 * Everything returned satisfies `assertFigureConfig` by construction.
 *
 * The cells take the Grid's list rules: 1–`GRID_STEPS_MAX`, an absent list
 * the default bar silently, junk or an empty list the default bar reported,
 * an over-long list capped reported, `length` fitted to the cells. A cell's
 * `velocity` of 1 and `ratchet` of 1 leave no key, so an export carries no
 * default. The three processes stay absent when absent: an empty schedule
 * silently, a stage longer than the cells dropped with a report.
 *
 * A source is checked twice: its numbers here, and whether its slot names
 * another Figure part in `figureSourceFault`, which the parts pass runs once
 * the whole part list is known.
 */
import {
  FIGURE_DRIFT_STEPS_MAX,
  FIGURE_SCHEDULE_BARS_MAX,
  FIGURE_TONE_MAX,
  FIGURE_TRANSPOSE_MAX,
  GATE_MIN,
  GRID_STEPS_MAX,
  MUSIC_SLOT_MAX,
} from '../audioConstants';
import { GRID_STEP_KINDS } from '../sequencing/gridSequencer';
import {
  DEFAULT_FIGURE_CONFIG,
  defaultFigureCells,
  figureNoteCell,
  type FigureCell,
  type FigureDrift,
  type FigureSource,
  type FigureStage,
} from '../sequencing/figureSequencer';
import type { FigureDriver, SequencerKind } from './arrangement';
import { show, type FieldNormaliser } from './arrangementFields';
import {
  registerOctave,
  seed,
  STEP_NOTE_KEYS,
  stepModLanes,
  stepNoteFields,
  unpitchedStep,
} from './sequencerFields';

const FIGURE_KEYS = [
  'divisor',
  'cells',
  'length',
  'gate',
  'register',
  'skipChance',
  'accentVelocity',
  'accentMod',
  'lanes',
  'seed',
  'schedule',
  'drift',
  'source',
];

export function figureDriver(raw: unknown, path: string, n: FieldNormaliser): FigureDriver {
  const d = DEFAULT_FIGURE_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, FIGURE_KEYS, path);
  const cells = figureCells(o.cells, `${path}.cells`, n);
  const count = cells.length;
  const schedule = figureSchedule(o.schedule, count, `${path}.schedule`, n);
  const drift = figureDrift(o.drift, `${path}.drift`, n);
  const source = figureSource(o.source, `${path}.source`, n);
  return {
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    cells,
    length: n.int(o.length, count, 1, count, `${path}.length`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    skipChance: n.num(o.skipChance, d.skipChance, 0, 1, `${path}.skipChance`),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    lanes: stepModLanes(o.lanes, count, `${path}.lanes`, n),
    seed: seed(o.seed, `${path}.seed`, n),
    ...(schedule && { schedule }),
    ...(drift && { drift }),
    ...(source && { source }),
  };
}

/** 1–`GRID_STEPS_MAX` cells, by the Grid's list rules. */
function figureCells(raw: unknown, path: string, n: FieldNormaliser): FigureCell[] {
  if (raw === undefined) return defaultFigureCells(n.meter);
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of cells — using the default bar`);
    return defaultFigureCells(n.meter);
  }
  const capped: unknown[] = raw.length > GRID_STEPS_MAX ? raw.slice(0, GRID_STEPS_MAX) : raw;
  if (capped.length !== raw.length) {
    n.correction(`${path}: ${raw.length} cells capped to ${GRID_STEPS_MAX}`);
  }
  return capped.map((cell, i) => figureCell(cell, `${path}[${i}]`, n));
}

/** A rest, a tie, or a note: a tone, the Grid step's octave, accent, slide and ratchet, and a velocity. */
function figureCell(raw: unknown, path: string, n: FieldNormaliser): FigureCell {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, GRID_STEP_KINDS, 'note', `${path}.kind`);
  if (kind !== 'note') return unpitchedStep(o, kind, path, n);
  n.dropUnknown(o, ['kind', 'tone', 'velocity', ...STEP_NOTE_KEYS], path);
  const tone = n.int(o.tone, 0, -FIGURE_TONE_MAX, FIGURE_TONE_MAX, `${path}.tone`);
  const velocity = n.num(o.velocity, 1, 0, 1, `${path}.velocity`);
  const { ratchet, ...fields } = stepNoteFields(o, path, n);
  return figureNoteCell(tone, {
    ...fields,
    ...(velocity !== 1 && { velocity }),
    ...(ratchet !== undefined && { ratchet }),
  });
}

/** Stages of 1..cells for 1..`FIGURE_SCHEDULE_BARS_MAX` bars; absent or empty is none. */
function figureSchedule(
  raw: unknown,
  cells: number,
  path: string,
  n: FieldNormaliser,
): FigureStage[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of stages — every cell plays`);
    return undefined;
  }
  const stages: FigureStage[] = [];
  raw.forEach((item, i) => {
    const at = `${path}[${i}]`;
    const o = n.section(item, at);
    n.dropUnknown(o, ['length', 'bars'], at);
    if (typeof o.length === 'number' && o.length > cells) {
      n.correction(`${at}.length: ${o.length} is past the ${cells} cells — stage dropped`);
      return;
    }
    stages.push({
      length: n.int(o.length, cells, 1, cells, `${at}.length`),
      bars: n.int(o.bars, 1, 1, FIGURE_SCHEDULE_BARS_MAX, `${at}.bars`),
    });
  });
  return stages.length > 0 ? stages : undefined;
}

/** ±`FIGURE_DRIFT_STEPS_MAX` steps every 1..`FIGURE_SCHEDULE_BARS_MAX` bars; absent is none. */
function figureDrift(raw: unknown, path: string, n: FieldNormaliser): FigureDrift | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['steps', 'everyBars'], path);
  const max = FIGURE_DRIFT_STEPS_MAX;
  return {
    steps: n.int(o.steps, 0, -max, max, `${path}.steps`),
    everyBars: n.int(o.everyBars, 1, 1, FIGURE_SCHEDULE_BARS_MAX, `${path}.everyBars`),
  };
}

/** A slot, an offset within ±`GRID_STEPS_MAX` and a transpose within ±`FIGURE_TRANSPOSE_MAX`; absent is the part's own cells. */
function figureSource(raw: unknown, path: string, n: FieldNormaliser): FigureSource | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['slot', 'offset', 'transpose'], path);
  if (typeof o.slot !== 'number') {
    n.correction(`${path}.slot: ${show(o.slot)} names no part — source dropped`);
    return undefined;
  }
  const t = FIGURE_TRANSPOSE_MAX;
  return {
    slot: n.int(o.slot, 0, 0, MUSIC_SLOT_MAX, `${path}.slot`),
    offset: n.int(o.offset, 0, -GRID_STEPS_MAX, GRID_STEPS_MAX, `${path}.offset`),
    transpose: n.int(o.transpose, 0, -t, t, `${path}.transpose`),
  };
}

/**
 * Why a source on the part on `ownSlot` cannot play, or null when it names
 * another Figure part: `kinds` maps each slot in the song to its part's
 * sequencer kind.
 */
export function figureSourceFault(
  source: FigureSource,
  ownSlot: number,
  kinds: ReadonlyMap<number, SequencerKind>,
): string | null {
  if (source.slot === ownSlot) return `slot ${source.slot} is the part's own`;
  const kind = kinds.get(source.slot);
  if (kind === undefined) return `slot ${source.slot} holds no part`;
  if (kind !== 'figure') return `slot ${source.slot} is a ${kind} part, not a Figure`;
  return null;
}
