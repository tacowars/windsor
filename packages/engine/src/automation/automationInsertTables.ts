/**
 * The automation catalog's insert rows (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2), as data: each insert
 * kind's continuous fields, with the range its normaliser clamps to (the
 * kind's `*_BOUNDS` or constants, read here and never written) and its
 * card knob's scale. Enums, switches, model choices, stepped values (the
 * compressor's attack, ratio and release), tempo-synced divisions, Tape's
 * seed and its optional core override are not targets.
 *
 * The one switch that is a target, each insert's own on/off (windsor#628,
 * record `2026-10-06-insert-switch-lanes`), is not listed per kind:
 * `INSERT_SWITCH_ROW` is the row, and `insertKindFields`
 * (`automationInsertFields.ts`) appends it to every kind whose spec has
 * `enabled`.
 *
 * A field nested in a list is spelled with its index, `bands.3.freq` or
 * `stages.0.amount`, so it sits after the insert's id in
 * `insert.<insertId>.<field>`.
 *
 * A row the DSP reads only in some settings of another field (a link, an
 * enable, a mode) carries `available`, a predicate over the insert's spec:
 * Tape's `wear` only unsplit and its `wow`, `flutter` and `dropouts` only
 * split, a delay side's time only free, Retro Reverb's tank only in reverb
 * mode and its gate time only outside it, Advanced Drive's split, blend, LFO
 * rate and each stage only where its route, sync and switches play them, an
 * EQ band only while it is on. `automatableInsertFields`
 * (`automationInsertFields.ts`) applies them.
 */
import { REVERB_SPACE_RANGES } from '../audioConstants';
import {
  ADVANCED_DRIVE_BOUNDS,
  DRIVE_DSP,
  DRIVE_STAGE_BOUNDS,
} from '../inserts/advancedDriveConstants';
import { COMPRESSOR_BOUNDS } from '../inserts/compressorConstants';
import { DELAY_BOUNDS } from '../inserts/delayConstants';
import { ECHO_BOUNDS } from '../inserts/echoConstants';
import { ENSEMBLE_BOUNDS } from '../inserts/ensembleConstants';
import { EQ_BAND_COUNT, EQ_BOUNDS, EQ_FIRST_ORDER_SLOPE } from '../inserts/eqConstants';
import { FILTER_BOUNDS } from '../inserts/filterConstants';
import {
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
} from '../inserts/insertConstants';
import type { AdvancedDriveSpec } from '../inserts/advancedDriveSpec';
import type { DelaySpec } from '../inserts/delaySpec';
import type { EqSpec } from '../inserts/eqSpec';
import type { InsertKindName, InsertSpec } from '../inserts/insertRegistry';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';
import type { TapeSpec } from '../inserts/tapeSpec';
import { PHASER_BOUNDS } from '../inserts/phaserConstants';
import { RETRO_REVERB_BOUNDS } from '../inserts/retroReverbConstants';
import { TAPE_BOUNDS } from '../inserts/tapeConstants';
import type { AutomationScale, AutomationTargetRow } from './automationLane';

type Bounds = readonly [number, number];

/** An insert kind's spec, by its name. */
export type InsertSpecOf<K extends InsertKindName> = Extract<InsertSpec, { readonly kind: K }>;

/**
 * An insert field's row. `available`, when present, says whether the DSP
 * reads the field under `spec`'s other settings; absent, it always does.
 */
export interface InsertFieldRow<S extends InsertSpec = InsertSpec> extends AutomationTargetRow {
  readonly available?: (spec: S) => boolean;
}

/** `r`, read by the DSP only where `available` holds. */
const when = <S extends InsertSpec>(
  r: AutomationTargetRow,
  available: (spec: S) => boolean,
): InsertFieldRow<S> => ({ ...r, available });

/** A mix, a share or a depth: 0..1. */
const UNIT: Bounds = [0, 1];

