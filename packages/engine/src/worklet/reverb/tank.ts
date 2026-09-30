/* eslint-disable no-magic-numbers -- DSP: the quantum of 128, the mono sum's half, the tank's line indices and the modulation's detune are the algorithm; the tunables are reverbConstants.ts (#671) */
/**
 * The plate's awake render (#671): the input's mono sum into the pre-delay
 * ring with the dry output (`_writeInput`), and one quantum through the
 * pre-delay, the input filters, the four diffusers, the figure-of-eight tank
 * and the fourteen output taps (`_renderBlock`), with the sleep bookkeeping
 * (#547) at its end. `_renderBlock` stays one function read top to bottom --
 * its eleven stages' order is the algorithm. Both are functions over the
 * processor, installed on its prototype by `reverbProcessor.ts`, so each body
 * is the method it was in the hand-written `reverb-processor.js`, line for
 * line, but for how a sample crosses a call (windsor#227): the reads leave
 * theirs in `this._value`, `_write1` stores `this._value`, the cubic reads take
 * their excursion in `this._offset`, and the block's one-pole coefficients
 * land in `this._poles`. V8 boxes a double passed to or returned from a call
 * it does not inline, a heap allocation each (`delayLines.ts`). Invariant: no
 * allocation in the render. `mixer/reverbGolden.test.ts` pins every sample;
 * `mixer/reverbProcessor.test.ts` and `mixer/reverbSleep.test.ts` hold its
 * behaviour, and `mixer/reverbAllocation.test.ts` its allocation on V8.
 */

import {
  FIRST_TANK_LINE,
  HOLD_DECAY,
  LINE_COUNT,
  MIN_LENGTH,
  OUTPUT_TRIM,
  SLEEP_OUTPUT_FLOOR,
  SMOOTH_SECONDS,
  TAP_SIGN,
  TAP_TIME,
  TAPS_PER_SIDE,
} from './reverbConstants';
import type { DattorroReverb } from './reverbProcessor';

/** The parameters the block's one-pole coefficients are cut from, in `_poles` order. */
const POLE_CUTS = ['inputHighCut', 'inputLowCut', 'tankHighCut', 'tankLowCut'];

/**
 * Each one-pole coefficient for this block's cutoffs in Hz, into `poles`. One
 * call for all four, and nothing but arrays crosses it: a coefficient
 * returned from a call V8 does not inline is a new heap number.
 */
function poleCoefficients(parameters: Record<string, Float32Array>, poles: Float64Array): void {
  for (let k = 0; k < POLE_CUTS.length; k++) {
    const hz = parameters[POLE_CUTS[k]][0];
    poles[k] = 1 - Math.exp((-2 * Math.PI * Math.min(hz, sampleRate * 0.49)) / sampleRate);
  }
}

/**
 * Mono sum of the input into the pre-delay ring, and the dry output. It reads
 * `dry` from the parameters itself, so no double crosses the call.
 */
