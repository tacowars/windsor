/**
 * An operator's own filters (windsor#362, record
 * `2026-10-02-operator-noise-colour`; every wave since windsor#590, record
 * `2026-10-04-operator-filters-on-every-wave`): a two-pole Butterworth
 * lowpass and highpass on that operator's wave, after its feedback tap and
 * before its level and envelope, from the operator's `opLp` and `opHp` (Hz;
 * 0 is off), each moved by `opTrack` octaves an octave of the played note
 * from middle C. The sections are the voice filter's TPT state-variable form
 * (`svf.ts`) at damping √2 (Q 0.707), with no resonance: windsor#361
 * measured that a Q gained at most 0.3 dB on the snares' band shape and
 * fitted worse (`docs/research/2026-10-01-tom-noise-colour-prototype/`).
 *
 * This module holds one operator's filter state and coefficients
 * (`OperatorFilter`, four to a voice, built with it) and their tuning,
 * `bindOperatorFilter`, which `bindVoiceConstants` runs whenever the voice
 * binds a patch (a note-on, a live edit's `rebind`, a slide's `retarget`):
 * the only times the fields or the note can change, so a live edit is heard
 * from the next block with no work in any block between. It retunes a
 * section only when its effective cutoff has changed, with the prewarp
 * g = tan(π fc / fs) from `portableTangent.ts` and the tracking's power from
 * `portablePowers.ts`, so the coefficients are the same bits on arm64 and
 * x64. A section that turns on mid-note starts from rest. (windsor#362's
 * first build retuned in every control block, which cost 0.6 to 1.0 ns a
 * sample with the fields absent: `docs/research/2026-10-02-operator-noise-colour/`.)
 * Both render loops call `process` for an operator's sample only while `on`,
 * so an operator with neither cutoff set does no per-sample work and renders
 * as before to the bit.
 *
 * Invariants: `process` takes its sample from `point` and leaves it there,
 * so no double crosses the call (worklet rule 2); nothing here allocates;
 * every double field is born NaN (rule 7); the state is zeroed by `reset`
 * at a note's start. `operatorFilter.test.ts` pins the response and the
 * tuning; `synth/fmProcessorOperatorFilter.test.ts` the loops (both paths
 * to the bit, every wave, the feedback tap before the filter).
 */

import type { Voice } from './voice';
import { OP_FILTER_CEILING, OP_FILTER_DAMPING, OP_FILTER_TRACK_OCTAVES_MAX } from './fmConstants';
import { OP_FILTER_FLOOR_HZ } from './patchDefaults';
import { exp2InPlace } from './portablePowers';
import { tanInPlace } from './portableTangent';

/** Middle C, the note at which key tracking leaves a cutoff where it is set. */
const TRACK_CENTRE_NOTE = 60;
const SEMITONES_PER_OCTAVE = 12;

class OperatorFilter {
  /** Either section runs: the loops pass this operator's wave through `process`. */
  on: boolean;
  lpOn: boolean;
  hpOn: boolean;
  /** The effective cutoffs the sections are tuned for (NaN: not yet), so an unchanged one costs one compare a bind. */
  lpHz: number;
  hpHz: number;
  /** Each section's TPT coefficients: a1 = 1 / (1 + g (g + k)), a2 = g a1, a3 = g a2. */
  lpA1: number;
  lpA2: number;
  lpA3: number;
  hpA1: number;
  hpA2: number;
  hpA3: number;
  /** Each section's two integrator states. */
  lp1: number;
  lp2: number;
  hp1: number;
  hp2: number;
  /** `process`'s sample, in and out. */
  point: number;
  /** The tracking's power and the prewarp's one slot. */
  slot: Float64Array;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value (windsor#233).
    this.lpHz = this.hpHz = this.lpA1 = this.lpA2 = this.lpA3 = NaN;
    this.hpA1 = this.hpA2 = this.hpA3 = NaN;
    this.lp1 = this.lp2 = this.hp1 = this.hp2 = this.point = NaN;
    this.on = false;
    this.lpOn = false;
    this.hpOn = false;
    this.lpA1 = this.hpA1 = 1;
    this.lpA2 = this.lpA3 = this.hpA2 = this.hpA3 = 0;
    this.lp1 = this.lp2 = this.hp1 = this.hp2 = 0;
    this.point = 0;
    this.slot = new Float64Array(1);
  }

  /** A new note: both sections start from rest. Their tuning carries over, since it is the patch's. */
  reset(): void {
    this.lp1 = 0;
    this.lp2 = 0;
    this.hp1 = 0;
    this.hp2 = 0;
  }