/**
 * The Echo's time knob starts its log sweep at 20 ms (the console's
 * `DELAY_TIME_MIN`); the lane's floor is the same, and 0 sits below it.
 */
const ECHO_TIME_LOG_FLOOR = 0.02;

/** One row: a field, its label, its bounds, its scale and its unit. */
function row(
  target: string,
  label: string,
  [min, max]: Bounds,
  scale: AutomationScale = 'linear',
  unit = '',
): AutomationTargetRow {
  return { target, label, min, max, scale, unit };
}

const DRIVE_ROWS = [
  row('drive', 'Drive', [DRIVE_GAIN_MIN_DB, DRIVE_GAIN_MAX_DB], 'linear', 'dB'),
  row('tone', 'Tone', [DRIVE_TONE_MIN_HZ, DRIVE_TONE_MAX_HZ], 'log', 'Hz'),
  row('mix', 'Mix', UNIT),
];

const A = ADVANCED_DRIVE_BOUNDS;
const S = DRIVE_STAGE_BOUNDS;

/**
 * How many stages each route plays (`driveRouting.ts`): single the first,
 * serial, parallel and mid/side the first two, multiband all three.
 */
const DRIVE_STAGES_PLAYED: Readonly<Record<AdvancedDriveSpec['route'], number>> = {
  single: 1,
  serial: 2,
  parallel: 2,
  multiband: 3,
  'mid-side': 2,
};

/** Whether stage `i` sounds: its route plays it and it is on. */
const stageLive = (spec: AdvancedDriveSpec, i: number): boolean =>
  i < DRIVE_STAGES_PLAYED[spec.route] && spec.stages[i]?.enabled === true;

/**
 * One Advanced Drive stage's twelve fields, under `stages.<i>`: the shaper's
 * only while it shapes, the filter's only while it filters, the peak only on
 * a peak filter (`driveStage.ts`).
 */
function driveStageRows(i: number): InsertFieldRow<AdvancedDriveSpec>[] {
  const at = (field: string): string => `stages.${i}.${field}`;
  const name = `Stage ${i + 1}`;
  const live = (spec: AdvancedDriveSpec): boolean => stageLive(spec, i);
  const shaping = (spec: AdvancedDriveSpec): boolean => live(spec) && spec.stages[i]!.shaping;
  const filtering = (spec: AdvancedDriveSpec): boolean => live(spec) && spec.stages[i]!.filtering;
  const peaking = (spec: AdvancedDriveSpec): boolean =>
    filtering(spec) && spec.stages[i]!.filter === 'peak';
  return [
    when(row(at('amount'), `${name} amount`, S.amount), shaping),
    when(row(at('bias'), `${name} bias`, S.bias), shaping),
    when(row(at('level'), `${name} level`, S.level, 'linear', 'dB'), live),
    when(row(at('frequency'), `${name} frequency`, S.frequency, 'log', 'Hz'), filtering),
    when(row(at('resonance'), `${name} resonance`, S.resonance), filtering),
    when(row(at('peak'), `${name} peak`, S.peak, 'linear', 'dB'), peaking),
    when(row(at('envAmount'), `${name} env amount`, S.envAmount), shaping),
    when(row(at('envBias'), `${name} env bias`, S.envBias), shaping),
    when(row(at('envCutoff'), `${name} env cutoff`, S.envCutoff, 'linear', 'oct'), filtering),
    when(row(at('lfoAmount'), `${name} LFO amount`, S.lfoAmount), shaping),
    when(row(at('lfoBias'), `${name} LFO bias`, S.lfoBias), shaping),
    when(row(at('lfoCutoff'), `${name} LFO cutoff`, S.lfoCutoff, 'linear', 'oct'), filtering),
  ];
}

/** The crossover splits only on the multiband route; blend mixes only serial and parallel. */
const multiband = (spec: AdvancedDriveSpec): boolean => spec.route === 'multiband';
const blended = (spec: AdvancedDriveSpec): boolean =>
  spec.route === 'serial' || spec.route === 'parallel';

