/**
 * Spectre's song-owned settings (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): the analysis, the three drawn curves as
 * cells (`spectreCells.ts`), the selection across them, the moves on them,
 * the input modulation, the LFO and its three slots, Freeze and the output.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import { spectreCellCentre, spectreCellValue, spectreSelectionOf } from './spectreCells';
import type {
  SpectreCellCurves,
  SpectreCells,
  SpectreCurveCells,
  SpectreSelection,
} from './spectreCells';
import { spectrePresetNumbered } from './spectrePresetBank';
import {
  SPECTRE_BANDS,
  SPECTRE_BOUNDS,
  SPECTRE_CELLS,
  SPECTRE_CHOICES,
  SPECTRE_CURVES,
  SPECTRE_DEFAULTS,
  SPECTRE_DIVISIONS,
  SPECTRE_FOLLOWS,
  SPECTRE_FREEZE_MODES,
  SPECTRE_GRIDS,
  SPECTRE_LFO_DESTS,
  SPECTRE_LFO_SHAPES,
  SPECTRE_MODS,
  SPECTRE_OVERLAPS,
  SPECTRE_PRESET_DEFAULT,
  SPECTRE_WINDOWS,
} from './spectreConstants';
import type {
  SpectreBands,
  SpectreDivision,
  SpectreFollow,
  SpectreFreezeMode,
  SpectreGrid,
  SpectreLfoDest,
  SpectreLfoShape,
  SpectreMod,
  SpectreOverlap,
  SpectreWindow,
} from './spectreConstants';

export interface SpectreSpec {
  readonly kind: 'spectre';
  readonly bands: SpectreBands;
  readonly overlap: SpectreOverlap;
  readonly window: SpectreWindow;
  readonly curves: SpectreCellCurves;
  /** The selected cells, across all three curves: what the Select moves and Listen reach. */
  readonly selection: SpectreSelection;
  /** The selection follows the song's key or chord, within what is drawn. */
  readonly follow: SpectreFollow;
  /** The delay curve's full scale follows the song's tempo at `division`; off, it is `timeMs`. */
  readonly sync: boolean;
  readonly division: SpectreDivision;
  readonly timeMs: number;
  /** Each band's delay snapped to this division of the tempo, or left free. */
  readonly grid: SpectreGrid;
  readonly gainShift: number;
  readonly delayShift: number;
  readonly feedbackShift: number;
  readonly gainOffset: number;
  readonly delayOffset: number;
  readonly feedbackOffset: number;
  readonly gainSelect: number;
  readonly delaySelect: number;
  readonly feedbackSelect: number;
  readonly scatter: number;
  readonly spread: number;
  /** Every band's input closed: what the memory holds loops (Hold) or decays as drawn (Carve). */
  readonly freeze: boolean;
  readonly freezeMode: SpectreFreezeMode;
  readonly mod: SpectreMod;
  readonly modA: number;
  readonly modB: number;
  readonly modC: number;
  readonly lfoShape: SpectreLfoShape;
  readonly lfoSync: boolean;
  readonly lfoDivision: SpectreDivision;
  readonly lfoHz: number;
  readonly lfoDest1: SpectreLfoDest;
  readonly lfoDest2: SpectreLfoDest;
  readonly lfoDest3: SpectreLfoDest;
  readonly lfoDepth1: number;
  readonly lfoDepth2: number;
  readonly lfoDepth3: number;
  readonly mix: number;
  readonly outputDb: number;
  readonly enabled: boolean;
}

/** A new Spectre: the default preset's sound (`SPECTRE_PRESET_DEFAULT`), half wet, unfrozen and on. */
export const DEFAULT_SPECTRE: SpectreSpec = {
  kind: 'spectre',
  ...spectrePresetNumbered(SPECTRE_PRESET_DEFAULT)!.settings,
  freeze: SPECTRE_CHOICES.freeze,
  mix: SPECTRE_DEFAULTS.mix,
  outputDb: SPECTRE_DEFAULTS.outputDb,
  enabled: true,
};

export const SPECTRE_FIELDS = Object.keys(DEFAULT_SPECTRE);
export const SPECTRE_NUMBERS = Object.keys(SPECTRE_BOUNDS) as Array<keyof typeof SPECTRE_BOUNDS>;
const CURVE_FIELDS = ['left', 'right', 'link', 'steps'];

/** A breakpoint list (Spectre before cells) sampled at the cells' centres, its points joined straight. */
function sampledPoints(points: readonly { at: number; value: number }[]): number[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  return Array.from({ length: SPECTRE_CELLS }, (_, i) => {
    const x = spectreCellCentre(i);
    const after = sorted.findIndex((p) => p.at >= x);
    if (after <= 0) return spectreCellValue(sorted[after === 0 ? 0 : sorted.length - 1]!.value);
    const a = sorted[after - 1]!,
      b = sorted[after]!;
    const span = b.at - a.at;
    return spectreCellValue(a.value + (span > 0 ? (x - a.at) / span : 1) * (b.value - a.value));
  });
}

const isPoint = (raw: unknown): raw is { at: number; value: number } =>
  isRecord(raw) && typeof raw.at === 'number' && typeof raw.value === 'number';

/**
 * A channel's cells: `SPECTRE_CELLS` numbers, each held to 0..1 and stored to
 * `SPECTRE_CELL_STEPS` (the song's precision, so it rounds silently); a list
 * of another length is resampled, and anything else is `fallback`.
 */
