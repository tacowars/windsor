/* eslint-disable max-lines -- `Voice` and the processor share this file until
   #645 splits the voice along its render-call seams; the leaf units left in
   #644. This is the entry `scripts/build-worklets.mjs` bundles into
   `../generated/fm-processor.js`, the one script every consumer reads
   (docs/log/2026-09-23-643-fm-worklet-is-generated-from-a-source-folder.md). */
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */

/**
 * fmProcessor.js -- 4-operator FM voice engine for AudioWorklet.
 *
 * Runs on the audio thread. The rules for every line under `fm/` are stated
 * in full in ../CLAUDE.md; the two that govern most edits:
 *   1. No allocation in process(): a GC pause is an audible dropout.
 *   2. Bit-identity by construction: the same IEEE operations in the same
 *      order, on every path (#548). `fmProcessorGolden.test.ts` is the gate.
 *
 * Architecture:
 *   - 4 operators, 11 algorithms (`algorithms.js`), per-operator envelope
 *     (`envelope.js`) + feedback
 *   - Operator-style waveforms built from harmonic partials, bandlimited into
 *     per-octave mipmaps (`waveTables.js`; user waveforms are the same path)
 *   - Per-voice TPT state-variable filter (`svf.js`) with its own envelope
 *   - Per-voice LFO (`lfo.js`), pitch envelope, glide
 *   - Sample-accurate note scheduling via a frame-stamped event queue
 *
 * One node == one timbral part. Instantiate several for multi-timbral use.
 * The patch schema and algorithm tables are mirrored in ../../patch.ts;
 * audio/patch.test.ts asserts the two copies cannot drift (#656 shares them).
 * Imports come only from modules in this folder; the bundle joins them into
 * ../generated/fm-processor.js, which is never edited by hand.
 */
import {
  ALGORITHMS,
  ALG_CARRIER_BITS,
  ALG_DESCENDING,
  ALG_EDGES,
  ALG_ORDER,
  A,
  B,
  C,
  D,
  EDGE_BA,
  EDGE_CA,
  EDGE_CB,
  EDGE_DA,
  EDGE_DB,
  EDGE_DC,
} from './algorithms.js';
import { Envelope, ST_IDLE, ST_SUSTAIN } from './envelope.js';
import {
  CTRL_INTERVAL,
  DORMANT_AMP,
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MOD_INDEX_SCALE,
  TABLE_SIZE,
} from './fmConstants.js';
import { Lfo } from './lfo.js';
import { normalisePatch, num } from './patchNormalise.js';
import { makeRandom, randomSeed32 } from './prng.js';
import { FILT_OFF, Svf, softClip } from './svf.js';
import {
  getMips,
  KIND_NOISE,
  KIND_SAW_D,
  KIND_SQUARE_D,
  KIND_TABLE,
  mipIndex,
  WAVE,
  waveKind,
} from './waveTables.js';

/* ------------------------------------------------------------------ *
 * Voice — four operators, a filter, and the modulation that feeds them.
 *
 * Every buffer here is allocated once at construction. render() must not
 * allocate: it runs on the audio thread and a GC pause is an audible dropout.
 * ------------------------------------------------------------------ */

