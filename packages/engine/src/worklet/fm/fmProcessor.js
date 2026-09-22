/* eslint-disable max-lines -- The DSP is one unit that must ship as a single
   dependency-free script. AudioWorklet.addModule() takes a URL, and this file
   has no imports, so `new URL(..., import.meta.url)` resolves it correctly in
   both the dev server and the production build with no bundler involvement.
   Splitting it would introduce a worklet bundling step (see
   docs/design/audio-architecture.md 6.1) to buy nothing: the operator, envelope,
   filter and voice code is a single hot loop read top-to-bottom, and the seams
   a split would follow are already section comments. Exception approved by the
   maintainer; recorded in docs/log/2026-08-31-audio-worklet-single-file.md. */
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */

/**
 * fm-processor.js -- 4-operator FM voice engine for AudioWorklet.
 *
 * Runs on the audio thread. Two rules govern every line below:
 *   1. No allocation in process(): a GC pause is an audible dropout.
 *   2. No imports: see the eslint note above.
 *
 * Architecture:
 *   - 4 operators, 11 algorithms, per-operator envelope + feedback
 *   - Operator-style waveforms built from harmonic partials, bandlimited into
 *     per-octave mipmaps (user waveforms are the same code path)
 *   - Per-voice TPT state-variable filter with its own envelope
 *   - Per-voice LFO, pitch envelope, glide
 *   - Sample-accurate note scheduling via a frame-stamped event queue
 *
 * One node == one timbral part. Instantiate several for multi-timbral use.
 * The patch schema and algorithm tables are mirrored in ../patch.ts;
 * audio/patch.test.ts asserts the two copies cannot drift.
 */
/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

const TABLE_BITS = 11;
const TABLE_SIZE = 1 << TABLE_BITS; // 2048
const TABLE_MASK = TABLE_SIZE - 1;

const MIP_COUNT = 12; // one per octave from MIP_BASE_HZ
const MIP_BASE_HZ = 16.352; // C0

const CTRL_INTERVAL = 32; // samples between control-rate updates
/*
 * Dormancy (#547). A held note whose carriers have all decayed to a sustain of
 * 0 renders nothing but still costs four operators, a filter and a voice slot
 * until its note-off. Below these it is treated as silent: its carrier
 * amplitudes are within DORMANT_AMP of 0 and, when a filter is on, the SVF
 * integrator states are within DORMANT_FILTER_STATE (about -180 dB), so a
 * resonant ring still sounding after the carriers stop is never cut.
 */
const DORMANT_AMP = 1e-9;
const DORMANT_FILTER_STATE = 1e-9;
/*
 * Modulation depth at operator amplitude 1.0, in cycles of phase -- the unit
 * `phase` is kept in, so the radian index is 2*pi times this: 4 cycles is
 * ~25.1 rad (#543). The old 8 meant ~50 rad, past Nyquist for the sidebands of
 * anything but a low note on an engine that does not oversample, so the top
 * third of the Level knob was aliasing rather than timbre. 4 keeps the DX-era
 * ~4*pi useful maximum inside the knob and still reaches noise at the top.
 * Amplitude is level^2 x envelope x velocity x key scale x LFO, so a modulator
 * at Level 1 with its envelope open is the full 4 cycles.
 */
const MOD_INDEX_SCALE = 4.0;
/*
 * Self-feedback depth at |feedback| = 1, in cycles of phase (#529). Positive
 * feedback runs sin(phase + beta*y): sine towards a sawtooth, clean to ~1.25
 * rad and noise past ~2.5. Negative runs sin(phase + beta*y^2), whose half-wave
 * symmetry keeps only odd harmonics: sine towards a square, clean to ~2.0 rad.
 * Measured on A2 and A5 in #529; beyond these the one-sample loop turns chaotic.
 */
const FEEDBACK_SAW_CYCLES = 1.25 / (2 * Math.PI);
const FEEDBACK_SQUARE_CYCLES = 2.0 / (2 * Math.PI);
const MIN_SEG_TIME = 0.0005; // shortest envelope segment, seconds

/* Waveform ids — keep in sync with ../src/patch.js */
const WAVE = {
  SINE: 0,
  SAW: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  NOISE: 4,
  SAW_D: 5, // unbandlimited, aliases by design
  SQUARE_D: 6, // unbandlimited, aliases by design
  SINE_4BIT: 7,
  SINE_8BIT: 8,
  USER: 9, // partials supplied by the patch
};

