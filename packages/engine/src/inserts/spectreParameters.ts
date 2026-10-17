/**
 * Spectre's flat param vocabulary (record `2026-10-16-spectre-insert`): the
 * spec as named k-rate params, shared by the insert, the processor's
 * descriptors and the harness. The choices travel as their index in their
 * list; the delay's full scale as `timeMs`, the grid as `gridMs` (0 off)
 * and the LFO as `lfoHz`, whatever the sync, the tempo folded in here. The
 * curves and the selection are not params: they travel as one posted payload
 * (`spectreCells.ts`, record `2026-10-17-spectre-drawn-cells` decision 5).
 */
import { DELAY_DIVISIONS } from './delayConstants';
import {
  SPECTRE_BANDS,
  SPECTRE_BOUNDS,
  SPECTRE_CHOICES,
  SPECTRE_DEFAULTS,
  SPECTRE_DSP,
  SPECTRE_FOLLOWS,
  SPECTRE_FREEZE_MODES,
  SPECTRE_LFO_DESTS,
  SPECTRE_LFO_SHAPES,
  SPECTRE_MODS,
  SPECTRE_OVERLAPS,
  SPECTRE_PITCHES_ALL,
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

/**
 * What the params are written from: a `SpectreSpec`'s fields, stated here
 * rather than imported, so the worklet's project never reads the spec's
 * module and, through it, the rest of the engine.
 */
export interface SpectreParamSource {
  readonly bands: SpectreBands;
  readonly overlap: SpectreOverlap;
  readonly window: SpectreWindow;
  readonly sync: boolean;
  readonly division: SpectreDivision;
  readonly grid: SpectreGrid;
  readonly freeze: boolean;
  readonly freezeMode: SpectreFreezeMode;
  readonly follow: SpectreFollow;
  readonly mod: SpectreMod;
  readonly lfoShape: SpectreLfoShape;
  readonly lfoSync: boolean;
  readonly lfoDivision: SpectreDivision;
  readonly lfoDest1: SpectreLfoDest;
  readonly lfoDest2: SpectreLfoDest;
  readonly lfoDest3: SpectreLfoDest;
  readonly enabled: boolean;
  readonly timeMs: number;
  readonly lfoHz: number;
}
type Continuous = Record<keyof typeof SPECTRE_BOUNDS, number>;

export interface SpectreParamDescriptor {
  readonly name: string;
  readonly minValue: number;
  readonly maxValue: number;
  readonly defaultValue: number;
}

const MS_PER_MINUTE = 60000;
const MS_PER_SECOND = 1000;
const clamp = (value: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, value));
const beatMs = (division: SpectreDivision, bpm: number): number =>
  (DELAY_DIVISIONS[division] * MS_PER_MINUTE) / bpm;

/** The delay curve's full scale in ms: the synced division at `bpm`, or the free time. */
export const spectreTimeMs = (spec: SpectreParamSource, bpm: number): number =>
  spec.sync ? beatMs(spec.division, bpm) : spec.timeMs;
/** The grid's step in ms at `bpm`, 0 when off. */
export const spectreGridMs = (spec: SpectreParamSource, bpm: number): number =>
  spec.grid === 'off' ? 0 : beatMs(spec.grid, bpm);
/** The LFO's rate in Hz: one cycle a synced division at `bpm`, or the free rate. */
export const spectreLfoHz = (spec: SpectreParamSource, bpm: number): number =>
  spec.lfoSync ? MS_PER_SECOND / beatMs(spec.lfoDivision, bpm) : spec.lfoHz;