class Voice {
  constructor(sampleRate, random) {
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

  /**
   * Routing and per-note constants for the bound patch, after `kind` is set:
   * called by `start` and `rebind`, so a live retune of the algorithm, a wave
   * or a detune reaches the next control block. Allocates nothing.
   */
  bindConstants(patch) {
    const algIndex = ALGORITHMS[patch.algorithm] ? patch.algorithm : 0;
    const keyOffset = (this.note - 60) / 12;
    let noiseOps = 0;
    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];
      this.detuneMul[i] = Math.pow(2, op.detune / 1200);
      this.levelKeyAmp[i] = Math.pow(2, -op.levelKeyScale * keyOffset);
      if (this.kind[i] === KIND_NOISE) noiseOps++;
    }
    this.edges = ALG_EDGES[algIndex];
    this.carrierBits = ALG_CARRIER_BITS[algIndex];
    this.kernel = this.specialise && this.edges >= 0 && (noiseOps < 2 || ALG_DESCENDING[algIndex]);
  }

  noise() {
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
  start(patch, waveSets, note, velocity, detune, pan, glideFrom, voiceId) {
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
      this.tables[i] = waveSets[i] ? waveSets[i][0] : null;

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
  rebind(patch, waveSets) {
    this.patch = patch;
    this.alg = ALGORITHMS[patch.algorithm] || ALGORITHMS[0];
    this.order = ALG_ORDER[patch.algorithm] || ALG_ORDER[0];
    const keyOffset = (this.note - 60) / 12;
    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];
      this.kind[i] = waveKind(op.wave);
      this.mips[i] = waveSets[i];
      this.tables[i] = waveSets[i] ? waveSets[i][0] : null;
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
  retarget(note, velocity, mod, glideSeconds) {
    const patch = this.patch;
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

  release() {
    if (!this.active) return;
    this.gate = false;
    for (let i = 0; i < 4; i++) this.ampEnv[i].noteOff();
    this.filtEnv.noteOff();
    this.pitchEnv.noteOff();
  }

  /** Immediate stop. Clicks — reserved for panic and for last-resort stealing. */
  kill() {
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
  steal() {
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
  get dormant() {
    if (!this.gate || this.fadeInc !== 0) return false;
    const carriers = this.alg.carriers;
    for (let c = 0; c < carriers.length; c++) {
      const i = carriers[c];
      const env = this.ampEnv[i];
      if (env.state !== ST_SUSTAIN || env.p.sustainLevel !== 0) return false;
      if (env.p.endLevel !== 0) return false;
      if (Math.abs(this.amp[i]) > DORMANT_AMP) return false;
    }
    const f = this.patch.filter;
    if (f.mode === FILT_OFF) return true;
    if (!Svf.quiet(this.svfA)) return false;
    return !f.slope24 || Svf.quiet(this.svfB);
  }

  /** A voice that is fading out is no longer available, but still sounding. */
  get fading() {
    return this.fadeInc !== 0;
  }

  get finished() {
    const carriers = this.alg.carriers;
    for (let i = 0; i < carriers.length; i++) {
      if (!this.ampEnv[carriers[i]].finished) return false;
    }
    return true;
  }

  /**
   * Control-rate update: advance every envelope and the LFO by CTRL_INTERVAL
   * samples, then set up per-sample amplitude ramps so the audio loop only
   * does adds. Also refreshes filter coefficients.
   */
  updateControl(n, bend, wheel, cutoffMod) {
    const patch = this.patch;
    const lfoP = patch.lfo;
    // The part's wheel plus this note's accent (#602); adding 0 is exact.
    const modWheel = wheel + this.mod;
    const lfoVal =
      this.lfo.advance(lfoP, n, this.sr) * (lfoP.amount + modWheel * lfoP.modWheelDepth);

    // Glide toward the target note: a slide's own time first, else the patch's.
    const glide = this.glideSeconds > 0 ? this.glideSeconds : patch.glide;
    if (glide > 0) {
      const coef = 1 - Math.exp(-n / (glide * this.sr));
      this.pitchCur += (this.pitchTarget - this.pitchCur) * coef;
    } else {
      this.pitchCur = this.pitchTarget;
    }

    const pEnv = this.pitchEnv.advance(n) * patch.pitchEnvAmount;
    const semis = this.pitchCur + this.detune + bend + pEnv + lfoVal * lfoP.toPitch;
    const baseFreq = 440 * Math.pow(2, (semis - 69) / 12);

    const velCurve = this.velocity;
    const keyOffset = (this.note - 60) / 12;

    const specialise = this.specialise;
    for (let i = 0; i < 4; i++) {
      const op = patch.ops[i];

      // The same Math.pow results, computed once per note (#548).
      const detuneMul = specialise ? this.detuneMul[i] : Math.pow(2, op.detune / 1200);
      const freq = op.fixed ? op.fixedHz * detuneMul : baseFreq * op.ratio * detuneMul;
      this.phaseInc[i] = freq / this.sr;

      if (this.kind[i] === KIND_TABLE && this.mips[i]) {
        this.tables[i] = this.mips[i][mipIndex(freq)];
      }

      const env = this.ampEnv[i].advance(n);
      const velAmp = 1 - op.velSens + op.velSens * velCurve;
      const keyAmp = specialise ? this.levelKeyAmp[i] : Math.pow(2, -op.levelKeyScale * keyOffset);
      const lfoAmp = 1 + lfoVal * lfoP.toOp[i];
      const target = env * op.level * op.level * velAmp * keyAmp * (lfoAmp < 0 ? 0 : lfoAmp);

      this.ampInc[i] = (target - this.amp[i]) / n;
    }

    // Filter
    const f = patch.filter;
    if (f.mode !== FILT_OFF) {
      const fenv = this.filtEnv.advance(n);
      // The wheel adds to the envelope amount the way it adds to the LFO's
      // (#586): depth 0 leaves the term exactly as it was.
      const octaves =
        fenv * (f.envAmount + modWheel * f.modWheelDepth) +
        lfoVal * f.lfoAmount +
        f.keyTrack * keyOffset +
        cutoffMod;
      const cutoff = f.cutoff * Math.pow(2, octaves);
      this.svfA.setCoeffs(cutoff, f.resonance, this.sr);
      if (f.slope24) this.svfB.setCoeffs(cutoff, f.resonance, this.sr);
    }

    this.age += n;
  }

  /**
   * Render `n` samples into the part's stereo accumulators starting at `off`.
   * Modulators are evaluated before carriers within the same sample, so there
   * is no one-sample delay in the FM chain; only self-feedback uses history.
   */
  // One sample loop, read top to bottom. The operator pass, the carrier sum and
  // the filter are three stages of a single computation over locals hoisted out
  // of the loop; calling out to helpers per sample would reload them and cost
  // more than the split reads.
  // eslint-disable-next-line max-lines-per-function -- one hot loop, see above
  render(outL, outR, off, n) {
    if (this.kernel) {
      this.renderKernel(outL, outR, off, n);
      return;
    }
    const patch = this.patch;
    const mods = this.alg.mods;
    const carriers = this.alg.carriers;
    const order = this.order;
    const nCar = carriers.length;
    const carGain = 1 / Math.sqrt(nCar);
    const f = patch.filter;
    const mode = f.mode;
    const drive = f.drive;
    const slope24 = f.slope24;
    const gain = patch.volume * carGain;

    let fade = this.fade;
    const fadeInc = this.fadeInc;

    const phase = this.phase,
      phaseInc = this.phaseInc,
      out = this.out;
    const fb1 = this.fb1,
      fb2 = this.fb2,
      amp = this.amp,
      ampInc = this.ampInc;
    const kind = this.kind,
      tables = this.tables;
    const fbAmt = patch.feedbackScratch; // Float32Array(4), refreshed by the part

    for (let s = 0; s < n; s++) {
      for (let oi = 0; oi < 4; oi++) {
        const i = order[oi];
        const a = amp[i];

        // Sum modulators, then add self-feedback on the operator's last two
        // outputs (averaged to damp the buzz single-sample feedback produces).
        let mod = 0;
        const m = mods[i];
        for (let j = 0; j < m.length; j++) {
          const src = m[j];
          mod += out[src] * amp[src];
        }
        mod *= MOD_INDEX_SCALE;
        const fb = fbAmt[i];
        if (fb !== 0) {
          const y = (fb1[i] + fb2[i]) * 0.5;
          mod += fb > 0 ? y * fb * FEEDBACK_SAW_CYCLES : -y * y * fb * FEEDBACK_SQUARE_CYCLES;
        }

        let ph = phase[i] + mod;
        ph -= Math.floor(ph);

        let v;
        switch (kind[i]) {
          case KIND_NOISE:
            v = this.noise();
            break;
          case KIND_SAW_D:
            v = ph * 2 - 1;
            break;
          case KIND_SQUARE_D:
            v = ph < 0.5 ? 1 : -1;
            break;
          default: {
            const t = tables[i];
            const fi = ph * TABLE_SIZE;
            const i0 = fi | 0;
            const frac = fi - i0;
            const s0 = t[i0];
            v = s0 + (t[i0 + 1] - s0) * frac;
            break;
          }
        }

        fb2[i] = fb1[i];
        fb1[i] = v * a;
        out[i] = v;

        phase[i] += phaseInc[i];
        if (phase[i] >= 1) phase[i] -= Math.floor(phase[i]);
        amp[i] = a + ampInc[i];
      }

      let sig = 0;
      for (let c = 0; c < nCar; c++) {
        const i = carriers[c];
        sig += out[i] * amp[i];
      }
      sig *= gain;

      if (fadeInc !== 0) {
        fade += fadeInc;
        if (fade <= 0) {
          fade = 0;
        }
        sig *= fade;
      }

      if (mode !== FILT_OFF) {
        if (drive !== 1) sig = softClip(sig * drive);
        sig = this.svfA.process(sig, mode);
        if (slope24) sig = this.svfB.process(sig, mode);
      }

      const k = off + s;
      outL[k] += sig * this.panL;
      outR[k] += sig * this.panR;
    }

    this.fade = fade;
    if (fadeInc !== 0 && fade <= 0) {
      this.kill();
    }
  }

  /**
   * `render`, with fixed operator indices (#548): see `ALG_EDGES` for why the
   * output is the same bits. Per-operator state lives in locals for the call
   * and is written back at the end; a Float32Array store is a `Math.fround`.
   *
   * An operator whose amplitude is exactly 0 and not ramping for the whole
   * call contributes ±0 to every sum it is in, so its wave is not computed.
   * Its phase still runs, and its feedback history becomes the ±0 the generic
   * loop would have stored. A noise operator is never skipped: its draws
   * advance the voice's shared noise generator.
   */
  // Four operators written out, then the carrier sum and the filter, over locals
  // hoisted out of the loop. The fixed indices and the locals are the saving
  // (docs/research/2026-09-15-548-fm-voice-loop-specialisation); a helper per
  // operator would reload the state through `this` and give it back.
  // eslint-disable-next-line max-lines-per-function -- one hot loop, see above
  renderKernel(outL, outR, off, n) {
    const patch = this.patch;
    const nCar = this.alg.carriers.length;
    const carGain = 1 / Math.sqrt(nCar);
    const f = patch.filter;
    const mode = f.mode;
    const drive = f.drive;
    const slope24 = f.slope24;
    const gain = patch.volume * carGain;
    const panL = this.panL,
      panR = this.panR;

    let fade = this.fade;
    const fadeInc = this.fadeInc;

    const phase = this.phase,
      phaseInc = this.phaseInc,
      out = this.out;
    const fb1 = this.fb1,
      fb2 = this.fb2,
      amp = this.amp,
      ampInc = this.ampInc;
    const kind = this.kind,
      tables = this.tables;
    const fbAmt = patch.feedbackScratch;
    const edges = this.edges,
      carriers = this.carrierBits;

    const kA = kind[A],
      kB = kind[B],
      kC = kind[C],
      kD = kind[D];
    const liveA = kA === KIND_NOISE || amp[A] !== 0 || ampInc[A] !== 0;
    const liveB = kB === KIND_NOISE || amp[B] !== 0 || ampInc[B] !== 0;
    const liveC = kC === KIND_NOISE || amp[C] !== 0 || ampInc[C] !== 0;
    const liveD = kD === KIND_NOISE || amp[D] !== 0 || ampInc[D] !== 0;
    const modBA = liveA && liveB && (edges & EDGE_BA) !== 0;
    const modCA = liveA && liveC && (edges & EDGE_CA) !== 0;
    const modDA = liveA && liveD && (edges & EDGE_DA) !== 0;
    const modCB = liveB && liveC && (edges & EDGE_CB) !== 0;
    const modDB = liveB && liveD && (edges & EDGE_DB) !== 0;
    const modDC = liveC && liveD && (edges & EDGE_DC) !== 0;
    const carA = (carriers & 1) !== 0,
      carB = (carriers & 2) !== 0,
      carC = (carriers & 4) !== 0,
      carD = (carriers & 8) !== 0;

    const tA = tables[A],
      tB = tables[B],
      tC = tables[C],
      tD = tables[D];
    const fbA = fbAmt[A],
      fbB = fbAmt[B],
      fbC = fbAmt[C],
      fbD = fbAmt[D];
    const incA = phaseInc[A],
      incB = phaseInc[B],
      incC = phaseInc[C],
      incD = phaseInc[D];
    const aiA = ampInc[A],
      aiB = ampInc[B],
      aiC = ampInc[C],
      aiD = ampInc[D];
    let phA = phase[A],
      phB = phase[B],
      phC = phase[C],
      phD = phase[D];
    let aA = amp[A],
      aB = amp[B],
      aC = amp[C],
      aD = amp[D];
    let oA = out[A],
      oB = out[B],
      oC = out[C],
      oD = out[D];
    let f1A = fb1[A],
      f1B = fb1[B],
      f1C = fb1[C],
      f1D = fb1[D];
    let f2A = fb2[A],
      f2B = fb2[B],
      f2C = fb2[C],
      f2D = fb2[D];

    for (let s = 0; s < n; s++) {
      if (liveD) {
        const a = aD;
        let mod = 0;
        mod *= MOD_INDEX_SCALE;
        if (fbD !== 0) {
          const y = (f1D + f2D) * 0.5;
          mod += fbD > 0 ? y * fbD * FEEDBACK_SAW_CYCLES : -y * y * fbD * FEEDBACK_SQUARE_CYCLES;
        }
        let ph = phD + mod;
        ph -= Math.floor(ph);
        let v;
        if (kD === KIND_TABLE) {
          const fi = ph * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tD[i0];
          v = s0 + (tD[i0 + 1] - s0) * (fi - i0);
        } else if (kD === KIND_NOISE) v = this.noise();
        else if (kD === KIND_SAW_D) v = ph * 2 - 1;
        else v = ph < 0.5 ? 1 : -1;
        f2D = f1D;
        f1D = Math.fround(v * a);
        oD = Math.fround(v);
        aD = Math.fround(a + aiD);
      }
      phD += incD;
      if (phD >= 1) phD -= Math.floor(phD);

      if (liveC) {
        const a = aC;
        let mod = 0;
        if (modDC) mod += oD * aD;
        mod *= MOD_INDEX_SCALE;
        if (fbC !== 0) {
          const y = (f1C + f2C) * 0.5;
          mod += fbC > 0 ? y * fbC * FEEDBACK_SAW_CYCLES : -y * y * fbC * FEEDBACK_SQUARE_CYCLES;
        }
        let ph = phC + mod;
        ph -= Math.floor(ph);
        let v;
        if (kC === KIND_TABLE) {
          const fi = ph * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tC[i0];
          v = s0 + (tC[i0 + 1] - s0) * (fi - i0);
        } else if (kC === KIND_NOISE) v = this.noise();
        else if (kC === KIND_SAW_D) v = ph * 2 - 1;
        else v = ph < 0.5 ? 1 : -1;
        f2C = f1C;
        f1C = Math.fround(v * a);
        oC = Math.fround(v);
        aC = Math.fround(a + aiC);
      }
      phC += incC;
      if (phC >= 1) phC -= Math.floor(phC);

      if (liveB) {
        const a = aB;
        let mod = 0;
        if (modCB) mod += oC * aC;
        if (modDB) mod += oD * aD;
        mod *= MOD_INDEX_SCALE;
        if (fbB !== 0) {
          const y = (f1B + f2B) * 0.5;
          mod += fbB > 0 ? y * fbB * FEEDBACK_SAW_CYCLES : -y * y * fbB * FEEDBACK_SQUARE_CYCLES;
        }
        let ph = phB + mod;
        ph -= Math.floor(ph);
        let v;
        if (kB === KIND_TABLE) {
          const fi = ph * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tB[i0];
          v = s0 + (tB[i0 + 1] - s0) * (fi - i0);
        } else if (kB === KIND_NOISE) v = this.noise();
        else if (kB === KIND_SAW_D) v = ph * 2 - 1;
        else v = ph < 0.5 ? 1 : -1;
        f2B = f1B;
        f1B = Math.fround(v * a);
        oB = Math.fround(v);
        aB = Math.fround(a + aiB);
      }
      phB += incB;
      if (phB >= 1) phB -= Math.floor(phB);

      if (liveA) {
        const a = aA;
        let mod = 0;
        if (modBA) mod += oB * aB;
        if (modCA) mod += oC * aC;
        if (modDA) mod += oD * aD;
        mod *= MOD_INDEX_SCALE;
        if (fbA !== 0) {
          const y = (f1A + f2A) * 0.5;
          mod += fbA > 0 ? y * fbA * FEEDBACK_SAW_CYCLES : -y * y * fbA * FEEDBACK_SQUARE_CYCLES;
        }
        let ph = phA + mod;
        ph -= Math.floor(ph);
        let v;
        if (kA === KIND_TABLE) {
          const fi = ph * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tA[i0];
          v = s0 + (tA[i0 + 1] - s0) * (fi - i0);
        } else if (kA === KIND_NOISE) v = this.noise();
        else if (kA === KIND_SAW_D) v = ph * 2 - 1;
        else v = ph < 0.5 ? 1 : -1;
        f2A = f1A;
        f1A = Math.fround(v * a);
        oA = Math.fround(v);
        aA = Math.fround(a + aiA);
      }
      phA += incA;
      if (phA >= 1) phA -= Math.floor(phA);

      let sig = 0;
      if (carA) sig += oA * aA;
      if (carB) sig += oB * aB;
      if (carC) sig += oC * aC;
      if (carD) sig += oD * aD;
      sig *= gain;

      if (fadeInc !== 0) {
        fade += fadeInc;
        if (fade <= 0) {
          fade = 0;
        }
        sig *= fade;
      }

      if (mode !== FILT_OFF) {
        if (drive !== 1) sig = softClip(sig * drive);
        sig = this.svfA.process(sig, mode);
        if (slope24) sig = this.svfB.process(sig, mode);
      }

      const k = off + s;
      outL[k] += sig * panL;
      outR[k] += sig * panR;
    }

    phase[A] = phA;
    phase[B] = phB;
    phase[C] = phC;
    phase[D] = phD;
    this.storeOperator(A, liveA, n, aA, oA, f1A, f2A);
    this.storeOperator(B, liveB, n, aB, oB, f1B, f2B);
    this.storeOperator(C, liveC, n, aC, oC, f1C, f2C);
    this.storeOperator(D, liveD, n, aD, oD, f1D, f2D);

    this.fade = fade;
    if (fadeInc !== 0 && fade <= 0) {
      this.kill();
    }
  }

  /**
   * Write one operator's kernel locals back. A skipped operator keeps its
   * amplitude and output, which only ever meet its amplitude of 0; its history
   * is what the generic loop's `v * 0` stores would have left.
   */
  // eslint-disable-next-line max-params -- the kernel's locals for one operator, written back once per call
  storeOperator(i, live, n, a, o, f1, f2) {
    if (live) {
      this.amp[i] = a;
      this.out[i] = o;
      this.fb1[i] = f1;
      this.fb2[i] = f2;
      return;
    }
    if (n > 1) this.fb2[i] = 0;
    else this.fb2[i] = this.fb1[i];
    this.fb1[i] = 0;
  }
}

/* ------------------------------------------------------------------ *
 * The processor — one timbral part
 * ------------------------------------------------------------------ */

class FmPartProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchBend', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'modWheel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cutoffMod', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const maxVoices = Math.max(1, Math.min(128, opts.maxVoices || 16));
    this.maxVoices = maxVoices;

    // One random source for the whole part. Absent `seed` this is Math.random,
    // which is what the game gets; see "Randomness" near the top of the file.
    this.random = makeRandom(opts.seed);

    // Four reserve slots above the sounding limit so a stolen voice can fade
    // out while its replacement is already sounding.
    const poolSize = maxVoices + 4;
    this.voices = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) this.voices[i] = new Voice(sampleRate, this.random);

    this.patch = normalisePatch(opts.patch);
    this.waveSets = [null, null, null, null];
    this.rebuildWaves();

    this.events = []; // frame-stamped, kept sorted
    this.noteMap = new Map(); // noteId -> array of voice indices
    this.lastNote = null; // for legato glide
    this.running = true;
    // Off in the game; the console turns it on so a knob retunes ringing voices.
    this.liveRetune = false;
    // Seconds a slid note glides when the patch's `glide` is 0 (#602).
    this.slideSeconds = num(opts.slideSeconds, 0);
    // Skipping silent held voices (#547). Always on in the game and the console;
    // `dormancy: false` exists so a test can render the same part without it and
    // prove the two renders agree.
    this.dormancy = opts.dormancy !== false;
    // The fixed-index voice kernel and per-note constants (#548), on in the game
    // and the console; `specialise: false` renders every voice through the
    // generic loop, so a test can prove the two agree bit for bit.
    const specialise = opts.specialise !== false;
    for (let i = 0; i < poolSize; i++) this.voices[i].specialise = specialise;

    // Audio-load sampler (#445), off until a `reportLoad` message turns it on,
    // so an offline render and the Node harness time nothing and post nothing.
    // See workletMessages.ts for why this counts millisecond boundaries rather
    // than timing the call: AudioWorkletGlobalScope has no performance.now(),
    // and Date.now() cannot resolve a 2.9 ms quantum on its own.
    this.loadQuanta = 0; // report cadence in quanta; 0 = not reporting
    this.loadCount = 0; // quanta since the last report
    this.loadBusyMs = 0;
    this.loadPeakMs = 0;
    this.loadUnderruns = 0; // cumulative, never reset
    this.loadWallStart = 0;
    this.loadBudgetMs = (128 / sampleRate) * 1000;

    // Events supplied at construction. port.postMessage() is delivered
    // asynchronously and can lose the race against OfflineAudioContext's
    // startRendering(), so offline renders must pass their notes this way.
    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) this.schedule(ev, ev.frame);
    }

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  rebuildWaves() {
    const p = this.patch;
    for (let i = 0; i < 4; i++) {
      const op = p.ops[i];
      if (op.wave === WAVE.NOISE || op.wave === WAVE.SAW_D || op.wave === WAVE.SQUARE_D) {
        this.waveSets[i] = null;
      } else {
        this.waveSets[i] = getMips(op.wave, sampleRate, p.tone, op.userPartials);
      }
    }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'patch': {
        this.patch = normalisePatch(msg.patch);
        this.rebuildWaves();
        // By default live voices keep their old patch reference until they
        // finish, which avoids clicks when a preset swaps under a ringing note.
        // The console opts into hearing the knob as it turns instead.
        if (this.liveRetune) {
          for (const v of this.voices) if (v.active) v.rebind(this.patch, this.waveSets);
        }
        break;
      }
      case 'liveRetune':
        this.liveRetune = !!msg.enabled;
        break;
      case 'noteOn':
        this.schedule(msg, msg.frame);
        break;
      case 'noteOff':
        this.schedule(msg, msg.frame);
        break;
      case 'allNotesOff':
        // Queued future events are cancelled too: a mute or a live rebuild
        // (#69) must not let the scheduler's look-ahead keep sounding. Unlike
        // panic, voices already sounding still release with their tails.
        for (const v of this.voices) this.releaseVoice(v);
        this.noteMap.clear();
        this.events.length = 0;
        break;
      case 'panic':
        for (const v of this.voices) v.kill();
        this.noteMap.clear();
        this.events.length = 0;
        break;
      case 'stop':
        this.running = false;
        break;
      case 'reportLoad':
        // #445: start (or restart) the duty-cycle sampler. The cumulative
        // underrun count survives a restart; the interval accumulators do not.
        this.loadQuanta = Math.max(0, msg.quanta | 0);
        this.loadCount = 0;
        this.loadBusyMs = 0;
        this.loadPeakMs = 0;
        this.loadWallStart = Date.now();
        break;
    }
  }

  /**
   * One quantum's duty-cycle sample, and the once-per-interval post (#445).
   * `t1 - t0` is not a duration: it is the number of integer-millisecond
   * boundaries that fell inside the render, which is what makes this a
   * sampler rather than a timer. Allocates only at the post.
   */
  sampleLoad(t0, t1) {
    const spanMs = t1 - t0;
    this.loadBusyMs += spanMs;
    if (spanMs > this.loadPeakMs) this.loadPeakMs = spanMs;
    // N boundary crossings prove only that the render took MORE THAN N-1 ms:
    // a 2.2 ms quantum from 1000.9 to 1003.1 crosses three and would count as
    // an overrun of a 2.902 ms budget if the count were read as a duration.
    // So the provable lower bound is `spanMs - 1`, and only that may accuse a
    // quantum of missing its deadline (#445 review, pass 1 and 2).
    if (spanMs - 1 >= this.loadBudgetMs) this.loadUnderruns++;
    if (++this.loadCount < this.loadQuanta) return;
    this.port.postMessage({
      type: 'load',
      busyMs: this.loadBusyMs,
      wallMs: t1 - this.loadWallStart,
      quanta: this.loadCount,
      peakMs: this.loadPeakMs,
      underruns: this.loadUnderruns,
    });
    this.loadCount = 0;
    this.loadBusyMs = 0;
    this.loadPeakMs = 0;
    this.loadWallStart = t1;
  }

  schedule(ev, frame) {
    ev._frame = typeof frame === 'number' ? frame : currentFrame;
    // Insertion sort from the back: events usually arrive in order.
    const q = this.events;
    let i = q.length;
    while (i > 0 && q[i - 1]._frame > ev._frame) i--;
    q.splice(i, 0, ev);
  }

  /**
   * Pick a voice.
   *
   * If the part is already at its sounding limit, the least valuable voice is
   * asked to fade out (4 ms) rather than being cut dead, and the new note takes
   * a reserve slot. Only an exhausted pool falls back to a hard kill.
   *
   * Priority for stealing: dormant (#547), oldest first, killed outright since
   * it is silent and needs no fade; then already released, oldest first;
   * otherwise oldest. A dormant voice counts as sounding, so the pool never
   * holds more than the limit.
   */
  allocate() {
    const vs = this.voices;
    let free = null;
    let sounding = 0;
    let bestDormant = null,
      bestDormantAge = -1;
    let bestReleased = null,
      bestReleasedAge = -1;
    let bestAny = null,
      bestAnyAge = -1;

    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.finished && !v.fading) v.active = false;

      if (!v.active) {
        if (!free) free = v;
        continue;
      }
      if (v.fading) continue; // sounding but already on its way out

      sounding++;
      if (this.dormancy && v.age > bestDormantAge && v.dormant) {
        bestDormantAge = v.age;
        bestDormant = v;
      }
      if (!v.gate && v.age > bestReleasedAge) {
        bestReleasedAge = v.age;
        bestReleased = v;
      }
      if (v.age > bestAnyAge) {
        bestAnyAge = v.age;
        bestAny = v;
      }
    }

    if (sounding >= this.maxVoices) {
      if (bestDormant) {
        bestDormant.kill();
        return bestDormant;
      }
      const victim = bestReleased || bestAny;
      if (victim) victim.steal();
    }

    if (free) return free;

    // Pool exhausted (many simultaneous fades). Take the oldest outright.
    let oldest = vs[0];
    for (let i = 1; i < vs.length; i++) if (vs[i].age > oldest.age) oldest = vs[i];
    oldest.kill();
    return oldest;
  }

  /**
   * Mono (#453): fade out every voice the part has sounding -- the same 4 ms
   * steal a full pool uses, so the cut never clicks -- and drop the note map
   * with them. Every remaining entry points at a voice that is fading or
   * already free, so a later noteOff for a cut note finds nothing and cannot
   * release the note that replaced it. Allocates nothing.
   */
  cutSounding() {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && !v.fading) v.steal();
    }
    this.noteMap.clear();
  }

  noteOn(msg) {
    const p = this.patch;
    const id = msg.id != null ? msg.id : msg.note;
    const vel = num(msg.velocity, 1);
    const mod = num(msg.mod, 0);
    const count = p.spread > 0 ? 2 : 1;
    const glideFrom = p.glide > 0 && this.lastNote != null ? this.lastNote : null;

    // One note at a time, with retrigger: the cut happens before the new note
    // allocates, so the fading voices are in reserve slots and the new note
    // starts fresh. `spread` still runs its detuned pair for the one note, and
    // `glide` still slides from `lastNote`.
    // A slide in mono (#602): the sounding voice takes the new note legato.
    if (msg.slide && p.mono && this.slideTo(id, msg.note, vel, mod)) return;
    if (p.mono) this.cutSounding();

    let list = this.noteMap.get(id);
    if (list) this.noteOffId(id);
    list = [];

    for (let u = 0; u < count; u++) {
      const v = this.allocate();
      const sign = u === 0 ? -1 : 1;
      const detune = count === 1 ? 0 : (sign * p.spread) / 100;
      let pan = p.pan + p.panKey * ((msg.note - 60) / 48) + p.panRandom * (this.random() * 2 - 1);
      if (count > 1) pan += sign * 0.35 * Math.min(1, p.spread / 50);
      v.start(p, this.waveSets, msg.note, vel, detune, pan, glideFrom, id);
      v.mod = mod;
      list.push(v);
    }
    this.noteMap.set(id, list);
    this.lastNote = msg.note;
  }

  /**
   * Retarget the held note's voices to `note` under handle `id` (#602). In
   * mono at most one handle is gated, so the first gated voice names it.
   * False when nothing is sounding: the caller starts a fresh voice instead.
   * Allocates nothing beyond the map's own bookkeeping, as `noteOn` does.
   */
  slideTo(id, note, velocity, mod) {
    const vs = this.voices;
    let heldId = null;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.gate && !v.fading) {
        heldId = v.voiceId;
        break;
      }
    }
    if (heldId === null || heldId === id) return false;
    const list = this.noteMap.get(heldId);
    if (!list) return false;
    const p = this.patch;
    const glide = p.glide > 0 ? p.glide : this.slideSeconds;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.voiceId !== heldId) continue;
      v.retarget(note, velocity, mod, glide);
      v.voiceId = id;
    }
    this.noteMap.delete(heldId);
    this.noteMap.set(id, list);
    this.lastNote = note;
    return true;
  }

  noteOffId(id) {
    const list = this.noteMap.get(id);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i].voiceId === id) this.releaseVoice(list[i]);
    }
    this.noteMap.delete(id);
  }

  /** Note-off for one voice: a dormant voice's release is silence, so it just ends (#547). */
  releaseVoice(v) {
    if (this.dormancy && v.active && v.dormant) v.kill();
    else v.release();
  }

  /**
   * The render. `renderBlock` is the whole of it; `process` is the sampler
   * wrapper (#445) and nothing else, so the hot loop reads exactly as it did
   * and a page that never turns the sampler on pays one branch per quantum.
   */
  process(inputs, outputs, params) {
    if (this.loadQuanta === 0) return this.renderBlock(inputs, outputs, params);
    const t0 = Date.now();
    const running = this.renderBlock(inputs, outputs, params);
    this.sampleLoad(t0, Date.now());
    return running;
  }

  renderBlock(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || out.length === 0) return this.running;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const n = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const bend = params.pitchBend[0];
    const mw = params.modWheel[0];
    const cm = params.cutoffMod[0];
    const gain = params.gain[0];

    const blockStart = currentFrame;
    const dormancy = this.dormancy;
    const q = this.events;
    let cursor = 0;

    while (cursor < n) {
      // Apply every event landing on this frame.
      while (q.length > 0 && q[0]._frame <= blockStart + cursor) {
        const ev = q.shift();
        if (ev.type === 'noteOn') this.noteOn(ev);
        else if (ev.type === 'noteOff') this.noteOffId(ev.id != null ? ev.id : ev.note);
      }

      // Render up to the next event, the next control boundary, or block end.
      let seg = n - cursor;
      if (q.length > 0) {
        const untilEvent = q[0]._frame - (blockStart + cursor);
        if (untilEvent > 0 && untilEvent < seg) seg = untilEvent;
      }

      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v.active) continue;

        let done = 0;
        while (done < seg) {
          // A dormant voice is skipped to the end of the segment and re-read at
          // the next one (#547); `ctrlCount` stays 0 so that check is a control
          // boundary. Age still runs, so stealing order holds.
          if (v.ctrlCount === 0 && dormancy && v.dormant) {
            v.age += seg - done;
            break;
          }
          if (v.ctrlCount === 0) {
            v.updateControl(CTRL_INTERVAL, bend, mw, cm);
            v.ctrlCount = CTRL_INTERVAL;
          }
          const chunk = Math.min(seg - done, v.ctrlCount);
          v.render(outL, outR, cursor + done, chunk);
          v.ctrlCount -= chunk;
          done += chunk;
        }

        if (!v.gate && !v.fading && v.finished) v.active = false;
      }

      cursor += seg;
    }

    if (gain !== 1) {
      for (let i = 0; i < n; i++) outL[i] *= gain;
      if (outR !== outL) for (let i = 0; i < n; i++) outR[i] *= gain;
    }

    return this.running;
  }
}

registerProcessor('fm-part', FmPartProcessor);
