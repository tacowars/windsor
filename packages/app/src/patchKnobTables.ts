/**
 * The Parts tab's knob specs (#618): every knob the panels and bays build over
 * the working patch, as data. An entry names the patch path (or the sub-field
 * of a per-operator or per-envelope group), the range and the readout — and
 * never a default: `patchKnobOpts` reads that from `makePatch()` at the path,
 * so a schema-default change in `patch.ts` moves double-click reset with it.
 * `knobDefaults.test.ts` walks `allPatchKnobs()`.
 *
 * A knob over a voice target states no range of its own: it spreads
 * `voiceKnobRange(path)`, the target's catalog row (windsor#436, record
 * `2026-10-02-knob-ranges-from-the-catalog`), and adds only its step and
 * readout. An entry that serves every operator or every envelope slot takes
 * operator A's row: the target table builds each operator's rows from one,
 * and `patchKnobRange.test.ts` holds every knob to its own path's row and
 * pins every range.
 */
import {
  OP_FILTER_FLOOR_HZ,
  OP_FILTER_RANGE,
  OP_FILTER_TRACK_RANGE,
  OP_NAMES,
  makePatch,
} from '@windsor/engine';
import { fmt2, fmtCycleDegrees, fmtHz, fmtMs, fmtSigned, fmtVowel } from './consoleFormat';
import { ENVELOPE_SLOTS } from './envelopeTransfer';
import type { KnobSpec } from './knob';
import { voiceKnobRange } from './patchKnobRange';
import { getPath } from './patchPath';

/** A table entry's options: the range and readout. The default is not the table's to state. */
export type PatchKnobRange = Pick<KnobSpec, 'min' | 'max' | 'step' | 'curve' | 'logFloor' | 'fmt'>;
export interface PatchKnobEntry {
  /** A full patch path, or a sub-field of the group the table serves. */
  readonly f: string;
  readonly label: string;
  readonly o: PatchKnobRange;
  /** What the knob's title says before how to turn it, where its label alone can't (a unit). */
  readonly hint?: string;
}
export type PatchKnobTable = ReadonlyArray<PatchKnobEntry>;

/** What `pathKnob` takes: the entry's range with the engine's default under it. */
export type PatchKnobOpts = PatchKnobRange & Pick<KnobSpec, 'def' | 'color' | 'onChange'>;

/** The engine's default at a patch path; a path the engine does not define is a table bug. */
export function patchDefault(path: string): number {
  const value = getPath(makePatch(), path);
  if (typeof value !== 'number') throw new Error(`patchKnobTables: no engine default at ${path}`);
  return value;
}

/** An entry's options at `path` (its own `f` unless the entry is a group's sub-field). */
export const patchKnobOpts = (entry: PatchKnobEntry, path = entry.f): PatchKnobOpts => ({
  ...entry.o,
  def: patchDefault(path),
});

const fmtCents = (v: number): string => `${v.toFixed(0)}c`;
const fmtHzRate = (v: number): string => `${v.toFixed(2)}H`;
const fmtSemitones = (v: number): string => `${v.toFixed(2)}st`;
const fmtSignedSemitones = (v: number): string => `${fmtSigned(v)}st`;
const PERCENT = 100;
const fmtPercent = (v: number): string => `${(v * PERCENT).toFixed(0)}%`;
const fmtTimes = (v: number): string => `×${v.toFixed(2)}`;
const fmtHzOrOff = (v: number): string => (v > 0 ? fmtHz(v) : 'Off');

export const GLOBAL_KNOBS: PatchKnobTable = [
  { f: 'volume', label: 'Volume', o: { min: 0, max: 1.5, fmt: fmt2 } },
  { f: 'tone', label: 'Tone', o: { min: 0.02, max: 1, fmt: fmt2 } },
  { f: 'glide', label: 'Glide', o: { min: 0, max: 2, curve: 'log', fmt: fmtMs } },
  { f: 'spread', label: 'Spread', o: { min: 0, max: 50, step: 1, fmt: fmtCents } },
  { f: 'pan', label: 'Pan', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'panRandom', label: 'Pan Rnd', o: { min: 0, max: 1, fmt: fmt2 } },
];