/** Every param `set` writes, by name, for `spec` at `bpm`. */
export function spectreParameters(
  spec: SpectreParamSource & Continuous,
  bpm: number,
): Record<string, number> {
  const values: Record<string, number> = {
    bands: SPECTRE_BANDS.indexOf(spec.bands),
    overlap: SPECTRE_OVERLAPS.indexOf(spec.overlap),
    window: SPECTRE_WINDOWS.indexOf(spec.window),
    mod: SPECTRE_MODS.indexOf(spec.mod),
    lfoShape: SPECTRE_LFO_SHAPES.indexOf(spec.lfoShape),
    lfoDest1: SPECTRE_LFO_DESTS.indexOf(spec.lfoDest1),
    lfoDest2: SPECTRE_LFO_DESTS.indexOf(spec.lfoDest2),
    lfoDest3: SPECTRE_LFO_DESTS.indexOf(spec.lfoDest3),
    freezeMode: SPECTRE_FREEZE_MODES.indexOf(spec.freezeMode),
    follow: SPECTRE_FOLLOWS.indexOf(spec.follow),
    freeze: Number(spec.freeze),
    enabled: Number(spec.enabled),
  };
  for (const name of Object.keys(SPECTRE_BOUNDS) as (keyof typeof SPECTRE_BOUNDS)[]) {
    values[name] = spec[name];
  }
  values.timeMs = clamp(spectreTimeMs(spec, bpm), SPECTRE_DSP.timeParamMs);
  values.gridMs = clamp(spectreGridMs(spec, bpm), SPECTRE_DSP.gridParamMs);
  values.lfoHz = clamp(spectreLfoHz(spec, bpm), SPECTRE_DSP.lfoParamHz);
  return values;
}

/** The params whose values follow the tempo: `setTempo` writes only these. */
export function spectreTiming(
  spec: SpectreParamSource & Continuous,
  bpm: number,
): Record<string, number> {
  const all = spectreParameters(spec, bpm);
  return { timeMs: all.timeMs!, gridMs: all.gridMs!, lfoHz: all.lfoHz! };
}

// From the constants, not `DEFAULT_SPECTRE`: the worklet reads this file and never the spec's normaliser.
const DEFAULTS = spectreParameters(
  { ...SPECTRE_CHOICES, ...SPECTRE_DEFAULTS, enabled: true },
  SPECTRE_DSP.defaultBpm,
);

function descriptor(name: string, range: readonly [number, number]): SpectreParamDescriptor {
  return { name, minValue: range[0], maxValue: range[1], defaultValue: DEFAULTS[name]! };
}

const last = (list: readonly unknown[]): [number, number] => [0, list.length - 1];

/** The processor's params, in slot order. */
export const SPECTRE_PARAMS: readonly SpectreParamDescriptor[] = [
  descriptor('bands', last(SPECTRE_BANDS)),
  descriptor('overlap', last(SPECTRE_OVERLAPS)),
  descriptor('window', last(SPECTRE_WINDOWS)),
  descriptor('mod', last(SPECTRE_MODS)),
  descriptor('lfoShape', last(SPECTRE_LFO_SHAPES)),
  descriptor('lfoDest1', last(SPECTRE_LFO_DESTS)),
  descriptor('lfoDest2', last(SPECTRE_LFO_DESTS)),
  descriptor('lfoDest3', last(SPECTRE_LFO_DESTS)),
  descriptor('freezeMode', last(SPECTRE_FREEZE_MODES)),
  descriptor('follow', last(SPECTRE_FOLLOWS)),
  // The stage's own: the key's or the chord's pitch classes, scheduled as Bloom's are.
  {
    name: 'pitches',
    minValue: 0,
    maxValue: SPECTRE_PITCHES_ALL,
    defaultValue: SPECTRE_PITCHES_ALL,
  },
  descriptor('freeze', [0, 1]),
  descriptor('enabled', [0, 1]),
  ...(Object.keys(SPECTRE_BOUNDS) as (keyof typeof SPECTRE_BOUNDS)[])
    .filter((name) => name !== 'timeMs' && name !== 'lfoHz')
    .map((name) => descriptor(name, SPECTRE_BOUNDS[name])),
  descriptor('timeMs', SPECTRE_DSP.timeParamMs),
  descriptor('gridMs', SPECTRE_DSP.gridParamMs),
  descriptor('lfoHz', SPECTRE_DSP.lfoParamHz),
];

/** A lane's field and the param it moves: the continuous fields name their own, and the switches. */
export const spectreParamOf = (field: string): string | undefined =>
  Object.hasOwn(SPECTRE_BOUNDS, field) || field === 'enabled' || field === 'freeze'
    ? field
    : undefined;
