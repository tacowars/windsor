/* eslint-disable no-magic-numbers -- DSP: the 4-ms steal fade, MIDI 60 and the pan law are the voice's lifecycle arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * `Voice` (#645): one note's state — four operators' phase, output, feedback
 * history and amplitude ramps, six envelopes, an LFO, two filter stages, the
 * steal fade — and its lifecycle: `start`, `rebind`, `retarget`, `release`,
 * `kill`, `steal`, and the `dormant` / `fading` / `finished` reads the part
 * polls. The hot paths are functions over the voice in `voiceControl.js`,
 * `voiceRender.js` and `voiceKernel.js`; `render` and `updateControl` stay
 * methods because the part and the tests call them on the voice. Invariant:
 * every buffer is allocated here, once; nothing after construction allocates.
 * `fmProcessorDormancy.test.ts` pins `dormant` and the lifecycle;
 * `fmProcessor.test.ts` the stealing order.
 */

import type { Algorithm } from './algorithms';
import type { WorkletPatch } from './patchNormalise';
import { ALGORITHMS, ALG_ORDER } from './algorithms';
import { Envelope, ST_IDLE, ST_SUSTAIN } from './envelope';
import { DORMANT_AMP } from './fmConstants';
import { Lfo } from './lfo';
import { randomSeed32 } from './prng';
import { FILT_OFF, Svf } from './svf';
import { bindVoiceConstants, updateVoiceControl } from './voiceControl';
import { renderVoiceKernel } from './voiceKernel';
import { renderVoiceGeneric } from './voiceRender';
import { waveKind } from './waveTables';

/* ------------------------------------------------------------------ *
 * Voice — four operators, a filter, and the modulation that feeds them.
 *
 * Every buffer here is allocated once at construction. render() must not
 * allocate: it runs on the audio thread and a GC pause is an audible dropout.
 * ------------------------------------------------------------------ */

class Voice {
  sr: number;
  random: () => number;
  phase: Float64Array;
  phaseInc: Float64Array;
  out: Float32Array;
  fb1: Float32Array;
  fb2: Float32Array;
  amp: Float32Array;
  ampInc: Float32Array;
  kind: Int32Array;
  tables: (Float32Array | null)[];
  mips: (Float32Array[] | null)[];
  ampEnv: Envelope[];
  filtEnv: Envelope;
  pitchEnv: Envelope;
  lfo: Lfo;
  svfA: Svf;
  svfB: Svf;
  noiseSeed: number;
  active: boolean;
  gate: boolean;
  fade: number;
  fadeInc: number;
  note: number;
  velocity: number;
  age: number;
  voiceId: number;
  detune: number;
  panL: number;
  panR: number;
  pitchCur: number;
  pitchTarget: number;
  mod: number;
  glideSeconds: number;
  ctrlCount: number;
  patch: WorkletPatch | null;
  alg: Algorithm;
  order: number[];
  specialise: boolean;
  kernel: boolean;
  edges: number;
  carrierBits: number;
  detuneMul: Float64Array;
  levelKeyAmp: Float64Array;

  constructor(sampleRate: number, random: () => number) {
    this.sr = sampleRate;
    this.random = random; // the processor's one source; see "Randomness" above

    // Per-operator running state
    this.phase = new Float64Array(4);
    this.phaseInc = new Float64Array(4);
    this.out = new Float32Array(4); // this sample's operator outputs
    this.fb1 = new Float32Array(4); // previous output, for feedback
    this.fb2 = new Float32Array(4); // one before that
    this.amp = new Float32Array(4); // interpolated amplitude
    this.ampInc = new Float32Array(4);
    this.kind = new Int32Array(4);
    this.tables = [null, null, null, null]; // active mip for each operator
    this.mips = [null, null, null, null]; // full mip set for each operator

    this.ampEnv = [new Envelope(), new Envelope(), new Envelope(), new Envelope()];
    this.filtEnv = new Envelope();
    this.pitchEnv = new Envelope();
    this.lfo = new Lfo(random);
    this.svfA = new Svf();
    this.svfB = new Svf();

    this.noiseSeed = randomSeed32(random);

    this.active = false;
    this.gate = false;
    this.fade = 1; // steal fade, 1 -> 0
    this.fadeInc = 0;
    this.note = 60;
    this.velocity = 1;
    this.age = 0;
    this.voiceId = 0;
    this.detune = 0; // semitones, for unison spread
    this.panL = 0.707;
    this.panR = 0.707;

    this.pitchCur = 60;
    this.pitchTarget = 60;

    // Per-note accent and slide (#602): `mod` is added to the wheel wherever
    // it is read; `glideSeconds` is a slide's own time, 0 until a retarget.
    this.mod = 0;
    this.glideSeconds = 0;

    this.ctrlCount = 0;
    this.patch = null;
    this.alg = ALGORITHMS[0];
    this.order = ALG_ORDER[0];

    // The fixed-index kernel and per-note constants (#548). `specialise` is the
    // part's switch, on in the game and the console; `kernel` is whether the
    // bound patch can take the kernel exactly (see `ALG_EDGES`).
    this.specialise = true;
    this.kernel = false;
    this.edges = 0;
    this.carrierBits = 0;
    this.detuneMul = new Float64Array(4); // Math.pow(2, detune / 1200)
    this.levelKeyAmp = new Float64Array(4); // Math.pow(2, -levelKeyScale * keyOffset)
  }