export function normaliseSpectreCells(
  raw: unknown,
  fallback: SpectreCells,
  path: string,
  n: FieldNormaliser,
): SpectreCells {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of cells — using the default`);
    return fallback;
  }
  if (raw.every(isPoint)) {
    n.correction(`${path}: a breakpoint curve — sampled into ${SPECTRE_CELLS} cells`);
    return sampledPoints(raw);
  }
  const values = raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
  if (values.some((v) => Number.isNaN(v) || v < 0 || v > 1))
    n.correction(`${path}: cells outside 0..1 held to it`);
  if (values.length !== SPECTRE_CELLS) {
    n.correction(`${path}: ${values.length} cells — resampled to ${SPECTRE_CELLS}`);
    return Array.from({ length: SPECTRE_CELLS }, (_, i) =>
      spectreCellValue(values[Math.floor(spectreCellCentre(i) * values.length)]!),
    );
  }
  return values.map(spectreCellValue);
}

function normaliseCurve(
  raw: unknown,
  fallback: SpectreCurveCells,
  path: string,
  n: FieldNormaliser,
): SpectreCurveCells {
  if (raw === undefined) return fallback;
  if (Array.isArray(raw)) {
    const left = normaliseSpectreCells(raw, fallback.left, path, n);
    return { left, link: true, steps: false };
  }
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not a curve — using the default`);
    return fallback;
  }
  n.dropUnknown(raw, CURVE_FIELDS, path);
  const section = raw;
  const left = normaliseSpectreCells(section.left, fallback.left, `${path}.left`, n);
  const link = n.bool(section.link, true, `${path}.link`);
  const steps = n.bool(section.steps, false, `${path}.steps`);
  if (link) return { left, link, steps };
  const right = normaliseSpectreCells(section.right, left, `${path}.right`, n);
  return { left, right, link, steps };
}

function normaliseCurves(raw: unknown, path: string, n: FieldNormaliser): SpectreCellCurves {
  const section = raw === undefined ? {} : n.section(raw, path);
  n.dropUnknown(section, SPECTRE_CURVES, path);
  const D = DEFAULT_SPECTRE.curves;
  return {
    gain: normaliseCurve(section.gain, D.gain, `${path}.gain`, n),
    delay: normaliseCurve(section.delay, D.delay, `${path}.delay`, n),
    feedback: normaliseCurve(section.feedback, D.feedback, `${path}.feedback`, n),
  };
}

/** The selection: ranges of cells, sorted and merged; anything that isn't a range is dropped. */
export function normaliseSpectreSelection(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): SpectreSelection {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of ranges — nothing selected`);
    return [];
  }
  const mask = new Array<number>(SPECTRE_CELLS).fill(0);
  raw.forEach((range, i) => {
    const ok =
      Array.isArray(range) &&
      range.length === 2 &&
      range.every((v) => Number.isInteger(v)) &&
      range[0] < range[1];
    if (!ok) {
      n.correction(`${path}[${i}]: ${show(range)} is not a range — dropped`);
      return;
    }
    const from = Math.max(0, range[0] as number),
      to = Math.min(SPECTRE_CELLS, range[1] as number);
    for (let c = from; c < to; c++) mask[c] = 1;
  });
  const ranges = spectreSelectionOf(mask);
  if (JSON.stringify(ranges) !== JSON.stringify(raw))
    n.correction(`${path}: ranges sorted, merged and held to the cells`);
  return ranges;
}

export function normaliseSpectre(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): SpectreSpec {
  n.dropUnknown(raw, SPECTRE_FIELDS, path);
  const values = { ...SPECTRE_DEFAULTS };
  for (const name of SPECTRE_NUMBERS) {
    const [min, max] = SPECTRE_BOUNDS[name];
    values[name] = n.num(raw[name], SPECTRE_DEFAULTS[name], min, max, `${path}.${name}`);
  }
  const D = DEFAULT_SPECTRE;
  const pick = <T extends string>(field: keyof SpectreSpec, allowed: readonly T[], fallback: T) =>
    n.pick(raw[field], allowed, fallback, `${path}.${field}`);
  const bool = (field: keyof SpectreSpec, fallback: boolean) =>
    n.bool(raw[field], fallback, `${path}.${field}`);
  return {
    kind: 'spectre',
    bands: pick('bands', SPECTRE_BANDS, D.bands),
    overlap: pick('overlap', SPECTRE_OVERLAPS, D.overlap),
    window: pick('window', SPECTRE_WINDOWS, D.window),
    curves: normaliseCurves(raw.curves, `${path}.curves`, n),
    selection: normaliseSpectreSelection(raw.selection, `${path}.selection`, n),
    follow: pick('follow', SPECTRE_FOLLOWS, D.follow),
    sync: bool('sync', D.sync),
    division: pick('division', SPECTRE_DIVISIONS, D.division),
    grid: pick('grid', SPECTRE_GRIDS, D.grid),
    freeze: bool('freeze', D.freeze),
    freezeMode: pick('freezeMode', SPECTRE_FREEZE_MODES, D.freezeMode),
    mod: pick('mod', SPECTRE_MODS, D.mod),
    lfoShape: pick('lfoShape', SPECTRE_LFO_SHAPES, D.lfoShape),
    lfoSync: bool('lfoSync', D.lfoSync),
    lfoDivision: pick('lfoDivision', SPECTRE_DIVISIONS, D.lfoDivision),
    lfoDest1: pick('lfoDest1', SPECTRE_LFO_DESTS, D.lfoDest1),
    lfoDest2: pick('lfoDest2', SPECTRE_LFO_DESTS, D.lfoDest2),
    lfoDest3: pick('lfoDest3', SPECTRE_LFO_DESTS, D.lfoDest3),
    ...values,
    enabled: bool('enabled', D.enabled),
  };
}