function _writeInput(
  this: DattorroReverb,
  input: Float32Array[],
  output: Float32Array[],
  parameters: Record<string, Float32Array>,
): void {
  const dry = parameters.dry[0];
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
function _renderBlock(
  this: DattorroReverb,
  inputs: Float32Array[][],
  outputs: Float32Array[][],
  parameters: Record<string, Float32Array>,
): boolean {
  const output = outputs[0];
  const wet = parameters.wet[0] * OUTPUT_TRIM;
  const held = parameters.hold[0] >= 0.5;
  const input = inputs[0] ?? [];

  // Read before the pre-delay write below; the tank's own silence is gathered
  // in the sample loop as `loudest`.
  const inputQuiet = this._sleepEnabled && !held && this._inputQuiet(input);
  let loudest = 0;

  this._writeInput(input, output, parameters);

  // Smoothing runs per block. A block is 2.7 ms at 48 kHz, so a SIZE sweep
  // steps its delay lengths in sub-sample increments rather than zippering.
  const smooth = Math.min(1, 128 / (SMOOTH_SECONDS * sampleRate));
  this._size += smooth * (parameters.size[0] - this._size);
  this._inputGain += smooth * ((held ? 0 : 1) - this._inputGain);
  this._applySize(false);

  const preDelaySamples = Math.min(
    this._preDelayLength - 128,
    Math.round(parameters.preDelay[0] * sampleRate),
  );
  const poles = this._poles;
  poleCoefficients(parameters, poles);
  const inputLp = poles[0];
  const inputHp = poles[1];
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
  const dampLp = poles[2];
  const dampHp = poles[3];

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
  const stepping = this._stepping || !this._settledSkip;
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
    // Each read leaves its sample in `_value`, and `_write1` stores `_value`;
    // every expression is the one the returning reads were summed in.
    this._read(0, 0);
    this._value = shaped - diffuse1 * this._value;
    this._write1(0);
    let pre = this._value;
    this._read(1, 0);
    let first = this._value;
    this._read(0, 0);
    this._value = diffuse1 * (pre - first) + this._value;
    this._write1(1);
    pre = this._value;
    this._read(1, 0);
    first = this._value;
    this._read(2, 0);
    this._value = diffuse1 * pre + first - diffuse2 * this._value;
    this._write1(2);
    pre = this._value;
    this._read(3, 0);
    first = this._value;
    this._read(2, 0);
    this._value = diffuse2 * (pre - first) + this._value;
    this._write1(3);
    pre = this._value;

    this._denormal = -this._denormal;
    this._read(3, 0);
    const split = diffuse2 * pre + this._value + this._denormal;

    const exc = excDepth * (1 + Math.cos(this._excPhase * 2 * Math.PI));
    const exc2 = excDepth * (1 + Math.sin(this._excPhase2 * 2 * Math.PI));

    // Left loop. Line 11 is the right loop's output, and vice versa: the
    // cross-feed is what makes this a figure of eight rather than two tanks.
    this._read(11, 0);
    first = this._value;
    this._offset = exc;
    this._readCubic(4);
    this._value = split + decay * first + tank1 * this._value;
    this._write1(4);
    let node = this._value;
    this._readCubic(4);
    this._value = this._value - tank1 * node;
    this._write1(5);
    this._read(5, 0);
    const rawLeft = this._value;
    this._dampLp[0] += dampLp * (rawLeft - this._dampLp[0]);
    this._dampHp[0] += dampHp * (this._dampLp[0] - this._dampHp[0]);
    const dampedLeft = held ? rawLeft : this._dampLp[0] - this._dampHp[0];
    this._read(6, 0);
    this._value = decay * dampedLeft - tank2 * this._value;
    this._write1(6);
    node = this._value;
    this._read(6, 0);
    this._value = this._value + tank2 * node;
    this._write1(7);

    // Right loop.
    this._read(7, 0);
    first = this._value;
    this._offset = exc2;
    this._readCubic(8);
    this._value = split + decay * first + tank1 * this._value;
    this._write1(8);
    node = this._value;
    this._readCubic(8);
    this._value = this._value - tank1 * node;
    this._write1(9);
    this._read(9, 0);
    const rawRight = this._value;
    this._dampLp[1] += dampLp * (rawRight - this._dampLp[1]);
    this._dampHp[1] += dampHp * (this._dampLp[1] - this._dampHp[1]);
    const dampedRight = held ? rawRight : this._dampLp[1] - this._dampHp[1];
    this._read(10, 0);
    this._value = decay * dampedRight - tank2 * this._value;
    this._write1(10);
    node = this._value;
    this._read(10, 0);
    this._value = this._value + tank2 * node;
    this._write1(11);

    let left = 0;
    let right = 0;
    for (let t = 0; t < TAP_TIME.length; t++) {
      this._readTap(t);
      const sample = TAP_SIGN[t] * this._value;
      if (t < TAPS_PER_SIDE) left += sample;
      else right += sample;
    }

    output[0][i] += left * wet;
    output[1][i] += right * wet;
    if (inputQuiet) {
      const magnitude = Math.max(Math.abs(left), Math.abs(right)) * OUTPUT_TRIM;
      if (magnitude > loudest) loudest = magnitude;
    }

    this._excPhase += excRate;
    if (this._excPhase >= 1) this._excPhase -= 1;
    // Detuned from the first so the two loops never modulate in lockstep.
    this._excPhase2 += excRate * 1.0007;
    if (this._excPhase2 >= 1) this._excPhase2 -= 1;

    for (let line = 0; line < LINE_COUNT; line++) {
      this._write[line] = (this._write[line] + 1) & this._mask[line];
    }
    if (stepping) {
      for (let line = FIRST_TANK_LINE; line < LINE_COUNT; line++) {
        this._length[line] += this._lengthStep[line];
      }
      for (let t = 0; t < TAP_TIME.length; t++) {
        this._tap[t] += this._tapStep[t];
      }
    }
  }

  this._preDelayWrite = (this._preDelayWrite + 128) % this._preDelayLength;

  if (inputQuiet && loudest <= SLEEP_OUTPUT_FLOOR) this._quiet += 128;
  else this._quiet = 0;
  if (this._quiet > this._sleepSpan) this._sleep();
  // Always true, asleep or not: a reverb must keep rendering its tail after
  // its input stops, and must be there to wake when the input returns.
  return true;
}

export { poleCoefficients, _writeInput, _renderBlock };