const ADVANCED_DRIVE_ROWS: InsertFieldRow<AdvancedDriveSpec>[] = [
  row('drive', 'Drive', A.drive, 'linear', 'dB'),
  row('tone', 'Tone', A.tone, 'linear', 'dB'),
  row('pivot', 'Pivot', A.pivot, 'log', 'Hz'),
  row('output', 'Output', A.output, 'linear', 'dB'),
  row('mix', 'Mix', A.mix),
  when(row('blend', 'Blend', A.blend), blended),
  when(row('low', 'Low split', A.low, 'log', 'Hz'), multiband),
  when(row('high', 'High split', A.high, 'log', 'Hz'), multiband),
  // Synced, the LFO runs from the tempo and the division.
  when(row('rate', 'LFO rate', A.rate, 'log', 'Hz'), (spec) => !spec.sync),
  row('attack', 'Attack', A.attack, 'linear', 'ms'),
  row('release', 'Release', A.release, 'linear', 'ms'),
  row('sensitivity', 'Sensitivity', A.sensitivity, 'linear', 'dB'),
  ...Array.from({ length: DRIVE_DSP.stages }, (_, i) => driveStageRows(i)).flat(),
];

const CHORUS_ROWS = [
  row('rate', 'Rate', [CHORUS_RATE_MIN_HZ, CHORUS_RATE_MAX_HZ], 'log', 'Hz'),
  row('depth', 'Depth', [CHORUS_DEPTH_MIN_MS, CHORUS_DEPTH_MAX_MS], 'linear', 'ms'),
  row('spread', 'Spread', UNIT),
  row('mix', 'Mix', UNIT),
];

const C = COMPRESSOR_BOUNDS;
const COMPRESSOR_ROWS = [
  row('threshold', 'Threshold', C.threshold, 'linear', 'dB'),
  row('makeup', 'Makeup', C.makeup, 'linear', 'dB'),
  row('highpass', 'Detector HPF', C.highpass, 'linear', 'Hz'),
  row('range', 'Range', C.range, 'linear', 'dB'),
  row('mix', 'Mix', C.mix),
];

const R = RETRO_REVERB_BOUNDS;
/** The tank plays only in reverb mode; gated and reverse play the finite field (`retroReverbDsp.ts`). */
const tank = (spec: RetroReverbSpec): boolean => spec.mode === 'reverb';
const RETRO_REVERB_ROWS: InsertFieldRow<RetroReverbSpec>[] = [
  when(row('decay', 'Decay', R.decay, 'log', 's'), tank),
  when(row('size', 'Size', R.size), tank),
  row('tone', 'Tone', R.tone, 'log', 'Hz'),
  row('diffusion', 'Diffusion', R.diffusion),
  row('preDelay', 'Pre-delay', R.preDelay, 'linear', 's'),
  row('character', 'Character', R.character),
  row('mix', 'Mix', R.mix),
  when(row('duration', 'Gate time', R.duration, 'linear', 's'), (spec) => !tank(spec)),
];

const P = PHASER_BOUNDS;
const PHASER_ROWS = [
  row('rate', 'Rate', P.rate, 'log', 'Hz'),
  row('center', 'Center', P.center, 'log', 'Hz'),
  row('depth', 'Depth', P.depth, 'linear', 'oct'),
  row('feedback', 'Feedback', P.feedback),
  row('feedbackCut', 'Feedback cut', P.feedbackCut, 'log', 'Hz'),
  row('stereo', 'Stereo', P.stereo, 'linear', '°'),
  row('envelope', 'Envelope', P.envelope, 'linear', 'oct'),
  row('bassKeep', 'Bass keep', P.bassKeep),
  row('mix', 'Mix', P.mix),
];

