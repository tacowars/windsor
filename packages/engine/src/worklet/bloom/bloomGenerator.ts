/**
 * bloom's generator (`BLOOM_GENERATOR`): what each sounding band plays, at
 * the analysis rate. A band's phase u (from the envelope, |u| ≤ 1) is
 * re-pitched by the band's ratio (`bloomGeneratorPitch.ts`, Octave and
 * Scale) into w, |w| = |u|; `bloomSynth.ts` reads a band-limited waveform
 * (`bloomTables.ts`) at w's phase at the host rate, darkens it, and sums.
 * At the defaults (Shape 2, saw) the waveform is the sawtooth, Σ (−1)^(k+1)
 * sin(kφ)/k, every partial under the harmonic limit.
 *
 * It leaves, per block, the Shape mix (`mix`: two table reads, `familyA`
 * and `familyB`, their gains and B's offset; `bloomGeneratorMath.ts`), and
 * per band `bandGain`: the level that keeps every Shape and Bright at the
 * saw's power as heard (through the roll-off and the darkening at
 * `levelCornerHz`), times Bright's (pivot / fundamental)^β, so that with
 * `bloomTone.ts`'s tilt every partial k of every band moves by exactly k^β.
 * At Shape 2, Bright 0 every `bandGain` is exactly 1. Per analysis sample:
 * `gain` (the retune's dip) and the pitch stage's `waveRe`/`waveIm`.
 *
 * Levers (`configure` runs once a block):
 * - Shape (`SLOT_SHAPE`, 0 sine, 1 triangle, 2 saw, 3 square, 4 narrow
 *   pulse) and Bright (`SLOT_BRIGHT`, dB per octave, on top): the mix and
 *   the band levels, when either moves or a retune changes the bands.
 * - Octave (`SLOT_OCTAVE`, nearest step) and the pitch set (`SLOT_PITCHES`,
 *   Key and Scale as a 12-bit mask; 0 or out of range is every pitch
 *   class): a change fades the layer out over `switchSeconds`,
 *   retunes every band (ratio, mode, partial cap) and fades back in. With
 *   nothing sounding it retunes at once.
 *
 * No double crosses a call; every double field is born NaN. Pinned by
 * `inserts/bloomGenerator.test.ts`, `bloomDsp.test.ts` and `bloomGolden.test.ts`.
 */
import {
  BLOOM_BOUNDS,
  BLOOM_DEFAULTS,
  BLOOM_OCTAVES,
  BLOOM_PITCHES_ALL,
} from '../../inserts/bloomConstants';
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { BLOOM_GENERATOR as C } from '../../inserts/bloomGeneratorConstants';
import type { BloomEnvelope } from './bloomEnvelope';
import {
  MIX_COS,
  MIX_REGION,
  MIX_SAW,
  MIX_SINE,
  MIX_SLOTS,
  MIX_T,
  MIX_TRIANGLE,
  MIX_WEIGHT,
  bloomMixWeight,
  bloomPulseSine,
  bloomShapeMix,
} from './bloomGeneratorMath';
import { BloomGeneratorPitch } from './bloomGeneratorPitch';
import { exp2InPlace, log2InPlace } from '../fm/portablePowers';
import { SLOT_BRIGHT, SLOT_OCTAVE, SLOT_PITCHES, SLOT_SHAPE } from './bloomSlots';
import { bloomTables } from './bloomTables';
import type { BloomTableSet } from './bloomTables';

/** Octave's index of 0 semitones, the default. */
const BLOOM_GENERATOR_UNISON = BLOOM_OCTAVES.indexOf(0);
/** The mix's region from the square to the narrowest pulse (`bloomShapeMix`). */
const BLOOM_GENERATOR_PULSE_REGION = 3;
/** The default Shape, the saw: no second read, every band level 1. */
const BLOOM_GENERATOR_SAW_SHAPE = 2;

