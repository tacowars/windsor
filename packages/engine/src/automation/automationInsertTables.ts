/**
 * The automation catalog's insert rows (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2), as data: each insert
 * kind's continuous fields, with the range its normaliser clamps to (the
 * kind's `*_BOUNDS` or constants, read here and never written) and its
 * card knob's scale. Enums, switches, model choices, stepped values (the
 * compressor's attack, ratio and release), tempo-synced divisions, Tape's
 * seed and its optional core override are not targets.
 *
 * A field nested in a list is spelled with its index, `bands.3.freq` or
 * `stages.0.amount`, so it sits after the insert's id in
 * `insert.<insertId>.<field>`.
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
import { EQ_BAND_COUNT, EQ_BOUNDS } from '../inserts/eqConstants';
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
import type { InsertKindName } from '../inserts/insertRegistry';
import { PHASER_BOUNDS } from '../inserts/phaserConstants';
import { RETRO_REVERB_BOUNDS } from '../inserts/retroReverbConstants';
import { TAPE_BOUNDS } from '../inserts/tapeConstants';
import type { AutomationScale, AutomationTargetRow } from './automationLane';

type Bounds = readonly [number, number];

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

/** One Advanced Drive stage's twelve fields, under `stages.<i>`. */
function driveStageRows(i: number): AutomationTargetRow[] {
  const at = (field: string): string => `stages.${i}.${field}`;
  const name = `Stage ${i + 1}`;
  return [
    row(at('amount'), `${name} amount`, S.amount),
    row(at('bias'), `${name} bias`, S.bias),
    row(at('level'), `${name} level`, S.level, 'linear', 'dB'),
    row(at('frequency'), `${name} frequency`, S.frequency, 'log', 'Hz'),
    row(at('resonance'), `${name} resonance`, S.resonance),
    row(at('peak'), `${name} peak`, S.peak, 'linear', 'dB'),
    row(at('envAmount'), `${name} env amount`, S.envAmount),
    row(at('envBias'), `${name} env bias`, S.envBias),
    row(at('envCutoff'), `${name} env cutoff`, S.envCutoff, 'linear', 'oct'),
    row(at('lfoAmount'), `${name} LFO amount`, S.lfoAmount),
    row(at('lfoBias'), `${name} LFO bias`, S.lfoBias),
    row(at('lfoCutoff'), `${name} LFO cutoff`, S.lfoCutoff, 'linear', 'oct'),
  ];
}

const ADVANCED_DRIVE_ROWS = [
  row('drive', 'Drive', A.drive, 'linear', 'dB'),
  row('tone', 'Tone', A.tone, 'linear', 'dB'),
  row('pivot', 'Pivot', A.pivot, 'log', 'Hz'),
  row('output', 'Output', A.output, 'linear', 'dB'),
  row('mix', 'Mix', A.mix),
  row('blend', 'Blend', A.blend),
  row('low', 'Low split', A.low, 'log', 'Hz'),
  row('high', 'High split', A.high, 'log', 'Hz'),
  row('rate', 'LFO rate', A.rate, 'log', 'Hz'),
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
const RETRO_REVERB_ROWS = [
  row('decay', 'Decay', R.decay, 'log', 's'),
  row('size', 'Size', R.size),
  row('tone', 'Tone', R.tone, 'log', 'Hz'),
  row('diffusion', 'Diffusion', R.diffusion),
  row('preDelay', 'Pre-delay', R.preDelay, 'linear', 's'),
  row('character', 'Character', R.character),
  row('mix', 'Mix', R.mix),
  row('duration', 'Gate time', R.duration, 'linear', 's'),
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
const DELAY_ROWS = [
  row('leftMs', 'Left time', D.leftMs, 'log', 'ms'),
  row('rightMs', 'Right time', D.rightMs, 'log', 'ms'),
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
const TAPE_ROWS = [
  row('drive', 'Drive', T.drive),
  row('bias', 'Bias', T.bias),
  row('wear', 'Wear', T.wear, 'linear', '%'),
  row('wow', 'Wow', T.wow, 'linear', '%'),
  row('flutter', 'Flutter', T.flutter, 'linear', '%'),
  row('dropouts', 'Dropouts', T.dropouts, 'linear', '%'),
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

/** One EQ band's frequency, gain and Q, under `bands.<i>`. */
function eqBandRows(i: number): AutomationTargetRow[] {
  const name = `Band ${i + 1}`;
  return [
    row(`bands.${i}.freq`, `${name} freq`, EQ_BOUNDS.freq, 'log', 'Hz'),
    row(`bands.${i}.gain`, `${name} gain`, EQ_BOUNDS.gain, 'linear', 'dB'),
    row(`bands.${i}.q`, `${name} Q`, EQ_BOUNDS.q, 'log'),
  ];
}

const EQ_ROWS = [
  ...Array.from({ length: EQ_BAND_COUNT }, (_, i) => eqBandRows(i)).flat(),
  row('scale', 'Scale', EQ_BOUNDS.scale),
  row('output', 'Output', EQ_BOUNDS.output, 'linear', 'dB'),
];

/** Each insert kind's continuous fields, the targets a lane may move on it. */
export const INSERT_AUTOMATION_FIELDS: Readonly<
  Record<InsertKindName, readonly AutomationTargetRow[]>
> = {
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
};