/* ------------------------------------------------------------------ *
 * Randomness
 *
 * Three things below are drawn at random: free-running operator start phase,
 * the per-voice noise seed, and `panRandom` jitter. All three go through one
 * source per processor, so a test can pin every one of them at once.
 *
 * The game passes no seed and gets `Math.random`, as before — with one
 * deliberate difference, the zero exclusion in `randomSeed32` below.
 * `processorOptions.seed` swaps in mulberry32 — 32 bits of state, no
 * allocation, and ample for phase and pan jitter. It is deliberately not a
 * simulation-grade generator: nothing here reaches the simulation
 * (docs/design/audio-architecture.md 4), it only has to be reproducible.
 * ------------------------------------------------------------------ */

/**
 * `Math.random`, unless a seed is supplied; then a reproducible mulberry32 --
 * the same algorithm, line for line, as `mulberry32` in
 * `packages/shared/src/terrain/heightmap.ts`, so the repo has one seeded
 * generator rather than two. It is copied rather than imported for the reason
 * at the top of this file: the worklet must stay import-free.
 */
function makeRandom(seed) {
  if (seed == null) return Math.random;
  let state = seed >>> 0;
  return function mulberry32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A non-zero xorshift32 seed. Zero is xorshift's fixed point — a voice that
 * drew it would emit dead DC from its noise operator, and hold its sample-and-
 * hold LFO still, for as long as it sounded.
 *
 * **This is the one behavioural change on the unseeded game path.** Before,
 * that zero was kept; now it becomes 1. It is a 2^-32 accident from
 * `Math.random` and was never worth a branch, but a swept seed makes it
 * reachable and reproducible, so it is excluded rather than left to luck.
 * `fmProcessor.test.ts` pins `Math.random` at 0 and asserts a noise operator
 * still oscillates.
 */
function randomSeed32(random) {
  return (random() * 0xffffffff) >>> 0 || 1;
}

/* ------------------------------------------------------------------ *
 * Wavetable construction
 *
 * Every non-noise, non-digital waveform is a list of harmonic amplitudes
 * rendered into TABLE_SIZE samples, once per octave, with harmonics above
 * Nyquist dropped. `tone` (0..1) scales the surviving harmonic count, which
 * is the cheap global brightness / anti-alias control.
 * ------------------------------------------------------------------ */

/** Exact sine table; sin(2*pi*h*i/N) == SIN_TAB[(h*i) & TABLE_MASK] */
const SIN_TAB = new Float32Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) {
  SIN_TAB[i] = Math.sin((2 * Math.PI * i) / TABLE_SIZE);
}

/** Harmonic amplitude arrays. Index 0 is the fundamental. */
function partialsFor(waveId, userPartials) {
  const N = TABLE_SIZE >> 1;
  const a = new Float32Array(N);
  switch (waveId) {
    case WAVE.SAW:
      for (let n = 1; n <= N; n++) a[n - 1] = 1 / n;
      break;
    case WAVE.SQUARE:
      for (let n = 1; n <= N; n += 2) a[n - 1] = 1 / n;
      break;
    case WAVE.TRIANGLE:
      for (let n = 1, s = 1; n <= N; n += 2, s = -s) a[n - 1] = s / (n * n);
      break;
    case WAVE.USER:
      if (userPartials) {
        for (let i = 0; i < Math.min(N, userPartials.length); i++) a[i] = userPartials[i];
      } else {
        a[0] = 1;
      }
      break;
    default: // SINE and the quantised sines start from a pure fundamental
      a[0] = 1;
      break;
  }
  return a;
}

/**
 * Build MIP_COUNT bandlimited tables. Each has one guard sample at the end so
 * linear interpolation never wraps-checks in the inner loop.
 */
