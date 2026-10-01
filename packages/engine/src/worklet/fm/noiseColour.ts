/**
 * A Noise operator's own colour (windsor#362, record
 * `2026-10-02-operator-noise-colour`): a two-pole Butterworth lowpass and
 * highpass on that operator's noise, before its level and envelope, from the
 * operator's `noiseLp` and `noiseHp` (Hz; 0 is off). The sections are the
 * voice filter's TPT state-variable form (`svf.ts`) at damping √2 (Q 0.707),
 * with no resonance: windsor#361 measured that a Q gained at most 0.3 dB on
 * the snares' band shape and fitted worse
 * (`docs/research/2026-10-01-tom-noise-colour-prototype/`).
 *
 * This module holds one operator's filter state and coefficients
 * (`NoiseColour`, four to a voice, built with it) and their tuning,
 * `bindNoiseColour`, which `bindVoiceConstants` runs whenever the voice
 * binds a patch (a note-on, a live edit's `rebind`, a slide's `retarget`):
 * the only times the fields can change, so a live edit is heard from the
 * next block with no work in any block between. It retunes a section only
 * when its field has changed, with the prewarp g = tan(π fc / fs) from
 * `portableTangent.ts`, so the coefficients are the same bits on arm64 and
 * x64. A section that turns on mid-note starts from rest. (windsor#362's
 * first build retuned in every control block, which cost 0.6 to 1.0 ns a
 * sample with the fields absent: `docs/research/2026-10-02-operator-noise-colour/`.) Both render loops call `process` for a Noise operator's
 * sample only while `on`, so an operator with neither field set, and every
 * other wave, does no per-sample work and renders as before to the bit.
 *
 * Invariants: `process` takes its sample from `point` and leaves it there,
 * so no double crosses the call (worklet rule 2); nothing here allocates;
 * every double field is born NaN (rule 7); the state is zeroed by `reset`
 * at a note's start. `noiseColour.test.ts` pins the response and the
 * tuning; `synth/fmProcessorNoiseColour.test.ts` the loops (both paths
 * to the bit, the fields heard on Noise only).
 */

import type { Voice } from './voice';
import { NOISE_COLOUR_CEILING, NOISE_COLOUR_DAMPING } from './fmConstants';
import { NOISE_COLOUR_FLOOR_HZ } from './patchDefaults';
import { tanInPlace } from './portableTangent';
import { KIND_NOISE } from './waveTables';

class NoiseColour {
  /** Either section runs: the loops pass this operator's noise through `process`. */
  on: boolean;
  lpOn: boolean;
  hpOn: boolean;
  /** The cutoffs the sections are tuned for (NaN: not yet), so an unchanged field costs one compare a block. */
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
  /** The prewarp's one slot. */
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
      x = x - NOISE_COLOUR_DAMPING * v1 - v2;
    }
    this.point = x;
  }
}

/**
 * The prewarp for the cutoff in `slot[0]`: held to the patch's floor and to
 * `NOISE_COLOUR_CEILING` of the sample rate, then g = tan(π fc / fs), written
 * back. Allocates nothing.
 */
function prewarpInPlace(slot: Float64Array, rate: number): void {
  let fc = slot[0];
  if (fc < NOISE_COLOUR_FLOOR_HZ) fc = NOISE_COLOUR_FLOOR_HZ;
  const top = NOISE_COLOUR_CEILING * rate;
  if (fc > top) fc = top;
  slot[0] = (Math.PI * fc) / rate;
  tanInPlace(slot, 0);
}

/**
 * Operator `i`'s noise colour for the bound patch, from its fields: a
 * section whose field changed is retuned, and starts from rest if it was
 * off. A wave other than Noise reads as both fields 0, so a live wave switch
 * turns the colour off and back on with it. Allocates nothing; no double is
 * passed in (windsor#233).
 */
function bindNoiseColour(voice: Voice, i: number): void {
  const colour = voice.noiseColour[i];
  const op = voice.patch!.ops[i];
  const noise = voice.kind[i] === KIND_NOISE;
  const lp = noise ? op.noiseLp : 0;
  const hp = noise ? op.noiseHp : 0;
  const slot = colour.slot;
  if (lp !== colour.lpHz) {
    const was = colour.lpOn;
    colour.lpHz = lp;
    colour.lpOn = lp > 0;
    if (colour.lpOn) {
      slot[0] = lp;
      prewarpInPlace(slot, voice.sr);
      const g = slot[0];
      colour.lpA1 = 1 / (1 + g * (g + NOISE_COLOUR_DAMPING));
      colour.lpA2 = g * colour.lpA1;
      colour.lpA3 = g * colour.lpA2;
      if (!was) colour.lp1 = colour.lp2 = 0;
    }
  }
  if (hp !== colour.hpHz) {
    const was = colour.hpOn;
    colour.hpHz = hp;
    colour.hpOn = hp > 0;
    if (colour.hpOn) {
      slot[0] = hp;
      prewarpInPlace(slot, voice.sr);
      const g = slot[0];
      colour.hpA1 = 1 / (1 + g * (g + NOISE_COLOUR_DAMPING));
      colour.hpA2 = g * colour.hpA1;
      colour.hpA3 = g * colour.hpA2;
      if (!was) colour.hp1 = colour.hp2 = 0;
    }
  }
  colour.on = colour.lpOn || colour.hpOn;
}

export { NoiseColour, bindNoiseColour };
