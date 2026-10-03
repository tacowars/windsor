/* eslint-disable no-magic-numbers -- DSP: the 4-ms cut fade, MIDI 60 and the pan law are the voice's lifecycle arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * `Voice` (#645): one note's state — four operators' phase, output, feedback
 * history, amplitude ramps and their knots (windsor#301), width ramps, six
 * envelopes, two LFOs, each Noise operator's colour (windsor#362) and
 * the generic loop's noise draws (windsor#389), the
 * drive stage (windsor#300), three filter stages (the third for the Formant
 * mode's three peaks, windsor#331), the steal fade, a step's offsets and
 * the voice's own and live values by target code (windsor#17, windsor#346,
 * windsor#419) and the feedback ramp — and its lifecycle: `start`, `rebind`, `retarget`,
 * `release`, `kill`, `steal`, and the `dormant` / `fading` / `finished` reads
 * the part polls, whose logic is `voiceQuiet.ts`. The hot paths are functions over the voice in `voiceControl.js`,
 * `voiceRender.js` and `voiceKernel.js`; `render` and `updateControl` stay
 * methods because the part and the tests call them on the voice. Invariant:
 * every buffer is allocated here, once; nothing after construction allocates.
 * Every double field is first written as NaN, then its start value, so V8
 * never changes its representation (rule 7, windsor#233).
 * `fmProcessorDormancy.test.ts` pins `dormant` and the lifecycle;
 * `fmProcessor.test.ts` the stealing order; `fmProcessorAllocation.test.ts`
 * the allocation.
 */