function buildMips(partials, sampleRate, tone) {
  const nyquist = sampleRate * 0.5;
  const maxPossible = TABLE_SIZE >> 1;
  const mips = new Array(MIP_COUNT);

  for (let k = 0; k < MIP_COUNT; k++) {
    const topHz = MIP_BASE_HZ * Math.pow(2, k + 1);
    let maxH = Math.floor(nyquist / topHz);
    maxH = Math.min(maxH, maxPossible, partials.length);
    maxH = Math.max(1, Math.floor(maxH * tone));

    const t = new Float32Array(TABLE_SIZE + 1);
    for (let h = 1; h <= maxH; h++) {
      const amp = partials[h - 1];
      if (amp === 0) continue;
      let idx = 0;
      for (let i = 0; i < TABLE_SIZE; i++) {
        t[i] += amp * SIN_TAB[idx];
        idx = (idx + h) & TABLE_MASK;
      }
    }

    let peak = 0;
    for (let i = 0; i < TABLE_SIZE; i++) {
      const v = t[i] < 0 ? -t[i] : t[i];
      if (v > peak) peak = v;
    }
    if (peak > 1e-9) {
      const g = 1 / peak;
      for (let i = 0; i < TABLE_SIZE; i++) t[i] *= g;
    }
    t[TABLE_SIZE] = t[0];
    mips[k] = t;
  }
  return mips;
}

/** Quantise a mip set in place to `levels` steps — the 4-bit / 8-bit sines. */
function quantiseMips(mips, levels) {
  for (let k = 0; k < mips.length; k++) {
    const t = mips[k];
    for (let i = 0; i <= TABLE_SIZE; i++) {
      t[i] = Math.round(t[i] * levels) / levels;
    }
  }
  return mips;
}

/**
 * Shared across every processor instance in this worklet global scope, so 16
 * parts using a saw pay for the tables once. Keyed by waveform + quantised tone,
 * and for a User wave by the partials themselves (#511). The key used to be the
 * patch's `userKey`, which only worked while every author picked a unique one:
 * a User wave left at the default '' shared the first such table built, and a
 * harmonic edit kept playing the old one. `null` (a sine) and `[]` (silence)
 * keep distinct keys. Equal partials still share a table,
 * so the scoring bank's User presets render exactly as before. Only a `patch`
 * message reaches here, never the audio loop, so the string is fine.
 */
const WAVE_CACHE = new Map();
const WAVE_CACHE_LIMIT = 64;

function getMips(waveId, sampleRate, tone, userPartials) {
  const toneQ = Math.max(0.02, Math.min(1, Math.round(tone * 20) / 20));
  // null plays a sine and [] plays silence: the two must never share a key.
  let content = '';
  if (waveId === WAVE.USER) content = userPartials ? '[' + userPartials.join(',') + ']' : 'null';
  const key = waveId + '|' + toneQ + '|' + content;
  let mips = WAVE_CACHE.get(key);
  if (mips) return mips;

  mips = buildMips(partialsFor(waveId, userPartials), sampleRate, toneQ);
  if (waveId === WAVE.SINE_4BIT) quantiseMips(mips, 8);
  else if (waveId === WAVE.SINE_8BIT) quantiseMips(mips, 128);

  if (WAVE_CACHE.size >= WAVE_CACHE_LIMIT) {
    WAVE_CACHE.delete(WAVE_CACHE.keys().next().value);
  }
  WAVE_CACHE.set(key, mips);
  return mips;
}

/** Which octave table to read for a given frequency. */
function mipIndex(freq) {
  if (freq <= MIP_BASE_HZ) return 0;
  const k = Math.floor(Math.log2(freq / MIP_BASE_HZ));
  return k < 0 ? 0 : k >= MIP_COUNT ? MIP_COUNT - 1 : k;
}

/* ------------------------------------------------------------------ *
 * Algorithms
 *
 * Operators are indexed 0..3 and labelled A B C D, with A at the bottom of the
 * diagram (nearest the output). `mods[i]` lists the operators that modulate i;
 * `carriers` lists the operators summed to the voice output.
 *
 * 0..7 are the classic four-operator topologies (as found on OPM/OPN);
 * 8..10 add the parallel/tapped shapes that make Operator expressive.
 * ------------------------------------------------------------------ */

const A = 0,
  B = 1,
  C = 2,
  D = 3;