/**
 * The voice's drive stage (windsor#300, windsor#309): its own section before
 * the filter, since the signal runs carriers → drive → filter. The Shape
 * picker beside these is the engine's `DRIVE_SHAPE_NAMES`, not a knob.
 */
export const DRIVE_KNOBS: PatchKnobTable = [
  { f: 'drive.gain', label: 'Drive', o: { min: 1, max: 16, curve: 'log', fmt: fmtTimes } },
  { f: 'drive.bias', label: 'Bias', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'drive.tone', label: 'Tone', o: { min: 0, max: 1, fmt: fmtPercent } },
];

export const FILTER_KNOBS: PatchKnobTable = [
  { f: 'filter.cutoff', label: 'Cutoff', o: { ...voiceKnobRange('filter.cutoff'), fmt: fmtHz } },
  { f: 'filter.resonance', label: 'Reso', o: { ...voiceKnobRange('filter.resonance'), fmt: fmt2 } },
  // The Formant mode's vowel (windsor#334); `buildFilter` shows it in that mode only.
  { f: 'filter.vowel', label: 'Vowel', o: { ...voiceKnobRange('filter.vowel'), fmt: fmtVowel } },
  {
    f: 'filter.envAmount',
    label: 'Env Amt',
    o: { ...voiceKnobRange('filter.envAmount'), fmt: fmtSigned },
  },
  { f: 'filter.modWheelDepth', label: 'Wheel', o: { min: -6, max: 6, fmt: fmtSigned } },
  { f: 'filter.lfoAmount', label: 'LFO Amt', o: { min: -4, max: 4, fmt: fmtSigned } },
  { f: 'filter.lfo2Amount', label: 'LFO 2 Amt', o: { min: -4, max: 4, fmt: fmtSigned } },
  { f: 'filter.keyTrack', label: 'Key Trk', o: { min: -1, max: 2, fmt: fmtSigned } },
];

/** The patch's two LFOs (#54): one settings shape, so one set of tables per key. */
export type LfoKey = 'lfo' | 'lfo2';
export const LFO_KEYS: readonly LfoKey[] = ['lfo', 'lfo2'];

/** An LFO's own knobs: rate, depth, the wheel, the fade-in and the pitch depth. */
export const lfoKnobs = (key: LfoKey): PatchKnobTable => [
  { f: `${key}.rate`, label: 'Rate', o: { ...voiceKnobRange(`${key}.rate`), fmt: fmtHzRate } },
  { f: `${key}.amount`, label: 'Amount', o: { ...voiceKnobRange(`${key}.amount`), fmt: fmt2 } },
  { f: `${key}.modWheelDepth`, label: 'Wheel', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: `${key}.delay`, label: 'Fade In', o: { min: 0, max: 6, curve: 'log', fmt: fmtMs } },
  { f: `${key}.toPitch`, label: 'To Pitch', o: { min: 0, max: 12, fmt: fmtSemitones } },
];

/** An LFO's per-operator level depth, one knob per operator letter. */
export const lfoToOpKnobs = (key: LfoKey): PatchKnobTable =>
  OP_NAMES.map((name, i) => ({
    f: `${key}.toOp.${i}`,
    label: `To ${name}`,
    o: { min: -1, max: 1, fmt: fmtSigned },
  }));

/** An LFO's per-operator width depth, added to the operator's Width before the clamp. */
export const lfoToWidthKnobs = (key: LfoKey): PatchKnobTable =>
  OP_NAMES.map((name, i) => ({
    f: `${key}.toWidth.${i}`,
    label: `Width ${name}`,
    o: { min: -1, max: 1, fmt: fmtSigned },
  }));

