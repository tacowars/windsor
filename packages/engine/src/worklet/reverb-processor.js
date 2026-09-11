/* global AudioWorkletProcessor, registerProcessor, sampleRate */

/**
 * reverb-processor.js -- Dattorro plate reverb for AudioWorklet.
 *
 * The topology is Jon Dattorro's 1997 figure 1: a pre-delay, an input
 * bandwidth filter, four cascaded all-pass diffusers, and a figure-of-eight
 * "tank" of two coupled loops, each holding two all-passes, two long delays and
 * a damping filter. Stereo output is taken from fourteen fixed taps inside the
 * tank rather than from its loop signals, which is what gives the late field its
 * density without further delay lines.
 *
 *   Dattorro, "Effect Design Part 1: Reverberator and Other Filters", JAES 1997
 *   https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
 *
 * Derived from khoin/DattorroReverbNode (public domain), rewritten here for
 * four additions the original does not have, each taken from the paper or from
 * ordinary one-pole filter design -- see docs/log for why they are not ported
 * from Valley's Plateau, which is GPL-3:
 *
 *   1. SIZE. Every tank delay and output tap is scaled by a continuous factor,
 *      so one instance covers a tight plate through to a cathedral. Buffers are
 *      allocated for MAX_SIZE and read at a scaled offset from the write head,
 *      which is why each line here keeps one pointer, not the original's two.
 *   2. A high-pass beside each damping low-pass, in the tank and on the input.
 *      Dattorro damps only the top; without a matching low cut the tank pumps
 *      and muddies on sustained low material.
 *   3. HOLD. Decay to unity, input muted, tank filters bypassed -- an infinite
 *      freeze of whatever is in the tank.
 *   4. Two independent excursion phases, wrapped, rather than one accumulator
 *      read at two near-2pi multipliers.
 *
 * Runs on the audio thread, so the two rules from fm-processor.js hold here
 * too: no allocation in process(), and no imports.
 */

/* ------------------------------------------------------------------ *
 * Topology (Dattorro table 1; seconds, at his 29.761 kHz reference)
 * ------------------------------------------------------------------ */

/** Largest SIZE, and so the factor every tank buffer is over-allocated by. */
const MAX_SIZE = 4;

/** Pre-tank diffusers. Not scaled by SIZE: input smear is not room size. */
const INPUT_DELAYS = [0.004771345, 0.003595309, 0.012734787, 0.009307483];

/** Tank, as [diffuse, long, diffuse, long] per loop. Lines 4..11. */
const TANK_DELAYS = [
  0.022579886, 0.149625349, 0.060481839, 0.1249958, 0.030509727, 0.141695508, 0.089244313,
  0.106280031,
];

/**
 * Output taps: delay in seconds from where a line is written, which line, and
 * the sign of the sum.
 *
 * These are Dattorro's Table 2 values (at his 29.761 kHz reference: 266, 2974,
 * 1913 ... samples). His notation is `node48_54[266]` -- a delay line spanning
 * node 48 to node 54, indexed from node 48. Node numbers increase along the
 * signal path (node31_33 feeds node33_39, sharing node 33 as output then
 * input), so the index counts from the line's *input*: it is a delay.
 *
 * khoin/DattorroReverbNode reads them from the opposite end, so its tap of 266
 * on a 4217-sample line is a delay of 3950 rather than 266. That inverts the
 * whole output tap structure, which 1.3.6 calls "characteristic of the plate
 * emulation class". `_readTap` reads back from the write head instead.
 */
const TAP_TIME = [
  0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033, 0.006283391, 0.035818689,
  0.011861161, 0.121870905, 0.041262054, 0.08981553, 0.070931756, 0.011256342, 0.004065724,
];
const TAP_LINE = [9, 9, 10, 11, 5, 6, 7, 5, 5, 6, 7, 9, 10, 11];
const TAP_SIGN = [1, 1, -1, 1, -1, -1, -1, 1, 1, -1, 1, -1, -1, -1];

/** First seven taps sum to the left output, the rest to the right. */
const TAPS_PER_SIDE = 7;

const FIRST_TANK_LINE = 4;
const LINE_COUNT = INPUT_DELAYS.length + TANK_DELAYS.length;

/** Shortest a scaled tank line may become, leaving room for the interpolators. */
const MIN_LENGTH = 8;

/** Alternated into the tank each sample so a decaying loop never goes denormal. */
const ANTI_DENORMAL = 1e-20;

/** Decay used by HOLD. Below one so the tank cannot creep towards instability. */
const HOLD_DECAY = 0.9999;