const ALGORITHMS = [
  // 0:  D -> C -> B -> A                      full series, the classic FM stack
  { name: 'D>C>B>A', mods: [[B], [C], [D], []], carriers: [A] },
  // 1:  D,C -> B -> A                         two modulators sum into B
  { name: '(D,C)>B>A', mods: [[B], [C, D], [], []], carriers: [A] },
  // 2:  C -> B -> A, D -> A                   series plus a direct modulator
  { name: 'C>B>A, D>A', mods: [[B, D], [C], [], []], carriers: [A] },
  // 3:  D -> C -> A, B -> A                   two-stack and a single into A
  { name: 'D>C>A, B>A', mods: [[C, B], [], [D], []], carriers: [A] },
  // 4:  D -> C, B -> A                        two independent 2-op stacks
  { name: 'D>C | B>A', mods: [[B], [], [D], []], carriers: [A, C] },
  // 5:  D -> C, D -> B, D -> A                one modulator, three carriers
  { name: 'D>(C,B,A)', mods: [[D], [D], [D], []], carriers: [A, B, C] },
  // 6:  D -> C, B and A free                  one stack plus two sines
  { name: 'D>C | B | A', mods: [[], [], [D], []], carriers: [A, B, C] },
  // 7:  all four parallel                     additive, no FM at all
  { name: 'A|B|C|D', mods: [[], [], [], []], carriers: [A, B, C, D] },
  // 8:  D -> C -> B -> A, B also heard        series with a mid-chain tap
  { name: 'D>C>B>A +B', mods: [[B], [C], [D], []], carriers: [A, B] },
  // 9:  D -> C, C -> B, C -> A                shared modulator, split output
  { name: 'D>C>(B,A)', mods: [[C], [C], [D], []], carriers: [A, B] },
  // 10: D,C,B -> A                            three modulators, one carrier
  { name: '(D,C,B)>A', mods: [[B, C, D], [], [], []], carriers: [A] },
];

/** Evaluation order so every modulator is computed before its target. */
function topoOrder(alg) {
  const order = [];
  const seen = new Uint8Array(4);
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    const m = alg.mods[i];
    for (let j = 0; j < m.length; j++) if (m[j] !== i) visit(m[j]);
    order.push(i);
  };
  for (let i = 0; i < 4; i++) visit(i);
  return order;
}

const ALG_ORDER = ALGORITHMS.map(topoOrder);

/*
 * The fixed-index voice kernel (#548). `Voice.renderKernel` evaluates the
 * operators D, C, B, A with each one's state in locals, and reads routing as
 * edge and carrier flags set once per render call, not as a per-sample walk
 * of `order` and `mods`. It is the generic loop's arithmetic in the generic
 * loop's order, so its output is bit-identical, and an algorithm qualifies
 * only when that holds by construction:
 *   - every modulator has a higher index than its target, so D..A computes
 *     each modulator before it is read, as the topological order does;
 *   - a modulator list of three is ascending (two terms commute exactly), and
 *     so is a carrier list of three or more.
 * The only state operators share is the voice's noise generator, so a voice
 * with two noise operators also needs its topological order to be D..A.
 */
const EDGE_BA = 1,
  EDGE_CA = 2,
  EDGE_DA = 4,
  EDGE_CB = 8,
  EDGE_DB = 16,
  EDGE_DC = 32;
const EDGE_BIT = [
  [0, EDGE_BA, EDGE_CA, EDGE_DA],
  [0, 0, EDGE_CB, EDGE_DB],
  [0, 0, 0, EDGE_DC],
  [0, 0, 0, 0],
];

function ascending(list) {
  for (let j = 1; j < list.length; j++) if (list[j] <= list[j - 1]) return false;
  return true;
}

/** The algorithm's modulation edges as EDGE_* bits, or -1 when the kernel cannot render it exactly. */
function kernelEdges(alg) {
  let edges = 0;
  for (let i = 0; i < 4; i++) {
    const m = alg.mods[i];
    if (m.length > 2 && !ascending(m)) return -1;
    for (let j = 0; j < m.length; j++) {
      if (m[j] <= i) return -1;
      edges |= EDGE_BIT[i][m[j]];
    }
  }
  if (alg.carriers.length > 2 && !ascending(alg.carriers)) return -1;
  return edges;
}

const ALG_EDGES = ALGORITHMS.map(kernelEdges);
const ALG_CARRIER_BITS = ALGORITHMS.map((alg) => alg.carriers.reduce((b, c) => b | (1 << c), 0));
const ALG_DESCENDING = ALG_ORDER.map((o) => o[0] === D && o[1] === C && o[2] === B && o[3] === A);