/**
 * An LFO's per-operator ratio depth in octaves at full swing (windsor#646,
 * windsor#649): signed, read `+1.25` as Width A–D are, with the unit in the
 * hint because `+1.25oct` overruns the cell (the mockup's note). The range is
 * the engine's `LFO_TO_RATIO_RANGE`, which `index.ts` does not export.
 */
export const lfoToRatioKnobs = (key: LfoKey): PatchKnobTable =>
  OP_NAMES.map((name, i) => ({
    f: `${key}.toRatio.${i}`,
    label: `Ratio ${name}`,
    o: { min: -4, max: 4, fmt: fmtSigned },
    hint: `Ratio ${name}: octaves of LFO on ${name}'s ratio`,
  }));

export const PITCH_ENV_AMOUNT_KNOB: PatchKnobEntry = {
  f: 'pitchEnvAmount',
  label: 'Amount',
  o: { ...voiceKnobRange('pitchEnvAmount'), step: 0.5, fmt: fmtSignedSemitones },
};

/**
 * The fixed-frequency half of an operator's pitch controls. Apart from
 * `OP_KNOBS` because the Pitch toggle swaps it against the Coarse / Fine pair
 * (#587), which is bound through `ratioSplit` rather than to a path of its own.
 * It reaches down to 1 Hz: a sub-audio fixed operator is a technique, not a
 * slip (a 1 Hz square is a held pulse, as the 808 Kick's click is).
 */
export const FIXED_HZ_KNOB: PatchKnobEntry = {
  f: 'fixedHz',
  label: 'Fixed',
  o: { min: 1, max: 8000, curve: 'log', fmt: fmtHz },
};

/**
 * An operator's start phase, in cycles: where its wave begins at note-on when
 * the bay's Start segment is Locked (`phaseFree: false`). Free ignores it.
 */
export const OP_PHASE_KNOB: PatchKnobEntry = {
  f: 'phase',
  label: 'Phase',
  o: { min: 0, max: 1, fmt: fmtCycleDegrees },
};

/** Per-operator knobs, by sub-field of `ops.<i>`; `level` gets the bay-fade hook. */
export const OP_KNOBS: PatchKnobTable = [
  { f: 'detune', label: 'Detune', o: { min: -100, max: 100, step: 1, fmt: fmtCents } },
  { f: 'level', label: 'Level', o: { ...voiceKnobRange('ops.0.level'), fmt: fmt2 } },
  { f: 'feedback', label: 'Fdbk', o: { ...voiceKnobRange('ops.0.feedback'), fmt: fmtSigned } },
  { f: 'width', label: 'Width', o: { ...voiceKnobRange('ops.0.width'), fmt: fmtPercent } },
  { f: 'velSens', label: 'Vel', o: { min: 0, max: 1, fmt: fmt2 } },
];

/**
 * An operator's own filters (windsor#362, every wave since windsor#590), by
 * sub-field of `ops.<i>`: a two-pole lowpass and highpass on its wave, before
 * its level, and their key tracking. The bay shows them on every wave. LP and
 * HP are zero-end log knobs, as the envelope times' (windsor#324): the bottom
 * of the dial is exact 0, Off, and the log sweep runs from the engine's floor
 * to the top of its range. Key Trk is the voice filter's, signed, over the
 * engine's range.
 */
const opFilterRange: PatchKnobRange = {
  min: OP_FILTER_RANGE.min,
  max: OP_FILTER_RANGE.max,
  curve: 'log',
  logFloor: OP_FILTER_FLOOR_HZ,
  fmt: fmtHzOrOff,
};
export const OP_FILTER_KNOBS: PatchKnobTable = [
  { f: 'opLp', label: 'LP', o: opFilterRange },
  { f: 'opHp', label: 'HP', o: opFilterRange },
  {
    f: 'opTrack',
    label: 'Key Trk',
    o: { min: OP_FILTER_TRACK_RANGE.min, max: OP_FILTER_TRACK_RANGE.max, fmt: fmtSigned },
  },
];