class BloomGenerator {
  slots: Float64Array;
  controls: Float64Array;
  envelope: BloomEnvelope;
  pitch: BloomGeneratorPitch;
  tables: BloomTableSet;
  /** The Shape mix (`MIX_*`) and which table each read takes (`MIX_SINE`, `MIX_TRIANGLE`, `MIX_SAW`). */
  mix: Float64Array;
  familyA: number;
  familyB: number;
  /** The Shape and Bright the mix was built for; Bright as the exponent β of k. */
  shapeAt: number;
  brightAt: number;
  beta: number;
  /** Per band: its level for Shape and Bright (1 at the defaults). */
  bandGain: Float64Array;
  /** The pitch stage's retune count the band levels were built for. */
  levelsAt: number;
  /** log2 k and k^(2β), k = 0 … the most partials. */
  log2Partial: Float64Array;
  power: Float64Array;
  scratch: Float64Array;
  /** Partials each band generates (the pitch stage's): under the harmonic limit at its centre × ratio. */
  partials: Int32Array;
  /** Octave (step index) and the pitch set as applied and as wanted; the retune's fade. */
  octaveAt: number;
  pitchesAt: number;
  octaveWanted: number;
  pitchesWanted: number;
  switching: boolean;
  gain: number;
  gainStep: number;
  fadeStep: number;

  constructor(
    rate: number,
    hostRate: number,
    slots: Float64Array,
    controls: Float64Array,
    envelope: BloomEnvelope,
  ) {
    this.shapeAt = this.brightAt = this.beta = NaN;
    this.gain = this.gainStep = this.fadeStep = NaN;
    this.slots = slots;
    this.controls = controls;
    this.envelope = envelope;
    this.tables = bloomTables(hostRate);
    this.pitch = new BloomGeneratorPitch(rate, hostRate, envelope, envelope.bands.centre);
    this.partials = this.pitch.partials;
    this.mix = new Float64Array(MIX_SLOTS);
    this.familyA = MIX_SAW;
    this.familyB = MIX_SAW;
    this.bandGain = new Float64Array(BLOOM_BANDS.count).fill(1);
    const most = this.tables.maxPartials;
    this.log2Partial = new Float64Array(most + 1);
    for (let k = 1; k <= most; k++) {
      this.log2Partial[k] = k;
      log2InPlace(this.log2Partial, k);
    }
    this.power = new Float64Array(most + 1).fill(1);
    this.scratch = new Float64Array(1);
    this.levelsAt = -1;
    this.fadeStep = 1 / (C.switchSeconds * rate);
    this.gain = 1;
    this.gainStep = 0;
    this.switching = false;
    this.octaveAt = this.pitchesAt = -1;
    this.octaveWanted = BLOOM_GENERATOR_UNISON;
    this.pitchesWanted = BLOOM_PITCHES_ALL;
    this.want();
    this.retune();
    this.reshape();
  }

  /** Once a block: Shape and Bright reshape; Octave and the pitch set retune behind a fade. */
  configure(): void {
    this.reshape();
    if (this.levelsAt !== this.pitch.tuning) this.levels();
    this.want();
    if (this.octaveWanted === this.octaveAt && this.pitchesWanted === this.pitchesAt) return;
    if (this.envelope.soundingCount === 0) {
      this.retune();
      this.gain = 1;
      this.gainStep = 0;
      this.switching = false;
      return;
    }
    this.switching = true;
    this.gainStep = -this.fadeStep;
  }

  /** The mix and the band levels for this block's Shape and Bright, if either moved. */
  reshape(): void {
    const shapes = BLOOM_BOUNDS.shape,
      brights = BLOOM_BOUNDS.bright;
    let shape = this.controls[SLOT_SHAPE],
      bright = this.controls[SLOT_BRIGHT];
    // Clamped; NaN reads as the default.
    if (!(shape >= shapes[0])) shape = shape < shapes[0] ? shapes[0] : BLOOM_DEFAULTS.shape;
    else if (shape > shapes[1]) shape = shapes[1];
    if (!(bright >= brights[0])) bright = bright < brights[0] ? brights[0] : BLOOM_DEFAULTS.bright;
    else if (bright > brights[1]) bright = brights[1];
    if (shape === this.shapeAt && bright === this.brightAt) return;
    const mix = this.mix;
    mix[MIX_T] = shape;
    bloomShapeMix(mix);
    const region = mix[MIX_REGION];
    this.familyA = region === 0 ? MIX_SINE : region === 1 ? MIX_TRIANGLE : MIX_SAW;
    this.familyB = region === 0 ? MIX_TRIANGLE : MIX_SAW;
    if (bright !== this.brightAt) {
      this.beta = bright * C.log2PerDecibel;
      const power = this.power,
        log2 = this.log2Partial,
        scratch = this.scratch;
      for (let k = 1; k < power.length; k++) {
        scratch[0] = 2 * this.beta * log2[k];
        exp2InPlace(scratch, 0);
        power[k] = scratch[0];
      }
    }
    this.shapeAt = shape;
    this.brightAt = bright;
    this.levels();
  }