  /** Routing and per-note constants for the bound patch, `voiceControl.js`; `start`, `rebind` and `retarget` call it. */
  bindConstants(patch: WorkletPatch): void {
    bindVoiceConstants(this, patch);
  }

  noise(): number {
    let x = this.noiseSeed;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.noiseSeed = x;
    return x / 0x7fffffff - 1;
  }

  /** Bind a patch and its prebuilt wavetables. Called on note-on. */
  // Gathering these into an options object would allocate one per note-on, and
  // this class exists to keep the audio thread allocation-free. They are also
  // all primitives written straight into preallocated fields, so there is no
  // cohesive sub-object to extract.
  // eslint-disable-next-line max-params -- allocation-free note-on, see above
  start(
    patch: WorkletPatch,
    waveSets: (Float32Array[] | null)[],
    note: number,
    velocity: number,
    detune: number,
    pan: number,
    glideFrom: number | null,
    voiceId: number,
  ): void {
    this.patch = patch;
    this.alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
    this.order = ALG_ORDER[patch.algorithm] || ALG_ORDER[0];
    this.note = note;
    this.velocity = velocity;
    this.detune = detune;
    this.voiceId = voiceId;
    this.active = true;
    this.gate = true;
    this.fade = 1;
    this.fadeInc = 0;
    this.age = 0;
    this.ctrlCount = 0;
    this.mod = 0;
    this.glideSeconds = 0;

    this.pitchTarget = note;
    this.pitchCur = glideFrom == null ? note : glideFrom;

    const p = Math.max(-1, Math.min(1, pan));
    const theta = ((p + 1) * Math.PI) / 4;
    this.panL = Math.cos(theta);
    this.panR = Math.sin(theta);

    const keyOffset = (note - 60) / 12;

    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];
      this.phase[i] = op.phaseFree ? this.random() : op.phase;
      this.out[i] = 0;
      this.fb1[i] = 0;
      this.fb2[i] = 0;
      this.amp[i] = 0;
      this.ampInc[i] = 0;

      this.kind[i] = waveKind(op.wave);
      this.mips[i] = waveSets[i];
      this.tables[i] = waveSets[i] ? waveSets[i]![0] : null;

