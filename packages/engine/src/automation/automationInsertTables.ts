/**
 * The automation catalog's insert rows (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2), as data: each insert
 * kind's continuous fields, with the range its normaliser clamps to (the
 * kind's `*_BOUNDS` or constants, read here and never written) and its
 * card knob's scale. Enums, switches, model choices, stepped values (the
 * compressor's attack, ratio and release), tempo-synced divisions, Tape's
 * seed and its optional core override are not targets.
 *
 * Each insert's own on/off (windsor#628, record
 * `2026-10-06-insert-switch-lanes`) is not listed per kind:
 * `INSERT_SWITCH_ROW` is the row, and `insertKindFields`
 * (`automationInsertFields.ts`) appends it to every kind whose spec has
 * `enabled`. A kind may list a boolean field of its own as a `switch` row,
 * set-only like `enabled` (bloom's Freeze, record `2026-10-11-bloom-insert`
 * decision 13); other switches, enums and stepped fields stay out.
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
 *
 * A host kind (record `2026-10-11-wet-path-slot`) also lists its slot's
 * rows, `slot.<field>`: every other kind's, each available only while the
 * slot holds that kind (`slotRows`). So `slot.rate` is a row several times
 * over, once per child kind, and a lookup needs the insert's spec, not only
 * its kind (`insertTargetRow`).
 */
import { REVERB_SPACE_RANGES } from '../audioConstants';
import {
  ADVANCED_DRIVE_BOUNDS,
  DRIVE_DSP,
  DRIVE_STAGE_BOUNDS,
} from '../inserts/advancedDriveConstants';
import { BLOOM_BOUNDS } from '../inserts/bloomConstants';
import { DELAY_BOUNDS } from '../inserts/delayConstants';
import { ECHO_BOUNDS } from '../inserts/echoConstants';
import type { EchoSpec } from '../inserts/echoInsert';
import { ENSEMBLE_BOUNDS } from '../inserts/ensembleConstants';
import { EQ_BAND_COUNT, EQ_BOUNDS, EQ_FIRST_ORDER_SLOPE } from '../inserts/eqConstants';
import { FILTER_BOUNDS } from '../inserts/filterConstants';
import { SPECTRE_BOUNDS } from '../inserts/spectreConstants';
import type { SpectreSpec } from '../inserts/spectreSpec';
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
import type { InsertKindName } from '../inserts/insertRegistry';
import { INSERT_KIND_NAMES, INSERT_KINDS, insertSlot, SLOT_FIELD } from '../inserts/insertRegistry';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';
import type { TapeSpec } from '../inserts/tapeSpec';
import { PHASER_BOUNDS } from '../inserts/phaserConstants';
import { RETRO_REVERB_BOUNDS } from '../inserts/retroReverbConstants';
import { TAPE_BOUNDS } from '../inserts/tapeConstants';
import { COMPRESSOR_ROWS, PUMP_ROWS, TRANSIENT_ROWS } from './automationDynamicsRows';
import { row, UNIT, when } from './automationInsertRow';
import type { InsertFieldRow, InsertSpecOf } from './automationInsertRow';

export type { InsertFieldRow, InsertSpecOf } from './automationInsertRow';

/**
 * The Echo's time knob starts its log sweep at 20 ms (the console's
 * `DELAY_TIME_MIN`); the lane's floor is the same, and 0 sits below it.
 */
const ECHO_TIME_LOG_FLOOR = 0.02;

/**
 * bloom's Swell and Sustain lanes start their log sweeps at these, in
 * seconds, as Echo's Time does; 0 (the default, off) sits below each.
 * Swell's 10 ms is under the 20 ms the controls are smoothed over, so the
 * floor and 0 sound alike; Sustain's 50 ms is the shortest fall Freeze lets
 * go with (record `2026-10-11-bloom-insert` decisions 7 and 12).
 */