  /** Every band's level for the mix and Bright: the saw's power as heard over its own, times Bright's tilt. */
  levels(): void {
    this.levelsAt = this.pitch.tuning;
    const gains = this.bandGain;
    if (this.shapeAt === BLOOM_GENERATOR_SAW_SHAPE && this.brightAt === 0) {
      gains.fill(1);
      return;
    }
    const mix = this.mix,
      tables = this.tables,
      power = this.power,
      pulse = mix[MIX_REGION] === BLOOM_GENERATOR_PULSE_REGION,
      centre = this.envelope.bands.centre,
      ratio = this.pitch.ratio,
      scratch = this.scratch;
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      const f0 = centre[b] * ratio[b],
        count = tables.counts[tables.levelOf[Math.min(this.partials[b], tables.maxPartials)]];
      let heard = 0,
        saw = 0,
        previous = 0,
        current = 0;
      if (pulse) {
        bloomPulseSine(mix);
        current = mix[MIX_WEIGHT];
      }
      for (let k = 1; k <= count; k++) {
        const x = (k * f0) / C.rolloffHz,
          y = (k * f0) / C.levelCornerHz;
        const roll = 1 / ((1 + x * x) * (1 + y * y));
        let w: number;
        if (pulse) {
          w = current / k;
          const next = 2 * mix[MIX_COS] * current - previous;
          previous = current;
          current = next;
        } else {
          bloomMixWeight(mix, k);
          w = mix[MIX_WEIGHT];
        }
        heard += w * w * power[k] * roll;
        saw += roll / (k * k);
      }
      // (pivot / f0)^β, so the tone's tilt (f / pivot)^β leaves partial k at k^β.
      scratch[0] = C.tiltPivotHz / f0;
      log2InPlace(scratch, 0);
      scratch[0] *= this.beta;
      exp2InPlace(scratch, 0);
      gains[b] = heard > 0 ? Math.sqrt(saw / heard) * scratch[0] : 0;
    }
  }

  /** Octave (nearest step) and the pitch set (whole; 0 or out of range is every class) from this block's controls. */
  want(): void {
    const value = this.controls[SLOT_OCTAVE];
    let best = BLOOM_GENERATOR_UNISON,
      distance = Math.abs(value);
    for (let i = 0; i < BLOOM_OCTAVES.length; i++) {
      const d = Math.abs(BLOOM_OCTAVES[i] - value);
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    this.octaveWanted = best;
    const pitches = Math.round(this.controls[SLOT_PITCHES]);
    this.pitchesWanted = pitches >= 1 && pitches <= BLOOM_PITCHES_ALL ? pitches : BLOOM_PITCHES_ALL;
  }

  /** The wanted Octave and pitch set applied to every band. */
  retune(): void {
    this.pitch.retune(this.octaveWanted, this.pitchesWanted);
    this.octaveAt = this.octaveWanted;
    this.pitchesAt = this.pitchesWanted;
  }

  clear(): void {
    if (this.switching) this.retune();
    this.switching = false;
    this.gain = 1;
    this.gainStep = 0;
    this.pitch.restart();
  }

  tick(): void {
    if (this.switching) this.fade();
    this.pitch.tick();
  }

  /** The retune's dip: down to 0, retune, back up to 1. */
  fade(): void {
    this.gain += this.gainStep;
    if (this.gainStep < 0 && this.gain <= 0) {
      this.gain = 0;
      this.retune();
      this.gainStep = this.fadeStep;
    } else if (this.gainStep > 0 && this.gain >= 1) {
      this.gain = 1;
      this.gainStep = 0;
      this.switching = false;
    }
  }
}

export { BloomGenerator };