/**
 * The envelope row, by sub-field of any of the six envelope slots. Since
 * windsor#316 a stage ends on its own sample, so an attack or a decay of 0
 * is a sound (a hit that opens on a step): the bottom of each sweep is exact
 * 0, and the log sweep above it starts where it always did. Decay is a voice
 * target on the operators' and the filter's envelopes, so the row's Decay is
 * the catalog's, the pitch envelope's included; the advanced row's D Crv is
 * the operators' decay-curve target's the same way.
 */
export const ENVELOPE_KNOBS: PatchKnobTable = [
  {
    f: 'attackTime',
    label: 'Attack',
    o: { min: 0, max: 12, curve: 'log', logFloor: 0.0005, fmt: fmtMs },
  },
  { f: 'decayTime', label: 'Decay', o: { ...voiceKnobRange('ops.0.env.decayTime'), fmt: fmtMs } },
  { f: 'sustainLevel', label: 'Sustain', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'releaseTime', label: 'Release', o: { min: 0.001, max: 20, curve: 'log', fmt: fmtMs } },
];

/** The envelope's advanced row: levels, curves and key scaling. */
export const ENVELOPE_ADV_KNOBS: PatchKnobTable = [
  { f: 'initLevel', label: 'Init', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'peakLevel', label: 'Peak', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'endLevel', label: 'End', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'attackCurve', label: 'A Crv', o: { min: -1, max: 1, fmt: fmtSigned } },
  {
    f: 'decayCurve',
    label: 'D Crv',
    o: { ...voiceKnobRange('ops.0.env.decayCurve'), fmt: fmtSigned },
  },
  { f: 'releaseCurve', label: 'R Crv', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'keyScale', label: 'Key', o: { min: -1, max: 1, fmt: fmtSigned } },
];

/**
 * The pitch envelope's advanced row: `ENVELOPE_ADV_KNOBS` without Key, since
 * the voice never key-scales the pitch envelope's times.
 */
export const PITCH_ENV_ADV_KNOBS: PatchKnobTable = ENVELOPE_ADV_KNOBS.filter(
  (entry) => entry.f !== 'keyScale',
);

/** One knob the console builds over the working patch: its full path and its entry. */
export interface PatchKnob {
  readonly path: string;
  readonly entry: PatchKnobEntry;
}

/** Every patch knob the Parts tab builds, with the path each one edits. */
export function allPatchKnobs(): PatchKnob[] {
  const knobs: PatchKnob[] = [];
  const own = (table: PatchKnobTable): void => {
    for (const entry of table) knobs.push({ path: entry.f, entry });
  };
  const under = (base: string, table: PatchKnobTable): void => {
    for (const entry of table) knobs.push({ path: `${base}.${entry.f}`, entry });
  };
  own(GLOBAL_KNOBS);
  own(DRIVE_KNOBS);
  own(FILTER_KNOBS);
  for (const key of LFO_KEYS) {
    own(lfoKnobs(key));
    own(lfoToOpKnobs(key));
    own(lfoToWidthKnobs(key));
    own(lfoToRatioKnobs(key));
  }
  own([PITCH_ENV_AMOUNT_KNOB]);
  OP_NAMES.forEach((_, i) =>
    under(`ops.${i}`, [FIXED_HZ_KNOB, ...OP_KNOBS, ...OP_FILTER_KNOBS, OP_PHASE_KNOB]),
  );
  for (const slot of ENVELOPE_SLOTS) {
    const adv = slot === 'pitchEnv' ? PITCH_ENV_ADV_KNOBS : ENVELOPE_ADV_KNOBS;
    under(slot, [...ENVELOPE_KNOBS, ...adv]);
  }
  return knobs;
}