/* ------------------------------------------------------------------ *
 * Envelope
 *
 * Operator's shape: Init -> (attack) -> Peak -> (decay) -> Sustain -> held ->
 * (release) -> End, with a curve control per segment and three loop modes.
 * Advanced at control rate; the caller interpolates between control points.
 * ------------------------------------------------------------------ */

const ST_IDLE = 0,
  ST_ATTACK = 1,
  ST_DECAY = 2,
  ST_SUSTAIN = 3,
  ST_RELEASE = 4,
  ST_DONE = 5;
const LOOP_NONE = 0,
  LOOP_LOOP = 1,
  LOOP_TRIGGER = 2;

/** Monotonic 0..1 curve. k == 1 is linear, k < 1 bows up, k > 1 bows down. */
function curveShape(p, k) {
  return p / (p + (1 - p) * k);
}

class Envelope {
  constructor() {
    this.state = ST_IDLE;
    this.value = 0;
    this.phase = 0;
    this.segStart = 0;
    this.p = null; // parameter block, owned by the voice's patch
    this.sr = 48000;
    this.timeScale = 1; // key tracking: >1 slower, <1 faster
  }

  configure(params, sampleRate) {
    this.p = params;
    this.sr = sampleRate;
  }

  noteOn() {
    const p = this.p;
    this.state = ST_ATTACK;
    this.phase = 0;
    this.value = p.initLevel;
    this.segStart = p.initLevel;
  }

  noteOff() {
    if (this.state === ST_DONE || this.state === ST_IDLE) return;
    if (this.p.loopMode === LOOP_TRIGGER) return; // runs its full course
    this.state = ST_RELEASE;
    this.phase = 0;
    this.segStart = this.value;
  }

  /** True once the envelope has finished releasing. */
  get finished() {
    return this.state === ST_DONE || this.state === ST_IDLE;
  }

  /** Advance by `n` samples and return the new value. */
  advance(n) {
    const p = this.p;
    if (this.state === ST_IDLE || this.state === ST_DONE) return this.value;
    if (this.state === ST_SUSTAIN) {
      this.value = p.sustainLevel;
      return this.value;
    }

    let time, target, curve;
    switch (this.state) {
      case ST_ATTACK:
        time = p.attackTime;
        target = p.peakLevel;
        curve = p.attackCurve;
        break;
      case ST_DECAY:
        time = p.decayTime;
        target = p.sustainLevel;
        curve = p.decayCurve;
        break;
      default:
        time = p.releaseTime;
        target = p.endLevel;
        curve = p.releaseCurve;
        break;
    }
    time *= this.timeScale;
    if (time < MIN_SEG_TIME) time = MIN_SEG_TIME;

    this.phase += n / (time * this.sr);

    if (this.phase >= 1) {
      this.value = target;
      this.phase = 0;
      this.segStart = target;
      switch (this.state) {
        case ST_ATTACK:
          this.state = ST_DECAY;
          break;
        case ST_DECAY:
          if (p.loopMode === LOOP_LOOP) {
            this.state = ST_ATTACK;
            this.segStart = this.value;
          } else if (p.loopMode === LOOP_TRIGGER) {
            this.state = ST_RELEASE;
          } else this.state = ST_SUSTAIN;
          break;
        default:
          this.state = ST_DONE;
          break;
      }
      return this.value;
    }

    const k = Math.exp(curve * 3);
    const s = k === 1 ? this.phase : curveShape(this.phase, k);
    this.value = this.segStart + (target - this.segStart) * s;
    return this.value;
  }
}

/* ------------------------------------------------------------------ *
 * LFO
 * ------------------------------------------------------------------ */

const LFO_SINE = 0,
  LFO_TRI = 1,
  LFO_SAW_UP = 2,
  LFO_SAW_DOWN = 3,
  LFO_SQUARE = 4,
  LFO_SH = 5,
  LFO_DRIFT = 6;

class Lfo {
  constructor(random) {
    this.phase = 0;
    this.value = 0;
    this.held = 0;
    this.target = 0;
    this.fade = 0;
    this.seed = randomSeed32(random);
  }

  rand() {
    // xorshift32 — deterministic, allocation free
    let x = this.seed;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.seed = x;
    return x / 0xffffffff;
  }

  reset(retrigger) {
    if (retrigger) this.phase = 0;
    this.fade = 0;
    this.held = this.rand() * 2 - 1;
    this.target = this.rand() * 2 - 1;
  }