const BLOOM_SWELL_LOG_FLOOR = 0.01;
const BLOOM_SUSTAIN_LOG_FLOOR = 0.05;

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

const R = RETRO_REVERB_BOUNDS;
/**
 * The tank, its drift, its line taps, its low band's decay and its early reflections play only in
 * reverb mode; gated and reverse play the finite field (`retroReverbDsp.ts`).
 */
const tank = (spec: RetroReverbSpec): boolean => spec.mode === 'reverb';
const RETRO_REVERB_ROWS: InsertFieldRow<RetroReverbSpec>[] = [
  when(row('decay', 'Decay', R.decay, 'log', 's'), tank),
  when(row('size', 'Size', R.size, 'log'), tank),
  row('tone', 'Tone', R.tone, 'log', 'Hz'),
  row('diffusion', 'Diffusion', R.diffusion),
  row('preDelay', 'Pre-delay', R.preDelay, 'linear', 's'),
  row('character', 'Character', R.character),
  row('mix', 'Mix', R.mix),
  when(row('early', 'Early', R.early), tank),
  when(row('driftRate', 'Drift rate', R.driftRate, 'log', 'Hz'), tank),
  when(row('driftDepth', 'Drift depth', R.driftDepth), tank),
  when(row('density', 'Density', R.density), tank),
  when(row('lowDecay', 'Low decay', R.lowDecay, 'log'), tank),
  when(row('lowCross', 'Low cross', R.lowCross, 'log', 'Hz'), tank),
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
/**
 * A synced side's time comes from the tempo and its division (`delaySpec.ts`);
 * Width shapes only the band-pass and peak filters. Sustain is a switch lane.
 */
const DELAY_ROWS: InsertFieldRow<DelaySpec>[] = [
  when(row('leftMs', 'Left time', D.leftMs, 'log', 'ms'), (spec) => !spec.leftSync),
  when(row('rightMs', 'Right time', D.rightMs, 'log', 'ms'), (spec) => !spec.rightSync),
  row('feedback', 'Feedback', D.feedback),
  row('cross', 'Cross', D.cross),
  row('sustain', 'Sustain', UNIT, 'switch'),
  row('lowCut', 'Low cut', D.lowCut, 'log', 'Hz'),
  row('cutoff', 'Cutoff', D.cutoff, 'log', 'Hz'),
  row('resonance', 'Resonance', D.resonance, 'linear', 'dB'),
  when(
    row('width', 'Width', D.width, 'linear', 'oct'),
    (spec) => spec.filter === 'bandpass' || spec.filter === 'peak',
  ),
  row('drive', 'Drive', D.drive, 'linear', 'dB'),
  row('damping', 'Damping', D.damping, 'linear', 'dB'),
  row('dampingHz', 'Damping from', D.dampingHz, 'log', 'Hz'),
  row('modRate', 'Motion rate', D.modRate, 'log', 'Hz'),
  row('wow', 'Wow', D.wow),
  row('sweep', 'Sweep', D.sweep, 'linear', 'oct'),
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
const REVERB_ROWS = [
  row('preDelay', 'Pre-delay', V.preDelay, 'linear', 's'),
  row('inputLowCut', 'Input low cut', V.inputLowCut, 'log', 'Hz'),
  row('inputHighCut', 'Input high cut', V.inputHighCut, 'log', 'Hz'),
  row('diffusionIn1', 'Input diffusion 1', V.diffusionIn1),
  row('diffusionIn2', 'Input diffusion 2', V.diffusionIn2),
  row('build', 'Build', V.build),
  row('size', 'Size', V.size, 'log'),
  row('decay', 'Decay', V.decay, 'log', 's'),
  row('lowDecay', 'Low decay', V.lowDecay, 'log'),
  row('lowCross', 'Low cross', V.lowCross, 'log', 'Hz'),
  row('diffusionTank1', 'Tank diffusion 1', V.diffusionTank1),
  row('diffusionTank2', 'Tank diffusion 2', V.diffusionTank2),
  row('tankLowCut', 'Tank low cut', V.tankLowCut, 'log', 'Hz'),
  row('tankHighCut', 'Tank high cut', V.tankHighCut, 'log', 'Hz'),
  row('modRate', 'Mod rate', V.modRate, 'linear', 'Hz'),
  row('modDepth', 'Mod depth', V.modDepth),
  row('mix', 'Mix', UNIT),
];

/**
 * The Echo's line and Mix; its Time only while it is not synced (windsor#816,
 * record `2026-10-16-echo-follows-song-tempo`), as the Pump's Length. The
 * note value and Sync are not targets.
 */
const ECHO_ROWS: InsertFieldRow<EchoSpec>[] = [
  when(
    { ...row('delayTime', 'Time', ECHO_BOUNDS.delayTime, 'log', 's'), floor: ECHO_TIME_LOG_FLOOR },
    (spec: EchoSpec) => !spec.sync,
  ),
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

const SP = SPECTRE_BOUNDS;
const spectreModOn = (spec: SpectreSpec): boolean => spec.mod !== 'off';
/**
 * Spectre's moves (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): each curve's slide, offset and select
 * (its selected cells moved), Spread, Scatter, Freeze as a switch, the
 * modulation's three amounts while one is chosen, the LFO's rate while free
 * and its three slots' depths, Mix and Output. The cells, the selection, the
 * analysis and the choices are not targets.
 */
const SPECTRE_ROWS: InsertFieldRow<SpectreSpec>[] = [
  row('gainShift', 'Gain shift', SP.gainShift, 'linear', 'oct'),
  row('gainOffset', 'Gain offset', SP.gainOffset),
  row('delayShift', 'Delay shift', SP.delayShift, 'linear', 'oct'),
  row('delayOffset', 'Delay offset', SP.delayOffset),
  row('feedbackShift', 'Feedback shift', SP.feedbackShift, 'linear', 'oct'),
  row('feedbackOffset', 'Feedback offset', SP.feedbackOffset),
  row('gainSelect', 'Gain select', SP.gainSelect),
  row('delaySelect', 'Delay select', SP.delaySelect),
  row('feedbackSelect', 'Feedback select', SP.feedbackSelect),
  when(row('timeMs', 'Time', SP.timeMs, 'log', 'ms'), (spec: SpectreSpec) => !spec.sync),
  row('scatter', 'Scatter', SP.scatter),
  row('spread', 'Spread', SP.spread, 'linear', 'oct'),
  row('freeze', 'Freeze', UNIT, 'switch'),
  when(row('modA', 'Mod A', SP.modA), spectreModOn),
  when(row('modB', 'Mod B', SP.modB), spectreModOn),
  when(row('modC', 'Mod C', SP.modC), spectreModOn),
  when(row('lfoHz', 'LFO rate', SP.lfoHz, 'log', 'Hz'), (spec: SpectreSpec) => !spec.lfoSync),
  row('lfoDepth1', 'LFO depth 1', SP.lfoDepth1),
  row('lfoDepth2', 'LFO depth 2', SP.lfoDepth2),
  row('lfoDepth3', 'LFO depth 3', SP.lfoDepth3),
  row('mix', 'Mix', SP.mix),
  row('outputDb', 'Output', SP.outputDb, 'linear', 'dB'),
];

const B = BLOOM_BOUNDS;
/**
 * bloom's continuous levers and Freeze, a switch lane held between points
 * (record `2026-10-11-bloom-insert` decision 12). Octave, Low and High are
 * stepped and Key and Scale lists: none is a target.
 */
const BLOOM_ROWS = [
  row('amount', 'Amount', B.amount),
  row('mix', 'Mix', B.mix),
  { ...row('swell', 'Swell', B.swell, 'log', 's'), floor: BLOOM_SWELL_LOG_FLOOR },
  { ...row('sustain', 'Sustain', B.sustain, 'log', 's'), floor: BLOOM_SUSTAIN_LOG_FLOOR },
  row('freeze', 'Freeze', UNIT, 'switch'),
  row('spread', 'Spread', B.spread),
  row('shape', 'Shape', B.shape),
  row('bright', 'Bright', B.bright, 'linear', 'dB/oct'),
  row('focus', 'Focus', B.focus, 'log'),
  row('density', 'Density', B.density),
];

/** An insert's on/off switch (windsor#628): `enabled`, 0 off and 1 on, held between points. */
export const INSERT_SWITCH_ROW: InsertFieldRow = row('enabled', 'On', UNIT, 'switch');

/**
 * `rows`, then `toggle` where `kind`'s spec has `enabled` (windsor#628): the
 * one rule for a kind's switch, read by `insertKindFields` and `slotRows`.
 */
export function withSwitch(
  kind: InsertKindName,
  rows: readonly InsertFieldRow[],
  toggle = INSERT_SWITCH_ROW,
): readonly InsertFieldRow[] {
  return Object.hasOwn(INSERT_KINDS[kind].defaults, toggle.target) ? [...rows, toggle] : rows;
}

/** A table of rows by kind, each over its kind's spec. */
type KindRows = {
  readonly [K in InsertKindName]: readonly InsertFieldRow<InsertSpecOf<K>>[];
};

/** Each kind's own continuous fields, before a host's slot rows join them. */
const KIND_ROWS: KindRows = {
  drive: DRIVE_ROWS,
  'advanced-drive': ADVANCED_DRIVE_ROWS,
  chorus: CHORUS_ROWS,
  compressor: COMPRESSOR_ROWS,
  'retro-reverb': RETRO_REVERB_ROWS,
  phaser: PHASER_ROWS,
  delay: DELAY_ROWS,
  ensemble: ENSEMBLE_ROWS,
  tape: TAPE_ROWS,
  reverb: REVERB_ROWS,
  echo: ECHO_ROWS,
  eq: EQ_ROWS,
  filter: FILTER_ROWS,
  bloom: BLOOM_ROWS,
  pump: PUMP_ROWS,
  spectre: SPECTRE_ROWS,
  transient: TRANSIENT_ROWS,
};

/** The prefix a host's slot rows carry (record `2026-10-11-wet-path-slot`). */
export const SLOT_TARGET_PREFIX = `${SLOT_FIELD}.`;

/**
 * A host's slot rows (record `2026-10-11-wet-path-slot`): every other kind's
 * rows, its switch included, under `slot.` and labelled `Slot …`, each
 * carrying the child kind it reads. A row is available only while the slot
 * holds that kind and the child's own row is read under the child's spec.
 */
export function slotRows(host: InsertKindName, table: KindRows = KIND_ROWS): InsertFieldRow[] {
  return INSERT_KIND_NAMES.filter((kind) => kind !== host).flatMap((kind) => {
    // The table pairs each kind with rows over that kind's spec.
    return withSwitch(kind, table[kind] as readonly InsertFieldRow[]).map(
      (child): InsertFieldRow => ({
        ...child,
        target: `${SLOT_TARGET_PREFIX}${child.target}`,
        label: `Slot ${child.label}`,
        childKind: kind,
        available: (spec) => {
          const slot = insertSlot(spec);
          return slot?.kind === kind && (child.available?.(slot) ?? true);
        },
      }),
    );
  });
}

/**
 * Each insert kind's continuous fields, the targets a lane may move on it,
 * and on a host its slot rows: Echo's and bloom's are every other kind's,
 * under `slot.`.
 */
export const INSERT_AUTOMATION_FIELDS: KindRows = {
  ...KIND_ROWS,
  echo: [...ECHO_ROWS, ...slotRows('echo')],
  bloom: [...BLOOM_ROWS, ...slotRows('bloom')],
};