const D = DELAY_BOUNDS;
/** A synced side's time comes from the tempo and its division (`delaySpec.ts`). */
const DELAY_ROWS: InsertFieldRow<DelaySpec>[] = [
  when(row('leftMs', 'Left time', D.leftMs, 'log', 'ms'), (spec) => !spec.leftSync),
  when(row('rightMs', 'Right time', D.rightMs, 'log', 'ms'), (spec) => !spec.rightSync),
  row('feedback', 'Feedback', D.feedback),
  row('highpass', 'Highpass', D.highpass, 'log', 'Hz'),
  row('lowpass', 'Lowpass', D.lowpass, 'log', 'Hz'),
  row('drive', 'Drive', D.drive, 'linear', 'dB'),
  row('mix', 'Mix', D.mix),
  row('outputDb', 'Output', D.outputDb, 'linear', 'dB'),
];

const E = ENSEMBLE_BOUNDS;
const ENSEMBLE_ROWS = [
  row('slowRate', 'Slow rate', E.slowRate, 'log', 'Hz'),
  row('slowDepth', 'Slow depth', E.slowDepth, 'linear', 'ms'),
  row('fastRate', 'Fast rate', E.fastRate, 'log', 'Hz'),
  row('fastDepth', 'Fast depth', E.fastDepth, 'linear', 'ms'),
  row('delay', 'Delay', E.delay, 'linear', 'ms'),
  row('tone', 'Tone', E.tone, 'log', 'Hz'),
  row('width', 'Width', E.width),
  row('mix', 'Mix', E.mix),
];

const T = TAPE_BOUNDS;
/** Unsplit, `wear` drives all three motions; split, each has its own (`tapeDsp.ts`). */
const split = (spec: TapeSpec): boolean => spec.split;
const unsplit = (spec: TapeSpec): boolean => !spec.split;
const TAPE_ROWS: InsertFieldRow<TapeSpec>[] = [
  row('drive', 'Drive', T.drive),
  row('bias', 'Bias', T.bias),
  when(row('wear', 'Wear', T.wear, 'linear', '%'), unsplit),
  when(row('wow', 'Wow', T.wow, 'linear', '%'), split),
  when(row('flutter', 'Flutter', T.flutter, 'linear', '%'), split),
  when(row('dropouts', 'Dropouts', T.dropouts, 'linear', '%'), split),
  row('wowRate', 'Wow rate', T.wowRate, 'linear', 'Hz'),
  row('flutterRate', 'Flutter rate', T.flutterRate, 'linear', 'Hz'),
  row('hiss', 'Hiss', T.hiss, 'linear', 'dB'),
  row('trim', 'Trim', T.trim, 'linear', 'dB'),
  row('mix', 'Mix', T.mix),
];

const V = REVERB_SPACE_RANGES;
const PLATE_ROWS = [
  row('preDelay', 'Pre-delay', V.preDelay, 'linear', 's'),
  row('inputLowCut', 'Input low cut', V.inputLowCut, 'log', 'Hz'),
  row('inputHighCut', 'Input high cut', V.inputHighCut, 'log', 'Hz'),
  row('diffusionIn1', 'Input diffusion 1', V.diffusionIn1),
  row('diffusionIn2', 'Input diffusion 2', V.diffusionIn2),
  row('size', 'Size', V.size, 'log'),
  row('decay', 'Decay', V.decay),
  row('diffusionTank1', 'Tank diffusion 1', V.diffusionTank1),
  row('diffusionTank2', 'Tank diffusion 2', V.diffusionTank2),
  row('tankLowCut', 'Tank low cut', V.tankLowCut, 'log', 'Hz'),
  row('tankHighCut', 'Tank high cut', V.tankHighCut, 'log', 'Hz'),
  row('modRate', 'Mod rate', V.modRate, 'linear', 'Hz'),
  row('modDepth', 'Mod depth', V.modDepth),
  row('mix', 'Mix', UNIT),
];