  advance(p, n, sampleRate) {
    const prev = this.phase;
    this.phase += (p.rate * n) / sampleRate;
    const wrapped = this.phase >= 1;
    if (wrapped) this.phase -= Math.floor(this.phase);

    switch (p.shape) {
      case LFO_TRI:
        this.value = 4 * Math.abs(this.phase - 0.5) - 1;
        break;
      case LFO_SAW_UP:
        this.value = this.phase * 2 - 1;
        break;
      case LFO_SAW_DOWN:
        this.value = 1 - this.phase * 2;
        break;
      case LFO_SQUARE:
        this.value = this.phase < 0.5 ? 1 : -1;
        break;
      case LFO_SH:
        if (wrapped || this.phase < prev) this.held = this.rand() * 2 - 1;
        this.value = this.held;
        break;
      case LFO_DRIFT:
        if (wrapped || this.phase < prev) {
          this.held = this.target;
          this.target = this.rand() * 2 - 1;
        }
        this.value = this.held + (this.target - this.held) * this.phase;
        break;
      default:
        this.value = SIN_TAB[(this.phase * TABLE_SIZE) & TABLE_MASK];
        break;
    }

    if (p.delay > 0) {
      this.fade = Math.min(1, this.fade + n / (p.delay * sampleRate));
    } else {
      this.fade = 1;
    }
    return this.value * this.fade;
  }
}

/* ------------------------------------------------------------------ *
 * Filter — TPT / zero-delay-feedback state variable (Simper topology).
 * One structure yields lowpass, highpass, bandpass and notch, stays stable up
 * to Nyquist, and costs a handful of multiply-adds per sample.
 * ------------------------------------------------------------------ */

const FILT_OFF = 0,
  FILT_LP = 1,
  FILT_HP = 2,
  FILT_BP = 3,
  FILT_NOTCH = 4;

class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 0;
  }

  reset() {
    this.ic1 = 0;
    this.ic2 = 0;
  }

  /** Both integrators below the dormancy floor: the filter has stopped ringing (#547). */
  static quiet(svf) {
    return Math.abs(svf.ic1) <= DORMANT_FILTER_STATE && Math.abs(svf.ic2) <= DORMANT_FILTER_STATE;
  }

  /** Recompute coefficients. Called at control rate, not per sample. */
  setCoeffs(cutoffHz, q, sampleRate) {
    const nyq = sampleRate * 0.5;
    let fc = cutoffHz;
    if (fc < 20) fc = 20;
    if (fc > nyq * 0.98) fc = nyq * 0.98;
    const g = Math.tan((Math.PI * fc) / sampleRate);
    const k = 1 / Math.max(0.5, q);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(v0, mode) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (mode) {
      case FILT_LP:
        return v2;
      case FILT_HP:
        return v0 - this.k * v1 - v2;
      case FILT_BP:
        return v1;
      case FILT_NOTCH:
        return v0 - this.k * v1;
      default:
        return v0;
    }
  }
}

/** Cheap odd-symmetric saturator for filter drive. */
function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  return (x * (27 + x * x)) / (27 + 9 * x * x);
}

/* ------------------------------------------------------------------ *
 * Voice — four operators, a filter, and the modulation that feeds them.
 *
 * Every buffer here is allocated once at construction. render() must not
 * allocate: it runs on the audio thread and a GC pause is an audible dropout.
 * ------------------------------------------------------------------ */

const KIND_TABLE = 0,
  KIND_NOISE = 1,
  KIND_SAW_D = 2,
  KIND_SQUARE_D = 3;

/** The render kind an operator's wave id selects; everything not raw or noise is a table. */
function waveKind(wave) {
  switch (wave) {
    case WAVE.NOISE:
      return KIND_NOISE;
    case WAVE.SAW_D:
      return KIND_SAW_D;
    case WAVE.SQUARE_D:
      return KIND_SQUARE_D;
    default:
      return KIND_TABLE;
  }
}

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
 * Patch normalisation
 *
 * The editor and the game send partial patches; fill in every field here so
 * the audio loop never has to test for undefined.
 * ------------------------------------------------------------------ */