/**
 * Ceiling on the tank all-pass coefficients.
 *
 * The reference node exposes these to 0.999999, where the tank stops decaying
 * and starts growing: measured peak 54 and still climbing after 60 s of silence
 * following a 2 s burst. Dattorro's own values are 0.7 and 0.5 (table 1), and
 * the paper caps decay diffusion 2 at 0.5. 0.8 leaves room to push the sound
 * well past his settings while every combination with decay = 1 still sustains
 * or decays rather than running away.
 */
const MAX_TANK_DIFFUSION = 0.8;

/** Seconds for SIZE and the HOLD input mute to reach their targets. */
const SMOOTH_SECONDS = 0.05;

const MAX_PRE_DELAY = 1;

/** Compensates the fourteen-tap sum, which is well above unity. */
const OUTPUT_TRIM = 0.6;

/** One-pole coefficient for a cutoff in Hz. */
function poleCoefficient(hz) {
  return 1 - Math.exp((-2 * Math.PI * Math.min(hz, sampleRate * 0.49)) / sampleRate);
}

class DattorroReverb extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    // prettier-ignore
    return [
      ['preDelay',      0,     0,    MAX_PRE_DELAY],
      ['inputLowCut',   20,    10,   1000],
      ['inputHighCut',  10000, 200,  20000],
      ['diffusionIn1',  0.75,  0,    1],
      ['diffusionIn2',  0.625, 0,    1],
      ['size',          1,     0.05, MAX_SIZE],
      ['decay',         0.7,   0,    1],
      ['diffusionTank1', 0.7,  0,    MAX_TANK_DIFFUSION],
      ['diffusionTank2', 0.5,  0,    MAX_TANK_DIFFUSION],
      ['tankLowCut',    20,    10,   1000],
      ['tankHighCut',   8000,  200,  20000],
      ['modRate',       0.5,   0,    8],
      ['modDepth',      0.7,   0,    4],
      ['hold',          0,     0,    1],
      ['wet',           1,     0,    1],
      ['dry',           0,     0,    1],
    ].map(([name, defaultValue, minValue, maxValue]) => ({
      name, defaultValue, minValue, maxValue, automationRate: 'k-rate',
    }));
  }

  constructor(options) {
    super(options);

    // Pre-delay is a plain ring, always a full second, rounded up to a whole
    // number of render quanta so a block write never straddles the wrap.
    this._preDelayLength = sampleRate + (128 - (sampleRate % 128));
    this._preDelay = new Float32Array(this._preDelayLength);
    this._preDelayWrite = 0;

    // One pointer per line; reads are computed backwards from it, which is what
    // lets SIZE change the delay lengths without reallocating.
    this._buffers = [];
    this._write = new Int32Array(LINE_COUNT);
    this._mask = new Int32Array(LINE_COUNT);
    this._nominal = new Float32Array(LINE_COUNT);
    this._length = new Float32Array(LINE_COUNT);
    this._lengthTarget = new Float32Array(LINE_COUNT);
    this._lengthStep = new Float32Array(LINE_COUNT);

    INPUT_DELAYS.forEach((seconds) => this._makeDelay(seconds, 1));
    TANK_DELAYS.forEach((seconds) => this._makeDelay(seconds, MAX_SIZE));

    this._tap = new Float32Array(TAP_TIME.length);
    this._tapStep = new Float32Array(TAP_TIME.length);

    this._inputLp = 0;
    this._inputHp = 0;
    this._dampLp = [0, 0];
    this._dampHp = [0, 0];

    this._excPhase = 0;
    this._excPhase2 = 0;
    this._denormal = ANTI_DENORMAL;

    this._size = 1;
    this._inputGain = 1;
    this._applySize(1, true);

    // Audio-load sampler (#445): identical to fm-processor.js's, off until a
    // `reportLoad` message turns it on. The plate is the other standing
    // processor on the audio thread, so a load figure that omitted it would
    // understate what the music costs.
    this._loadQuanta = 0;
    this._loadCount = 0;
    this._loadBusyMs = 0;
    this._loadPeakMs = 0;
    this._loadUnderruns = 0;
    this._loadWallStart = 0;
    this._loadBudgetMs = (128 / sampleRate) * 1000;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'reportLoad') return;
      this._loadQuanta = Math.max(0, msg.quanta | 0);
      this._loadCount = 0;
      this._loadBusyMs = 0;
      this._loadPeakMs = 0;
      this._loadWallStart = Date.now();
    };
  }

  /** One quantum's duty-cycle sample and the once-per-interval post (#445). */
  _sampleLoad(t0, t1) {
    const spanMs = t1 - t0;
    this._loadBusyMs += spanMs;
    if (spanMs > this._loadPeakMs) this._loadPeakMs = spanMs;
    // `spanMs - 1` is the provable lower bound on the render's duration; see
    // fm-processor.js `sampleLoad` for why the raw crossing count may not
    // accuse a quantum of missing its deadline.
    if (spanMs - 1 >= this._loadBudgetMs) this._loadUnderruns++;
    if (++this._loadCount < this._loadQuanta) return;
    this.port.postMessage({
      type: 'load',
      busyMs: this._loadBusyMs,
      wallMs: t1 - this._loadWallStart,
      quanta: this._loadCount,
      peakMs: this._loadPeakMs,
      underruns: this._loadUnderruns,
    });
    this._loadCount = 0;
    this._loadBusyMs = 0;
    this._loadPeakMs = 0;
    this._loadWallStart = t1;
  }

  /** The sampler wrapper; `_renderBlock` below is the plate itself. */
  process(inputs, outputs, parameters) {
    if (this._loadQuanta === 0) return this._renderBlock(inputs, outputs, parameters);
    const t0 = Date.now();
    const running = this._renderBlock(inputs, outputs, parameters);
    this._sampleLoad(t0, Date.now());
    return running;
  }

  /**
   * Allocate one line. `headroom` over-allocates so SIZE can stretch it; the
   * extra four samples are the cubic interpolator's reach past its read point.
   */
  _makeDelay(seconds, headroom) {
    const index = this._buffers.length;
    const nominal = seconds * sampleRate;
    const capacity = Math.ceil(nominal * headroom) + 4;
    const size = 2 ** Math.ceil(Math.log2(capacity));

    this._buffers.push(new Float32Array(size));
    this._mask[index] = size - 1;
    this._nominal[index] = nominal;
    this._length[index] = Math.max(1, nominal);
  }

  /**
   * Aim every scaled length and tap at `size`, as a per-sample ramp.
   *
   * Setting the lengths outright once a block is not enough. A two-second sweep
   * from 0.3 to 3 moves the longest line's read point by about 26 samples per
   * 128-sample block, so holding it constant within the block leaves a step at
   * every boundary -- measured at ten times the signal's own slew, and plainly
   * audible. Ramping across the block leaves only the Doppler shift, which is
   * what sweeping a delay line is supposed to sound like.
   */
  _applySize(size, immediate) {
    for (let i = FIRST_TANK_LINE; i < LINE_COUNT; i++) {
      this._lengthTarget[i] = Math.max(MIN_LENGTH, this._nominal[i] * size);
    }
    for (let t = 0; t < TAP_TIME.length; t++) {
      // Every tap is shorter than its own line, so scaling both keeps it inside
      // the valid history. The margin keeps the interpolator's second sample
      // behind the write head even at the longest tap.
      const target = Math.min(this._lengthTarget[TAP_LINE[t]] - 2, TAP_TIME[t] * sampleRate * size);
      if (immediate) this._tap[t] = target;
      this._tapStep[t] = immediate ? 0 : (target - this._tap[t]) / 128;
    }
    for (let i = FIRST_TANK_LINE; i < LINE_COUNT; i++) {
      if (immediate) this._length[i] = this._lengthTarget[i];
      this._lengthStep[i] = immediate ? 0 : (this._lengthTarget[i] - this._length[i]) / 128;
    }
  }

  /**
   * Read `offset` samples forward of the line's read point, interpolating.
   *
   * Lengths are fractional because SIZE moves them: rounding to whole samples
   * made a sweep step the read point, which measured as a sample-to-sample jump
   * ten times the signal's own slew -- an audible zipper on the one knob most
   * likely to be swept while a chord rings.
   */
  _read(index, offset) {
    const buffer = this._buffers[index];
    const mask = this._mask[index];
    const position = this._write[index] - this._length[index] + offset;
    const whole = Math.floor(position);
    const frac = position - whole;

    const a = buffer[whole & mask];
    const b = buffer[(whole + 1) & mask];
    return a + (b - a) * frac;
  }

  _write1(index, value) {
    this._buffers[index][this._write[index]] = value;
    return value;
  }

  /**
   * Fractional read `delay` samples back from the write head.
   *
   * The output taps are delays, not offsets from the oldest sample, so they do
   * not go through `_read` -- see the TAP_TIME note above.
   */
  _readTap(index, delay) {
    const buffer = this._buffers[index];
    const mask = this._mask[index];
    const position = this._write[index] - delay;
    const whole = Math.floor(position);
    const frac = position - whole;

    const a = buffer[whole & mask];
    const b = buffer[(whole + 1) & mask];
    return a + (b - a) * frac;
  }

  /**
   * Fractional read, `offset` samples forward of the line's read point.
   *
   * Cubic rather than linear because these two reads carry the tank's delay
   * modulation: linear interpolation is a lowpass whose cutoff moves with the
   * fraction, which the ear hears as a chirp on the modulated tail.
   * O. Niemitalo, https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
   */
  _readCubic(index, offset) {
    const buffer = this._buffers[index];
    const mask = this._mask[index];
    // Split the *whole* read position, exactly as _read does. Flooring
    // `write - length` on its own and taking the fraction from `offset` alone
    // drops the fractional part of the length, so every time SIZE carries the
    // length across an integer the read point jumps a full sample -- which is
    // the artefact the per-sample length ramp exists to remove, reintroduced on
    // the two lines that carry the modulation.
    const position = this._write[index] - this._length[index] + offset;
    const whole = Math.floor(position);
    const frac = position - whole;
    let at = whole - 1;

    const x0 = buffer[at++ & mask];
    const x1 = buffer[at++ & mask];
    const x2 = buffer[at++ & mask];
    const x3 = buffer[at & mask];

    const a = (3 * (x1 - x2) - x0 + x3) / 2;
    const b = 2 * x2 + x0 - (5 * x1 + x3) / 2;
    const c = (x2 - x0) / 2;
    return ((a * frac + b) * frac + c) * frac + x1;
  }

  /** Mono sum of the input into the pre-delay ring, and the dry output. */
  _writeInput(input, output, dry) {
    const left = output[0];
    const right = output[1];

    if (input.length >= 2) {
      for (let i = 0; i < 128; i++) {
        this._preDelay[this._preDelayWrite + i] = (input[0][i] + input[1][i]) * 0.5;
        left[i] = input[0][i] * dry;
        right[i] = input[1][i] * dry;
      }
    } else if (input.length === 1) {
      this._preDelay.set(input[0], this._preDelayWrite);
      for (let i = 0; i < 128; i++) {
        left[i] = right[i] = input[0][i] * dry;
      }
    } else {
      this._preDelay.fill(0, this._preDelayWrite, this._preDelayWrite + 128);
    }
  }

  /* eslint-disable-next-line max-lines-per-function -- Block-rate setup and
     the tank are one unit. The tank itself is eleven all-pass and delay stages
     whose order *is* the algorithm, each feeding the next; splitting it would
     hand a dozen intermediates across a call in the per-sample hot loop, and
     lifting the setup out would either allocate per block or scatter twenty
     coefficients across fields. Same exception, and same reason, as the voice
     loop in fm-processor.js. */
  _renderBlock(inputs, outputs, parameters) {
    const output = outputs[0];
    const wet = parameters.wet[0] * OUTPUT_TRIM;
    const held = parameters.hold[0] >= 0.5;

    this._writeInput(inputs[0] ?? [], output, parameters.dry[0]);

    // Smoothing runs per block. A block is 2.7 ms at 48 kHz, so a SIZE sweep
    // steps its delay lengths in sub-sample increments rather than zippering.
    const smooth = Math.min(1, 128 / (SMOOTH_SECONDS * sampleRate));
    this._size += smooth * (parameters.size[0] - this._size);
    this._inputGain += smooth * ((held ? 0 : 1) - this._inputGain);
    this._applySize(this._size, false);

    const preDelaySamples = Math.min(
      this._preDelayLength - 128,
      Math.round(parameters.preDelay[0] * sampleRate),
    );
    const inputLp = poleCoefficient(parameters.inputHighCut[0]);
    const inputHp = poleCoefficient(parameters.inputLowCut[0]);
    // HOLD bypasses the tank filters -- an infinite decay through a damper is
    // still a decay, just a slower and duller one -- but it bypasses their
    // *output*, not their coefficients. Freezing the high-pass by zeroing its
    // coefficient leaves `_dampHp` stuck at whatever it last held, and the tank
    // then subtracts that constant on every pass: a DC injection into a
    // lossless loop, which integrates. Measured on a 40 Hz tone it took a
    // frozen tank from 0.85 to 5.9 RMS over 55 s, while 220 Hz and 1 kHz --
    // which barely charge a 20 Hz high-pass -- held steady and hid it.
    // Both states keep tracking at their real coefficients so that releasing
    // HOLD does not step either filter.
    const dampLp = poleCoefficient(parameters.tankHighCut[0]);
    const dampHp = poleCoefficient(parameters.tankLowCut[0]);

    const diffuse1 = parameters.diffusionIn1[0];
    const diffuse2 = parameters.diffusionIn2[0];
    const decay = held ? HOLD_DECAY : parameters.decay[0];
    const tank1 = parameters.diffusionTank1[0];
    const tank2 = parameters.diffusionTank2[0];

    const excRate = parameters.modRate[0] / sampleRate;
    // Depth is in milliseconds, but must stay inside the line it modulates or
    // the interpolator would read across the write head.
    // Clamp against the shortest the two modulated lines reach at any point in
    // this block, since they are mid-ramp.
    const shortest = Math.min(
      this._length[4],
      this._length[8],
      this._lengthTarget[4],
      this._lengthTarget[8],
    );
    const excDepth = Math.min(
      (parameters.modDepth[0] * sampleRate) / 1000,
      (shortest - MIN_LENGTH) / 2,
    );

    for (let i = 0; i < 128; i++) {
      const delayed =
        this._preDelay[
          (this._preDelayLength + this._preDelayWrite - preDelaySamples + i) % this._preDelayLength
        ];

      this._inputLp += inputLp * (delayed * this._inputGain - this._inputLp);
      this._inputHp += inputHp * (this._inputLp - this._inputHp);
      const shaped = this._inputLp - this._inputHp;

      // Pre-tank: four all-passes, the first pair at diffusion 1, second at 2.
      let pre = this._write1(0, shaped - diffuse1 * this._read(0, 0));
      pre = this._write1(1, diffuse1 * (pre - this._read(1, 0)) + this._read(0, 0));
      pre = this._write1(2, diffuse1 * pre + this._read(1, 0) - diffuse2 * this._read(2, 0));
      pre = this._write1(3, diffuse2 * (pre - this._read(3, 0)) + this._read(2, 0));

      this._denormal = -this._denormal;
      const split = diffuse2 * pre + this._read(3, 0) + this._denormal;

      const exc = excDepth * (1 + Math.cos(this._excPhase * 2 * Math.PI));
      const exc2 = excDepth * (1 + Math.sin(this._excPhase2 * 2 * Math.PI));

      // Left loop. Line 11 is the right loop's output, and vice versa: the
      // cross-feed is what makes this a figure of eight rather than two tanks.
      let node = this._write1(
        4,
        split + decay * this._read(11, 0) + tank1 * this._readCubic(4, exc),
      );
      this._write1(5, this._readCubic(4, exc) - tank1 * node);
      const rawLeft = this._read(5, 0);
      this._dampLp[0] += dampLp * (rawLeft - this._dampLp[0]);
      this._dampHp[0] += dampHp * (this._dampLp[0] - this._dampHp[0]);
      const dampedLeft = held ? rawLeft : this._dampLp[0] - this._dampHp[0];
      node = this._write1(6, decay * dampedLeft - tank2 * this._read(6, 0));
      this._write1(7, this._read(6, 0) + tank2 * node);

      // Right loop.
      node = this._write1(8, split + decay * this._read(7, 0) + tank1 * this._readCubic(8, exc2));
      this._write1(9, this._readCubic(8, exc2) - tank1 * node);
      const rawRight = this._read(9, 0);
      this._dampLp[1] += dampLp * (rawRight - this._dampLp[1]);
      this._dampHp[1] += dampHp * (this._dampLp[1] - this._dampHp[1]);
      const dampedRight = held ? rawRight : this._dampLp[1] - this._dampHp[1];
      node = this._write1(10, decay * dampedRight - tank2 * this._read(10, 0));
      this._write1(11, this._read(10, 0) + tank2 * node);

      let left = 0;
      let right = 0;
      for (let t = 0; t < TAP_TIME.length; t++) {
        const sample = TAP_SIGN[t] * this._readTap(TAP_LINE[t], this._tap[t]);
        if (t < TAPS_PER_SIDE) left += sample;
        else right += sample;
      }

      output[0][i] += left * wet;
      output[1][i] += right * wet;

      this._excPhase += excRate;
      if (this._excPhase >= 1) this._excPhase -= 1;
      // Detuned from the first so the two loops never modulate in lockstep.
      this._excPhase2 += excRate * 1.0007;
      if (this._excPhase2 >= 1) this._excPhase2 -= 1;

      for (let line = 0; line < LINE_COUNT; line++) {
        this._write[line] = (this._write[line] + 1) & this._mask[line];
        this._length[line] += this._lengthStep[line];
      }
      for (let t = 0; t < TAP_TIME.length; t++) {
        this._tap[t] += this._tapStep[t];
      }
    }

    this._preDelayWrite = (this._preDelayWrite + 128) % this._preDelayLength;
    // Always true: a reverb must keep rendering its tail after its input stops.
    return true;
  }
}

registerProcessor('dattorro-reverb', DattorroReverb);