const ECHO_ROWS = [
  {
    ...row('delayTime', 'Time', ECHO_BOUNDS.delayTime, 'log', 's'),
    floor: ECHO_TIME_LOG_FLOOR,
  },
  row('feedback', 'Feedback', ECHO_BOUNDS.feedback),
  row('damp', 'Damp', ECHO_BOUNDS.damp, 'log', 'Hz'),
  row('resonance', 'Resonance', ECHO_BOUNDS.resonance, 'linear', 'dB'),
  row('mix', 'Mix', ECHO_BOUNDS.mix),
];

/** The band types whose gain is heard: the bell and the shelves (`eqBand.ts`). */
const EQ_GAIN_TYPES: ReadonlySet<string> = new Set(['lowshelf', 'bell', 'highshelf']);

/** Whether band `i` of `spec` is a 6 dB/oct cut, which ignores Q. */
function firstOrderCut(spec: EqSpec, i: number): boolean {
  const band = spec.bands[i];
  const cut = band?.type === 'lowcut' || band?.type === 'highcut';
  return cut && band.slope === EQ_FIRST_ORDER_SLOPE;
}

/** One EQ band's frequency, gain and Q, under `bands.<i>`, each heard only while the band is on. */
function eqBandRows(i: number): InsertFieldRow<EqSpec>[] {
  const name = `Band ${i + 1}`;
  const on = (spec: EqSpec): boolean => spec.bands[i]?.on === true;
  const gained = (spec: EqSpec): boolean => on(spec) && EQ_GAIN_TYPES.has(spec.bands[i]!.type);
  const shaped = (spec: EqSpec): boolean => on(spec) && !firstOrderCut(spec, i);
  return [
    when(row(`bands.${i}.freq`, `${name} freq`, EQ_BOUNDS.freq, 'log', 'Hz'), on),
    when(row(`bands.${i}.gain`, `${name} gain`, EQ_BOUNDS.gain, 'linear', 'dB'), gained),
    when(row(`bands.${i}.q`, `${name} Q`, EQ_BOUNDS.q, 'log'), shaped),
  ];
}

const EQ_ROWS: InsertFieldRow<EqSpec>[] = [
  ...Array.from({ length: EQ_BAND_COUNT }, (_, i) => eqBandRows(i)).flat(),
  row('scale', 'Scale', EQ_BOUNDS.scale),
  row('output', 'Output', EQ_BOUNDS.output, 'linear', 'dB'),
];

/** The Filter's sweep (windsor#622); its mode, slope and switch are not targets. */
const FILTER_ROWS = [
  row('cutoff', 'Cutoff', FILTER_BOUNDS.cutoff, 'log', 'Hz'),
  row('resonance', 'Resonance', FILTER_BOUNDS.resonance, 'log'),
  row('mix', 'Mix', FILTER_BOUNDS.mix),
];

/** An insert's on/off switch (windsor#628): `enabled`, 0 off and 1 on, held between points. */
export const INSERT_SWITCH_ROW: InsertFieldRow = row('enabled', 'On', UNIT, 'switch');

/** Each insert kind's continuous fields, the targets a lane may move on it. */
export const INSERT_AUTOMATION_FIELDS: {
  readonly [K in InsertKindName]: readonly InsertFieldRow<InsertSpecOf<K>>[];
} = {
  drive: DRIVE_ROWS,
  'advanced-drive': ADVANCED_DRIVE_ROWS,
  chorus: CHORUS_ROWS,
  compressor: COMPRESSOR_ROWS,
  'retro-reverb': RETRO_REVERB_ROWS,
  phaser: PHASER_ROWS,
  delay: DELAY_ROWS,
  ensemble: ENSEMBLE_ROWS,
  tape: TAPE_ROWS,
  plate: PLATE_ROWS,
  echo: ECHO_ROWS,
  eq: EQ_ROWS,
  filter: FILTER_ROWS,
};
