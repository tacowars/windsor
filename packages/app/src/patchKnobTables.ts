/**
 * The Parts tab's knob specs (#618): every knob the panels and bays build over
 * the working patch, as data. An entry names the patch path (or the sub-field
 * of a per-operator or per-envelope group), the range and the readout — and
 * never a default: `patchKnobOpts` reads that from `makePatch()` at the path,
 * so a schema-default change in `patch.ts` moves double-click reset with it.
 * `knobDefaults.test.ts` walks `allPatchKnobs()`.
 */
import { OP_NAMES, makePatch } from '../../../packages/client/src/audio/index-for-editor';
import { fmt2, fmtHz, fmtMs, fmtSigned } from './consoleFormat';
import { ENVELOPE_SLOTS } from './envelopeTransfer';
import type { KnobSpec } from './knob';
import { getPath } from './patchState';

/** A table entry's options: the range and readout. The default is not the table's to state. */
export type PatchKnobRange = Pick<KnobSpec, 'min' | 'max' | 'step' | 'curve' | 'fmt'>;
export interface PatchKnobEntry {
  /** A full patch path, or a sub-field of the group the table serves. */
  readonly f: string;
  readonly label: string;
  readonly o: PatchKnobRange;
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

export const GLOBAL_KNOBS: PatchKnobTable = [
  { f: 'volume', label: 'Volume', o: { min: 0, max: 1.5, fmt: fmt2 } },
  { f: 'tone', label: 'Tone', o: { min: 0.02, max: 1, fmt: fmt2 } },
  { f: 'glide', label: 'Glide', o: { min: 0, max: 2, curve: 'log', fmt: fmtMs } },
  { f: 'spread', label: 'Spread', o: { min: 0, max: 50, step: 1, fmt: fmtCents } },
  { f: 'pan', label: 'Pan', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'panRandom', label: 'Pan Rnd', o: { min: 0, max: 1, fmt: fmt2 } },
];

export const FILTER_KNOBS: PatchKnobTable = [
  { f: 'filter.cutoff', label: 'Cutoff', o: { min: 30, max: 18000, curve: 'log', fmt: fmtHz } },
  { f: 'filter.resonance', label: 'Reso', o: { min: 0.5, max: 12, curve: 'log', fmt: fmt2 } },
  { f: 'filter.drive', label: 'Drive', o: { min: 1, max: 6, fmt: fmt2 } },
  { f: 'filter.envAmount', label: 'Env Amt', o: { min: -6, max: 6, fmt: fmtSigned } },
  { f: 'filter.modWheelDepth', label: 'Wheel', o: { min: -6, max: 6, fmt: fmtSigned } },
  { f: 'filter.lfoAmount', label: 'LFO Amt', o: { min: -4, max: 4, fmt: fmtSigned } },
  { f: 'filter.keyTrack', label: 'Key Trk', o: { min: -1, max: 2, fmt: fmtSigned } },
];

export const LFO_KNOBS: PatchKnobTable = [
  { f: 'lfo.rate', label: 'Rate', o: { min: 0.02, max: 40, curve: 'log', fmt: fmtHzRate } },
  { f: 'lfo.amount', label: 'Amount', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'lfo.modWheelDepth', label: 'Wheel', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'lfo.delay', label: 'Fade In', o: { min: 0, max: 6, curve: 'log', fmt: fmtMs } },
  { f: 'lfo.toPitch', label: 'To Pitch', o: { min: 0, max: 12, fmt: fmtSemitones } },
];

/** The LFO's per-operator depth, one knob per operator letter. */
export const LFO_TO_OP_KNOBS: PatchKnobTable = OP_NAMES.map((name, i) => ({
  f: `lfo.toOp.${i}`,
  label: `To ${name}`,
  o: { min: -1, max: 1, fmt: fmtSigned },
}));

export const PITCH_ENV_AMOUNT_KNOB: PatchKnobEntry = {
  f: 'pitchEnvAmount',
  label: 'Amount',
  o: { min: -48, max: 48, step: 0.5, fmt: fmtSignedSemitones },
};

/**
 * The fixed-frequency half of an operator's pitch controls. Apart from
 * `OP_KNOBS` because the Pitch toggle swaps it against the Coarse / Fine pair
 * (#587), which is bound through `ratioSplit` rather than to a path of its own.
 */
export const FIXED_HZ_KNOB: PatchKnobEntry = {
  f: 'fixedHz',
  label: 'Fixed',
  o: { min: 20, max: 8000, curve: 'log', fmt: fmtHz },
};

/** Per-operator knobs, by sub-field of `ops.<i>`; `level` gets the bay-fade hook. */
export const OP_KNOBS: PatchKnobTable = [
  { f: 'detune', label: 'Detune', o: { min: -100, max: 100, step: 1, fmt: fmtCents } },
  { f: 'level', label: 'Level', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'feedback', label: 'Fdbk', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'velSens', label: 'Vel', o: { min: 0, max: 1, fmt: fmt2 } },
];

/** The envelope row, by sub-field of any of the six envelope slots. */
export const ENVELOPE_KNOBS: PatchKnobTable = [
  { f: 'attackTime', label: 'Attack', o: { min: 0.0005, max: 12, curve: 'log', fmt: fmtMs } },
  { f: 'decayTime', label: 'Decay', o: { min: 0.001, max: 20, curve: 'log', fmt: fmtMs } },
  { f: 'sustainLevel', label: 'Sustain', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'releaseTime', label: 'Release', o: { min: 0.001, max: 20, curve: 'log', fmt: fmtMs } },
];

/** The envelope's advanced row: levels, curves and key scaling. */
export const ENVELOPE_ADV_KNOBS: PatchKnobTable = [
  { f: 'initLevel', label: 'Init', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'peakLevel', label: 'Peak', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'endLevel', label: 'End', o: { min: 0, max: 1, fmt: fmt2 } },
  { f: 'attackCurve', label: 'A Crv', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'decayCurve', label: 'D Crv', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'releaseCurve', label: 'R Crv', o: { min: -1, max: 1, fmt: fmtSigned } },
  { f: 'keyScale', label: 'Key', o: { min: -1, max: 1, fmt: fmtSigned } },
];

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
  own(FILTER_KNOBS);
  own(LFO_KNOBS);
  own(LFO_TO_OP_KNOBS);
  own([PITCH_ENV_AMOUNT_KNOB]);
  OP_NAMES.forEach((_, i) => under(`ops.${i}`, [FIXED_HZ_KNOB, ...OP_KNOBS]));
  for (const slot of ENVELOPE_SLOTS) under(slot, [...ENVELOPE_KNOBS, ...ENVELOPE_ADV_KNOBS]);
  return knobs;
}