function envDefaults(o) {
  o = o || {};
  return {
    initLevel: num(o.initLevel, 0),
    attackTime: num(o.attackTime, 0.002),
    attackCurve: num(o.attackCurve, 0),
    peakLevel: num(o.peakLevel, 1),
    decayTime: num(o.decayTime, 0.4),
    decayCurve: num(o.decayCurve, 0.5),
    sustainLevel: num(o.sustainLevel, 0.7),
    releaseTime: num(o.releaseTime, 0.3),
    releaseCurve: num(o.releaseCurve, 0.5),
    endLevel: num(o.endLevel, 0),
    loopMode: num(o.loopMode, LOOP_NONE) | 0,
    keyScale: num(o.keyScale, 0),
  };
}

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function opDefaults(o, index) {
  o = o || {};
  return {
    wave: num(o.wave, WAVE.SINE) | 0,
    userPartials: o.userPartials || null,
    userKey: o.userKey || '',
    ratio: num(o.ratio, 1),
    fixed: !!o.fixed,
    fixedHz: num(o.fixedHz, 100),
    detune: num(o.detune, 0), // cents
    level: num(o.level, index === 0 ? 1 : 0),
    feedback: Math.max(-1, Math.min(1, num(o.feedback, 0))), // bipolar (#529)
    velSens: num(o.velSens, 0.4),
    levelKeyScale: num(o.levelKeyScale, 0),
    phase: num(o.phase, 0),
    phaseFree: o.phaseFree !== false, // free-running by default
    env: envDefaults(o.env),
  };
}

function normalisePatch(raw) {
  raw = raw || {};
  const ops = [];
  for (let i = 0; i < 4; i++) ops.push(opDefaults(raw.ops && raw.ops[i], i));

  const lfoRaw = raw.lfo || {};
  const filtRaw = raw.filter || {};

  const p = {
    name: raw.name || 'untitled',
    algorithm: Math.max(0, Math.min(ALGORITHMS.length - 1, num(raw.algorithm, 0) | 0)),
    volume: num(raw.volume, 0.8),
    tone: Math.max(0.02, Math.min(1, num(raw.tone, 1))),
    glide: num(raw.glide, 0),
    pitchEnv: envDefaults(raw.pitchEnv),
    pitchEnvAmount: num(raw.pitchEnvAmount, 0), // semitones
    pan: num(raw.pan, 0),
    panRandom: num(raw.panRandom, 0),
    panKey: num(raw.panKey, 0),
    spread: num(raw.spread, 0), // cents; >0 doubles voices
    mono: !!raw.mono, // one note at a time, with retrigger (#453)
    ops,
    lfo: {
      shape: num(lfoRaw.shape, LFO_SINE) | 0,
      rate: num(lfoRaw.rate, 5),
      amount: num(lfoRaw.amount, 0),
      delay: num(lfoRaw.delay, 0),
      retrigger: !!lfoRaw.retrigger,
      toPitch: num(lfoRaw.toPitch, 0), // semitones
      modWheelDepth: num(lfoRaw.modWheelDepth, 1),
      toOp: [
        num(lfoRaw.toOp && lfoRaw.toOp[0], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[1], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[2], 0),
        num(lfoRaw.toOp && lfoRaw.toOp[3], 0),
      ],
    },
    filter: {
      mode: num(filtRaw.mode, FILT_OFF) | 0,
      cutoff: num(filtRaw.cutoff, 8000),
      resonance: num(filtRaw.resonance, 0.707),
      drive: num(filtRaw.drive, 1),
      slope24: !!filtRaw.slope24,
      envAmount: num(filtRaw.envAmount, 0), // octaves
      modWheelDepth: num(filtRaw.modWheelDepth, 0), // octaves the wheel adds to envAmount (#586)
      lfoAmount: num(filtRaw.lfoAmount, 0), // octaves
      keyTrack: num(filtRaw.keyTrack, 0),
      env: envDefaults(filtRaw.env),
    },
  };

  p.feedbackScratch = new Float32Array(4);
  for (let i = 0; i < 4; i++) p.feedbackScratch[i] = ops[i].feedback;
  return p;
}

/* Warm the common waveforms at module-load time — this runs inside
 * addModule(), before the context renders anything, so the table build never
 * stalls a live audio callback. */
for (const w of [WAVE.SINE, WAVE.SAW, WAVE.SQUARE, WAVE.TRIANGLE]) {
  getMips(w, sampleRate, 1, null, '');
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