import type { Algorithm } from './algorithms';
import type { WorkletPatch } from './patchNormalise';
import { ALGORITHMS, ALG_ORDER } from './algorithms';
import { Envelope, ST_IDLE } from './envelope';
import { ENVELOPE_BREAKS_MAX } from './fmConstants';
import { Lfo, secondLfoSeed } from './lfo';
import { NoiseColour } from './noiseColour';
import { randomSeed32 } from './prng';
import { Svf } from './svf';
import { VoiceDrive } from './voiceDrive';
import { bindVoiceConstants, updateVoiceControl } from './voiceControl';
import { renderVoiceKernel } from './voiceKernel';
import { voiceDormant, voiceFinished, voiceHoldsEndLevel } from './voiceQuiet';
import { renderVoiceGeneric } from './voiceRender';
import { rebindStepMod, retargetStepMod, startStepMod } from './voiceStepMod';
import { VOICE_TARGET_COUNT } from './voiceTargetTables';
import { KIND_PULSE, waveKind } from './waveTables';

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
  ampBreak: Int32Array;
  ampKnot: Int32Array;
  knotAmp: Float32Array;
  knotInc: Float32Array;
  knotGap: Int32Array;
  width: Float32Array;
  widthInc: Float32Array;
  kind: Int32Array;
  tables: (Float32Array | null)[];
  mips: (Float32Array[] | null)[];
  ampEnv: Envelope[];
  filtEnv: Envelope;
  pitchEnv: Envelope;
  lfo: Lfo;
  lfo2: Lfo;
  svfA: Svf;
  svfB: Svf;
  /** The Formant mode's third peak (windsor#331); A and B are its first two. */
  svfC: Svf;
  /** Each operator's noise colour (windsor#362): run only for a Noise operator with a field set. */
  noiseColour: NoiseColour[];
  /** Each Noise operator's draw this sample in the generic loop, drawn D..A at its top (windsor#389). */
  noiseDraw: Float64Array;
  drive: VoiceDrive;
  noiseSeed: number;
  active: boolean;
  gate: boolean;
  fade: number;
  fadeInc: number;
  note: number;
  velocity: number;
  age: number;
  voiceId: number;
  /** The part's note map holds this voice under `voiceId` (windsor#233: a flag, not a `Map`). */
  keyed: boolean;
  detune: number;
  /** The note's pan before the clamp, and the pitch a glide starts from (NaN: none): `start` reads both. */
  pan: number;
  glideFrom: number;
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
  stepOffsets: Float64Array;
  ownValues: Float64Array;
  partControls: Float64Array;
  opFreq: Float64Array;
  lfoLevel: number;
  lfo2Level: number;
  partOffsets: Float64Array;
  partFloors: Float64Array;
  liveValues: Float64Array;
  fbFrom: Float32Array;
  fbTo: Float32Array;
  fbRamp: number;
  decayRebound: Float64Array;

  /**
   * `partControls` is the part's one array of k-rate controls (`PART_BEND`,
   * …), `partOffsets` its song lanes' offsets by target code
   * (windsor#346), and `partFloors` the floor each target a lane moves
   * plays at least (a decay time's, windsor#347; an LFO rate's,
   * windsor#419), all shared by every voice.
   */
  // eslint-disable-next-line max-lines-per-function -- every field written once, the doubles NaN first (rule 7): the voice's whole state, read top to bottom
  constructor(
    sampleRate: number,
    random: () => number,
    partControls: Float64Array,
    partOffsets: Float64Array,
    partFloors: Float64Array,
  ) {
    // Rule 7: each double field is born a double (NaN), before its start
    // value; the noise seed is a uint32, past a small integer's range. `age`
    // counts frames, past 2^31 after about 12 hours held (a dormant drone
    // too); `voiceId` is the sender's handle, which counts notes without
    // bound; `note` is the message's number, which no contract keeps whole.
    this.noiseSeed = this.fade = this.fadeInc = this.velocity = this.detune = NaN;
    this.age = this.voiceId = this.note = NaN;
    this.pan = this.glideFrom = NaN;
    this.panL = this.panR = this.pitchCur = this.pitchTarget = this.mod = NaN;
    this.glideSeconds = NaN;
    this.lfoLevel = this.lfo2Level = NaN;
    this.sr = sampleRate;
    this.random = random; // the processor's one source; see "Randomness" above
    this.partControls = partControls;
    // Control-rate scratch (windsor#233): each operator's frequency and the
    // two LFO levels this block, which the width update reads.
    this.opFreq = new Float64Array(4);
    this.lfoLevel = this.lfo2Level = 0;

    // Per-operator running state
    this.phase = new Float64Array(4);
    this.phaseInc = new Float64Array(4);
    this.out = new Float32Array(4); // this sample's operator outputs
    this.fb1 = new Float32Array(4); // previous output, for feedback
    this.fb2 = new Float32Array(4); // one before that
    this.amp = new Float32Array(4); // interpolated amplitude
    this.ampInc = new Float32Array(4);
    // Envelope edges at their own samples (windsor#301): `ampBreak` counts
    // the samples to an operator's next knot (0: none this block) and
    // `ampKnot` is that knot's slot in its row of ENVELOPE_BREAKS_MAX. At the
    // knot the ramp lands on `knotAmp`, takes `knotInc` and counts `knotGap`
    // to the one after (0: the block's last). `updateOperatorAmp` writes them.
    this.ampBreak = new Int32Array(4);
    this.ampKnot = new Int32Array(4);
    this.knotAmp = new Float32Array(4 * ENVELOPE_BREAKS_MAX);
    this.knotInc = new Float32Array(4 * ENVELOPE_BREAKS_MAX);
    this.knotGap = new Int32Array(4 * ENVELOPE_BREAKS_MAX);
    // Width (#55), as the loops read it: the duty for PULSE, and for every
    // other wave the phase scale 1 / width, so the squeeze is a multiply.
    // Ramped per sample like `amp`; exactly 1 and still is the plain wave.
    this.width = new Float32Array(4).fill(1);
    this.widthInc = new Float32Array(4);
    this.kind = new Int32Array(4);
    this.tables = [null, null, null, null]; // active mip for each operator
    this.mips = [null, null, null, null]; // full mip set for each operator

    this.ampEnv = [new Envelope(), new Envelope(), new Envelope(), new Envelope()];
    this.filtEnv = new Envelope();
    this.pitchEnv = new Envelope();
    this.lfo = new Lfo(randomSeed32(random));
    // Seeded from LFO 1, not drawn: the part's random stream stays where it was (#55).
    this.lfo2 = new Lfo(secondLfoSeed(this.lfo.seed));
    this.svfA = new Svf();
    this.svfB = new Svf();
    // Formant (windsor#331): three peaks in parallel, A, B and C.
    this.svfC = new Svf();
    this.noiseColour = [new NoiseColour(), new NoiseColour(), new NoiseColour(), new NoiseColour()];
    // The generic loop's noise draws (windsor#389): a double store and load
    // are exact, so a Noise operator reads the value `noise()` returned.
    this.noiseDraw = new Float64Array(4);
    this.drive = new VoiceDrive();

    this.noiseSeed = randomSeed32(random);

    this.active = false;
    this.gate = false;
    this.fade = 1; // steal fade, 1 -> 0
    this.fadeInc = 0;
    this.note = 60;
    this.velocity = 1;
    this.age = 0;
    this.voiceId = 0;
    this.keyed = false;
    this.detune = 0; // semitones, for unison spread
    this.pan = 0;
    this.glideFrom = NaN;
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
    // part's switch, always on in live playback; `kernel` is whether the
    // bound patch can take the kernel exactly (see `ALG_EDGES`).
    this.specialise = true;
    this.kernel = false;
    this.edges = 0;
    this.carrierBits = 0;
    this.detuneMul = new Float64Array(4); // Math.pow(2, detune / 1200)
    this.levelKeyAmp = new Float64Array(4); // Math.pow(2, -levelKeyScale * keyOffset)

    // The voice's targets by code (windsor#419, `voiceTargetTables.ts`): a
    // step's offsets (windsor#17), and the values the voice plays without and
    // with the song's lanes. `ownValues` is the patch's with the step's
    // (`bindOwnValues`), `liveValues` those with the part's lane offsets,
    // each control block (`voiceOffsets.ts`), and every consumer reads it.
    this.stepOffsets = new Float64Array(VOICE_TARGET_COUNT);
    this.ownValues = new Float64Array(VOICE_TARGET_COUNT);
    this.liveValues = new Float64Array(VOICE_TARGET_COUNT);

    // Song automation (windsor#346): the part's offsets and floors, and each
    // operator's feedback ramp across the block (`fbRamp`, a bit per ramping operator).
    this.partOffsets = partOffsets;
    this.partFloors = partFloors;
    this.fbFrom = new Float32Array(4);
    this.fbTo = new Float32Array(4);
    this.fbRamp = 0;
    // Each operator's decay curve a rebind holds until its lane resyncs (windsor#347): the offset then, NaN for none.
    this.decayRebound = new Float64Array(4).fill(NaN);
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

  /**
   * Bind a patch, its prebuilt wavetables and the step's offsets (windsor#17).
   * Called on note-on, once the part has written the note's `note`,
   * `velocity`, `detune`, `pan` and `glideFrom` into the voice: no double is
   * passed to a call V8 may not inline (windsor#233, windsor#270), and an
   * options object would allocate one per note-on.
   */
  start(
    patch: WorkletPatch,
    waveSets: (Float32Array[] | null)[],
    voiceId: number,
    stepMod: ArrayLike<number> | null | undefined,
  ): void {
    this.patch = patch;
    this.alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
    this.order = ALG_ORDER[patch.algorithm] || ALG_ORDER[0];
    const note = this.note;
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
    const glideFrom = this.glideFrom;
    this.pitchCur = glideFrom === glideFrom ? glideFrom : note;

    // Clamped to ±1, as `Math.max(-1, Math.min(1, pan))`, NaN and -0 alike.
    const pan = this.pan;
    const p = pan < -1 ? -1 : pan > 1 ? 1 : pan;
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
      this.ampBreak[i] = 0;

      this.kind[i] = waveKind(op.wave);
      this.mips[i] = waveSets[i];
      this.tables[i] = waveSets[i] ? waveSets[i]![0] : null;

      this.ampEnv[i].configure(op.env, this.sr);
      this.ampEnv[i].timeScale = Math.pow(2, -op.env.keyScale * keyOffset);
      this.ampEnv[i].noteOn();
      this.noiseColour[i].reset();
    }
    this.bindConstants(patch);

    this.filtEnv.configure(patch.filter.env, this.sr);
    this.filtEnv.timeScale = Math.pow(2, -patch.filter.env.keyScale * keyOffset);
    this.filtEnv.noteOn();

    this.pitchEnv.configure(patch.pitchEnv, this.sr);
    this.pitchEnv.timeScale = 1;
    this.pitchEnv.noteOn();

    // A one-shot LFO always starts from the top of its run (#55).
    this.lfo.reset(patch.lfo.retrigger || patch.lfo.oneShot);
    this.lfo2.reset(patch.lfo2.retrigger || patch.lfo2.oneShot);
    this.svfA.reset();
    this.svfB.reset();
    this.svfC.reset();
    this.drive.reset();

    // The step's offsets (windsor#17) and the song's lanes (windsor#346), and
    // the width ramps from the note's width; the first control block sets their step.
    startStepMod(this, patch, stepMod);
  }

  /**
   * Re-point a sounding voice at a new patch (the console's live knobs). Phase,
   * amplitude ramps and envelope stages carry on; only the parameter blocks
   * they read change, so a ratio, level or filter knob is heard on the next
   * control block instead of the next note. A wave or algorithm switch steps
   * audibly -- acceptable while designing a sound, which is why `liveRetune`
   * is off by default and a part keeps the click-free note-on binding.
   * `slotTargets` is the part's slot map: a target a song lane moves keeps
   * the lane's value across the rebind (windsor#346).
   */
  rebind(patch: WorkletPatch, waveSets: (Float32Array[] | null)[], slotTargets: Int32Array): void {
    this.patch = patch;
    this.alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
    this.order = ALG_ORDER[patch.algorithm] || ALG_ORDER[0];
    const keyOffset = (this.note - 60) / 12;
    let switched = 0;
    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];
      const wasPulse = this.kind[i] === KIND_PULSE;
      this.kind[i] = waveKind(op.wave);
      if (wasPulse !== (this.kind[i] === KIND_PULSE)) switched |= 1 << i;
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
    // The note keeps its step's offsets and its lanes over the new patch's
    // values (windsor#17, windsor#346), and a wave switch between PULSE and
    // the rest restarts that operator's width ramp from the width it plays.
    rebindStepMod(this, patch, switched, slotTargets);
  }

  /**
   * Legato slide (#602): re-point a sounding voice at a new note. The pitch
   * glides from wherever it is over `glideSeconds`; envelopes, LFO, phase and
   * filter state carry on, so nothing retriggers. The constants that depend on
   * the key offset are recomputed for the new note, as `rebind` does. The new
   * step's offsets apply from here, except the rows a sounding voice cannot
   * change without a click (`slideKeeps`: decay curve, feedback), which keep
   * the old step's (windsor#17), and each envelope keeps the decay curve it
   * plays, a lane's too (`retargetStepMod`, windsor#405).
   */
  retarget(
    note: number,
    velocity: number,
    mod: number,
    glideSeconds: number,
    stepMod: ArrayLike<number> | null | undefined,
  ): void {
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
    retargetStepMod(this, patch, stepMod);
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
      // A knot still pending would set the level back (windsor#301).
      this.ampBreak[i] = 0;
    }
  }

  /**
   * A quick fade over ~4 ms, then free the slot: the mono cut and a held End
   * level. A full pool's steal is `voiceSteal.ts`'s 30 ms (windsor#410).
   */
  steal(): void {
    if (!this.active) return;
    this.gate = false;
    this.fadeInc = -1 / (0.004 * this.sr);
  }

  /** Dormant (#547): the part may skip this gated voice's work (`voiceQuiet.ts`). */
  get dormant(): boolean {
    return voiceDormant(this);
  }

  /**
   * After a render: a released voice ends once nothing is left to hear
   * (`finished`), and one whose envelopes ended at a held End level fades out
   * with `steal` instead (windsor#7). A gated or fading voice is left alone.
   * The fade starts only at the quantum's end (`quantumEnd`), never where
   * another event split the quantum, so a split render is the unsplit one's
   * bits (windsor#323).
   */
  settle(quantumEnd: boolean): void {
    if (this.gate || this.fadeInc !== 0) return;
    if (voiceFinished(this)) this.active = false;
    else if (quantumEnd && voiceHoldsEndLevel(this)) this.steal();
  }

  /** A voice that is fading out is no longer available, but still sounding. */
  get fading(): boolean {
    return this.fadeInc !== 0;
  }

  /** Nothing left to hear: carriers ended, ramps at ~0, filter quiet (`voiceQuiet.ts`, windsor#7). */
  get finished(): boolean {
    return voiceFinished(this);
  }

  /**
   * Control-rate update, `voiceControl.js`: envelopes, LFOs, glide, ramps,
   * filter coefficients, from the part's controls in `partControls`.
   */
  updateControl(n: number): void {
    updateVoiceControl(this, n);
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