      this.ampEnv[i].configure(op.env, this.sr);
      this.ampEnv[i].timeScale = Math.pow(2, -op.env.keyScale * keyOffset);
      this.ampEnv[i].noteOn();
    }
    this.bindConstants(patch);

    this.filtEnv.configure(patch.filter.env, this.sr);
    this.filtEnv.timeScale = Math.pow(2, -patch.filter.env.keyScale * keyOffset);
    this.filtEnv.noteOn();

    this.pitchEnv.configure(patch.pitchEnv, this.sr);
    this.pitchEnv.timeScale = 1;
    this.pitchEnv.noteOn();

    this.lfo.reset(patch.lfo.retrigger);
    this.svfA.reset();
    this.svfB.reset();
  }

  /**
   * Re-point a sounding voice at a new patch (the console's live knobs). Phase,
   * amplitude ramps and envelope stages carry on; only the parameter blocks
   * they read change, so a ratio, level or filter knob is heard on the next
   * control block instead of the next note. A wave or algorithm switch steps
   * audibly -- acceptable while designing a sound, which is why the game never
   * sends `liveRetune` and keeps the click-free note-on binding.
   */
  rebind(patch: WorkletPatch, waveSets: (Float32Array[] | null)[]): void {
    this.patch = patch;
    this.alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
    this.order = ALG_ORDER[patch.algorithm] || ALG_ORDER[0];
    const keyOffset = (this.note - 60) / 12;
    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];
      this.kind[i] = waveKind(op.wave);
      this.mips[i] = waveSets[i];
      this.tables[i] = waveSets[i] ? waveSets[i]![0] : null;
      // configure() swaps the parameter block and leaves the stage and value alone.
      this.ampEnv[i].configure(op.env, this.sr);
      this.ampEnv[i].timeScale = Math.pow(2, -op.env.keyScale * keyOffset);
    }
    this.bindConstants(patch);
    this.filtEnv.configure(patch.filter.env, this.sr);
    this.filtEnv.timeScale = Math.pow(2, -patch.filter.env.keyScale * keyOffset);
    this.pitchEnv.configure(patch.pitchEnv, this.sr);
  }

  /**
   * Legato slide (#602): re-point a sounding voice at a new note. The pitch
   * glides from wherever it is over `glideSeconds`; envelopes, LFO, phase and
   * filter state carry on, so nothing retriggers. The constants that depend on
   * the key offset are recomputed for the new note, as `rebind` does.
   */
  retarget(note: number, velocity: number, mod: number, glideSeconds: number): void {
    const patch = this.patch!;
    this.note = note;
    this.pitchTarget = note;
    this.velocity = velocity;
    this.mod = mod;
    this.glideSeconds = glideSeconds;
    const keyOffset = (note - 60) / 12;
    for (let i = 0; i < 4; i++) {
      this.ampEnv[i].timeScale = Math.pow(2, -patch.ops[i].env.keyScale * keyOffset);
    }
    this.filtEnv.timeScale = Math.pow(2, -patch.filter.env.keyScale * keyOffset);
    this.bindConstants(patch);
  }

  release(): void {
    if (!this.active) return;
    this.gate = false;
    for (let i = 0; i < 4; i++) this.ampEnv[i].noteOff();
    this.filtEnv.noteOff();
    this.pitchEnv.noteOff();
  }

  /** Immediate stop. Clicks — reserved for panic and for last-resort stealing. */
  kill(): void {
    this.active = false;
    this.gate = false;
    this.fade = 1;
    this.fadeInc = 0;
    for (let i = 0; i < 4; i++) {
      this.ampEnv[i].state = ST_IDLE;
      // An idle envelope still returns its last value, and the rest of the
      // block is rendered before `process` re-reads `active` (#453): without
      // this the next control update ramps a killed voice straight back to
      // full level, so the graceful steal ends in the click it exists to
      // avoid. `noteOn` re-seeds the value, so a reused slot is unaffected.
      this.ampEnv[i].value = 0;
      this.amp[i] = 0;
      this.ampInc[i] = 0;
    }
  }

  /** Graceful stealing: fade out over ~4 ms, then free the slot. */
  steal(): void {
    if (!this.active) return;
    this.gate = false;
    this.fadeInc = -1 / (0.004 * this.sr);
  }

  /**
   * Dormant (#547): gated, every carrier held in sustain at level 0 with an
   * `endLevel` of 0, its amplitude ramp at ~0 and any filter no longer ringing.
   * The part skips its control and render work; nothing it would have rendered
   * is audible. Skipping freezes the pitch, filter and LFO state too, so the
   * end-level condition matters: a release rising to a non-zero end level is
   * sound, and would be heard from that frozen state. Excluding it means a
   * dormant voice's note-off is silence, and the voice can simply end. Read at
   * control boundaries, so a live retune that raises a sustain wakes the voice
   * from its frozen state with the ordinary amplitude ramp up from ~0.
   * Allocates nothing.
   */
  get dormant(): boolean {
    if (!this.gate || this.fadeInc !== 0) return false;
    const carriers = this.alg.carriers;
    for (let c = 0; c < carriers.length; c++) {
      const i = carriers[c];
      const env = this.ampEnv[i];
      if (env.state !== ST_SUSTAIN || env.p!.sustainLevel !== 0) return false;
      if (env.p!.endLevel !== 0) return false;
      if (Math.abs(this.amp[i]) > DORMANT_AMP) return false;
    }
    const f = this.patch!.filter;
    if (f.mode === FILT_OFF) return true;
    if (!Svf.quiet(this.svfA)) return false;
    return !f.slope24 || Svf.quiet(this.svfB);
  }

  /** A voice that is fading out is no longer available, but still sounding. */
  get fading(): boolean {
    return this.fadeInc !== 0;
  }

  get finished(): boolean {
    const carriers = this.alg.carriers;
    for (let i = 0; i < carriers.length; i++) {
      if (!this.ampEnv[carriers[i]].finished) return false;
    }
    return true;
  }

  /** Control-rate update, `voiceControl.js`: envelopes, LFO, glide, ramps, filter coefficients. */
  updateControl(n: number, bend: number, wheel: number, cutoffMod: number): void {
    updateVoiceControl(this, n, bend, wheel, cutoffMod);
  }

  /**
   * Render `n` samples into the part's stereo accumulators starting at `off`:
   * the fixed-index kernel (`voiceKernel.js`) when the bound patch can take it
   * exactly, else the generic loop (`voiceRender.js`). Both are the same
   * arithmetic in the same order; #548 says why the bits agree.
   */
  render(outL: Float32Array, outR: Float32Array, off: number, n: number): void {
    if (this.kernel) renderVoiceKernel(this, outL, outR, off, n);
    else renderVoiceGeneric(this, outL, outR, off, n);
  }
}

export { Voice };