  /** `point` through the lowpass, then the highpass, whichever are on; written back to `point`. */
  process(): void {
    let x = this.point;
    if (this.lpOn) {
      const ic1 = this.lp1;
      const ic2 = this.lp2;
      const v3 = x - ic2;
      const v1 = this.lpA1 * ic1 + this.lpA2 * v3;
      const v2 = ic2 + this.lpA2 * ic1 + this.lpA3 * v3;
      this.lp1 = 2 * v1 - ic1;
      this.lp2 = 2 * v2 - ic2;
      x = v2;
    }
    if (this.hpOn) {
      const ic1 = this.hp1;
      const ic2 = this.hp2;
      const v3 = x - ic2;
      const v1 = this.hpA1 * ic1 + this.hpA2 * v3;
      const v2 = ic2 + this.hpA2 * ic1 + this.hpA3 * v3;
      this.hp1 = 2 * v1 - ic1;
      this.hp2 = 2 * v2 - ic2;
      x = x - OP_FILTER_DAMPING * v1 - v2;
    }
    this.point = x;
  }
}

/**
 * The prewarp for the cutoff in `slot[0]`: held to the patch's floor and to
 * `OP_FILTER_CEILING` of the sample rate, then g = tan(π fc / fs), written
 * back. Allocates nothing.
 */
function prewarpInPlace(slot: Float64Array, rate: number): void {
  let fc = slot[0];
  if (fc < OP_FILTER_FLOOR_HZ) fc = OP_FILTER_FLOOR_HZ;
  const top = OP_FILTER_CEILING * rate;
  if (fc > top) fc = top;
  slot[0] = (Math.PI * fc) / rate;
  tanInPlace(slot, 0);
}

/**
 * The tracking's factor for the voice's note, 2^(opTrack × (note − 60) / 12),
 * the voice filter's key-tracking formula, written to `slot[0]`. The exponent
 * is held to ±OP_FILTER_TRACK_OCTAVES_MAX, which moves no held cutoff.
 */
function trackInPlace(slot: Float64Array, track: number, note: number): void {
  let octaves = (track * (note - TRACK_CENTRE_NOTE)) / SEMITONES_PER_OCTAVE;
  if (octaves > OP_FILTER_TRACK_OCTAVES_MAX) octaves = OP_FILTER_TRACK_OCTAVES_MAX;
  if (octaves < -OP_FILTER_TRACK_OCTAVES_MAX) octaves = -OP_FILTER_TRACK_OCTAVES_MAX;
  slot[0] = octaves;
  exp2InPlace(slot, 0);
}

/**
 * Operator `i`'s filters for the bound patch and the voice's note: each
 * field times the tracking's factor (the field itself at `opTrack` 0), and a
 * section whose effective cutoff changed is retuned, starting from rest if
 * it was off. A field of 0 stays 0, off, at any tracking. Allocates nothing;
 * no double is passed in (windsor#233).
 */
function bindOperatorFilter(voice: Voice, i: number): void {
  const filter = voice.opFilter[i];
  const op = voice.patch!.ops[i];
  const slot = filter.slot;
  let lp = op.opLp;
  let hp = op.opHp;
  if (op.opTrack !== 0 && (lp > 0 || hp > 0)) {
    trackInPlace(slot, op.opTrack, voice.note);
    lp *= slot[0];
    hp *= slot[0];
  }
  if (lp !== filter.lpHz) {
    const was = filter.lpOn;
    filter.lpHz = lp;
    filter.lpOn = lp > 0;
    if (filter.lpOn) {
      slot[0] = lp;
      prewarpInPlace(slot, voice.sr);
      const g = slot[0];
      filter.lpA1 = 1 / (1 + g * (g + OP_FILTER_DAMPING));
      filter.lpA2 = g * filter.lpA1;
      filter.lpA3 = g * filter.lpA2;
      if (!was) filter.lp1 = filter.lp2 = 0;
    }
  }
  if (hp !== filter.hpHz) {
    const was = filter.hpOn;
    filter.hpHz = hp;
    filter.hpOn = hp > 0;
    if (filter.hpOn) {
      slot[0] = hp;
      prewarpInPlace(slot, voice.sr);
      const g = slot[0];
      filter.hpA1 = 1 / (1 + g * (g + OP_FILTER_DAMPING));
      filter.hpA2 = g * filter.hpA1;
      filter.hpA3 = g * filter.hpA2;
      if (!was) filter.hp1 = filter.hp2 = 0;
    }
  }
  filter.on = filter.lpOn || filter.hpOn;
}

export { OperatorFilter, bindOperatorFilter };
