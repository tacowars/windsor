/* eslint-disable no-magic-numbers -- DSP: the quantum of 128, the line indices, the modulation's four points and its smoothstep are the algorithm; the tunables are reverbConstants.ts (#671), reverbModulationTables.ts (windsor#764) and reverbTapTables.ts (windsor#766) */
/**
 * The plate's awake render (#671): one quantum, after `plateInput.ts` has
 * written each input channel into its own pre-delay ring, through the
 * pre-delays, the input filters, the two chains of four diffusers, Build's
 * multi-tap delay, the figure-of-eight tank and the output taps
 * (`_renderBlock`, the taps' reads written out: `reverbTapTables.ts`, windsor#766), with the sleep bookkeeping (#547) at its end. The input
 * is stereo (windsor#763): L runs through lines 0..3 and R through lines
 * 12..15, both written out, at the same pre-delay, filter coefficients and diffusions, so a
 * panned source keeps its side. Build (windsor#761, `plateBuild.ts`) writes
 * each chain's diffused sample into its own line and reads one side's taps
 * back from each, linear between samples: L's sum feeds the right loop (line
 * 8) and R's the left loop (line 4), because each output reads the larger
 * share of its tap weight from the half its own input feeds, and each sum goes to its own
 * side of the wet output at the direct level. Its reads and sums are written
 * out in the sample loop too, never called (`mixer/reverbBuild.test.ts`). The
 * modulation (windsor#764, `plateModulation.ts`) moves all four tank
 * all-passes (lines 4, 6, 8 and 10, each read cubic), each point's smoothed
 * noise and excursion written out here too, its knots read from the shared
 * draws with no call and no `Math` transcendental. Decay reaches the tank as a gain point on
 * each of its eight lines (windsor#748): `tankGains.ts` sets them once a block, the loop
 * ramps them a sample at a time, and while the low band runs
 * (`plateLowBand.ts`) each point is its first-order shelf, written out here at
 * all eight points: no helper is called per sample (worklet rule 6, fix round
 * 2 of PR windsor#750), and `mixer/reverbLowBand.test.ts` reads the sample
 * loop's calls off the bundle. The voicing (windsor#746, `plateVoicing.ts`)
 * picks the rows the loop reads: the output taps' lines and signed gains,
 * their trim, Build's table and the input lines' lengths, swapped at a block
 * boundary; while a switch ducks, `voicingBlock` hands the block the
 * parameters as they stood, and the duck's gain on the tank's feed and the
 * wet output is ramped a sample at a time here, written out
 * (`mixer/reverbVoicing.test.ts`). `_renderBlock` stays one function read top to bottom --
 * its stages' order is the algorithm. Both are functions over the
 * processor, installed on its prototype by `reverbProcessor.ts`, so each body
 * is the method it was in the hand-written `reverb-processor.js`, line for
 * line, but for how a sample crosses a call (windsor#227): the reads leave
 * theirs in `this._value`, `_write1` stores `this._value`, the cubic reads take
 * their excursion in `this._offset`, and the block's one-pole coefficients
 * land in `this._poles` (`platePoles.ts`). V8 boxes a double passed to or
 * returned from a call it does not inline, a heap allocation each (`delayLines.ts`). Invariant: no
 * allocation in the render. `mixer/reverbGolden.test.ts` pins every sample;
 * `mixer/reverbProcessor.test.ts` and `mixer/reverbSleep.test.ts` hold its
 * behaviour, and `mixer/reverbAllocation.test.ts` its allocation on V8.
 */

import { LINE_COUNT, SLEEP_OUTPUT_FLOOR, SMOOTH_SECONDS } from './reverbConstants';
import { configureBuild } from './plateBuild';
import { poleCoefficients } from './platePoles';
import { BUILD_TAPS_PER_SIDE } from './reverbBuildTables';
import type { DattorroReverb } from './reverbProcessor';
import { configureGains } from './tankGains';
import { configureModulation, MOD_DRAWS } from './plateModulation';
import { MOD_DRAW_LENGTH, MOD_HALF, MOD_WIDTH_MIN } from './reverbModulationTables';
import { TAPS_PER_SIDE } from './reverbTapTables';
import { DUCK_IDLE, endVoicingBlock, voicingBlock } from './plateVoicing';

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
  live: Record<string, Float32Array>,
): boolean {
  const output = outputs[0];
  // The voicing (windsor#746, `plateVoicing.ts`): the row the tank reads and
  // its duck. While the duck goes down, the block renders with every
  // parameter as it stood before the change.
  const parameters = voicingBlock(this, live);
  const trim = this._outputTrim;
  const wet = parameters.wet[0] * trim;
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
  this._build += smooth * (parameters.build[0] - this._build);
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
  // The modulation (`plateModulation.ts`): this block's speed and each
  // point's depth, clamped against its own line and ramped across the block;
  // set first, since each all-pass's gain is cut for its excursion.
  configureModulation(this, parameters);
  // Decay, Size and HOLD as each tank line's gain, ramped across the block.
  configureGains(this, parameters, held);
  const band = this._band;
  const ramping = this._ramping;
  const gain = this._gain;
  const extra = this._lowExtra;
  // The low band's shelf, written out at each point below: its lowpasses'
  // states, their coefficient, and whether they start from this sample.
  const lowState = this._lowState;
  const cross = this._cross;
  let seed = this._seedBand;
  let x: number;
  let delta: number;
  let low: number;
  const tank1 = parameters.diffusionTank1[0];
  const tank2 = parameters.diffusionTank2[0];

  // Build (`plateBuild.ts`): the taps' times and gains and the direct level,
  // ramped across the block; the reads are written out below.
  configureBuild(this, parameters);
  const buildLine = this._buildLine;
  const buildLineRight = this._buildLineRight;
  // R's chain, read in the loop below.
  const buffers = this._buffers;
  const writes = this._write;
  const masks = this._mask;
  const lengths = this._length;
  const leftReads = this._leftReads;
  const rightReads = this._rightReads;
  let first: number;
  let line: Float32Array;
  let v: number;
  const buildMask = this._buildMask;
  const buildTime = this._buildTime;
  const buildTimeStep = this._buildTimeStep;
  const buildGain = this._buildGain;
  const buildGainStep = this._buildGainStep;
  const buildDirect = this._buildDirect;
  const buildRamping = this._buildRamping;
  let buildWrite = this._buildWrite;
  let direct = buildDirect[0];
  let position: number;
  let whole: number;
  let a: number;
  // The output taps' delays in samples, and the voicing's lines and signed
  // gains, read in the loop below.
  const taps = this._tap;
  const tapLines = this._tapLine;
  const tapGains = this._tapGain;
  // The duck's gain on the tank's feed and the wet output, ramped a sample at
  // a time while a switch of voicing runs.
  const ducking = this._duckState !== DUCK_IDLE;
  const duckStep = this._duckStep;
  let duck = this._duck;

  const stepping = this._stepping || !this._settledSkip;
  // Each modulation point's source, written out below.
  const modCursor = this._modCursor;
  const modFrom = this._modFrom;
  const modSpan = this._modSpan;
  const modPhase = this._modPhase;
  const modDt = this._modDt;
  const modOffset = this._modOffset;
  const modDepth = this._modDepth;
  const modDepthStep = this._modDepthStep;
  let draw: number;

  for (let i = 0; i < 128; i++) {
    const delayedAt =
      (this._preDelayLength + this._preDelayWrite - preDelaySamples + i) % this._preDelayLength;
    const delayed = this._preDelay[delayedAt];
    const delayedRight = this._preDelayRight[delayedAt];

    // HOLD's input mute (`_inputGain`) on both channels, ahead of their
    // filters and diffusers, so what either chain holds drains into the tank.
    this._inputLp += inputLp * (delayed * this._inputGain - this._inputLp);
    this._inputHp += inputHp * (this._inputLp - this._inputHp);
    const shaped = this._inputLp - this._inputHp;
    this._inputLpRight += inputLp * (delayedRight * this._inputGain - this._inputLpRight);
    this._inputHpRight += inputHp * (this._inputLpRight - this._inputHpRight);
    const shapedRight = this._inputLpRight - this._inputHpRight;

    // Pre-tank, both chains (L's lines 0..3, R's 12..15, of the voicing's
    // lengths): four all-passes each, the first pair at diffusion 1, the
    // second at 2. The reads are written out, not called: each line is read
    // once, linear between samples as `_read` reads it, since a line's sample
    // is not written before both its reads (its length is over one sample),
    // and the stages are the expressions the hand-written file summed its
    // returning reads in. L's chain went from `_read` and `_write1` to this
    // form with windsor#746, to the bit.
    for (let k = 0; k < 4; k++) {
      line = buffers[k];
      position = writes[k] - lengths[k];
      whole = Math.floor(position);
      a = line[whole & masks[k]];
      leftReads[k] = a + (line[(whole + 1) & masks[k]] - a) * (position - whole);
      line = buffers[k + 12];
      position = writes[k + 12] - lengths[k + 12];
      whole = Math.floor(position);
      a = line[whole & masks[k + 12]];
      rightReads[k] = a + (line[(whole + 1) & masks[k + 12]] - a) * (position - whole);
    }
    v = shaped - diffuse1 * leftReads[0];
    buffers[0][writes[0]] = v;
    v = diffuse1 * (v - leftReads[1]) + leftReads[0];
    buffers[1][writes[1]] = v;
    v = diffuse1 * v + leftReads[1] - diffuse2 * leftReads[2];
    buffers[2][writes[2]] = v;
    v = diffuse2 * (v - leftReads[3]) + leftReads[2];
    buffers[3][writes[3]] = v;
    // Each chain's diffused sample into its Build line.
    buildLine[buildWrite] = diffuse2 * v + leftReads[3];
    v = shapedRight - diffuse1 * rightReads[0];
    buffers[12][writes[12]] = v;
    v = diffuse1 * (v - rightReads[1]) + rightReads[0];
    buffers[13][writes[13]] = v;
    v = diffuse1 * v + rightReads[1] - diffuse2 * rightReads[2];
    buffers[14][writes[14]] = v;
    v = diffuse2 * (v - rightReads[3]) + rightReads[2];
    buffers[15][writes[15]] = v;
    buildLineRight[buildWrite] = diffuse2 * v + rightReads[3];

    // Build: each side's taps read back from its own line, linear between
    // samples as the tank's reads are, and summed at their gains. L's sum
    // feeds the right loop (line 8) and R's the left loop (line 4), so each
    // side reaches first the loop its own output taps weigh most.
    let buildLeft = 0;
    for (let t = 0; t < BUILD_TAPS_PER_SIDE; t++) {
      position = buildWrite - buildTime[t];
      whole = Math.floor(position);
      a = buildLine[whole & buildMask];
      buildLeft +=
        (a + (buildLine[(whole + 1) & buildMask] - a) * (position - whole)) * buildGain[t];
    }
    let buildRight = 0;
    for (let t = BUILD_TAPS_PER_SIDE; t < buildTime.length; t++) {
      position = buildWrite - buildTime[t];
      whole = Math.floor(position);
      a = buildLineRight[whole & buildMask];
      buildRight +=
        (a + (buildLineRight[(whole + 1) & buildMask] - a) * (position - whole)) * buildGain[t];
    }
    // The duck (`plateVoicing.ts`), written out: down to 0 or up to 1, and
    // held there, on the feed and on the wet output alike.
    if (ducking) {
      duck += duckStep;
      duck = duck < 0 ? 0 : duck > 1 ? 1 : duck;
    }
    this._denormal = -this._denormal;
    const splitLeft = buildRight * duck + this._denormal;
    const splitRight = buildLeft * duck + this._denormal;

    // The modulation (`plateModulation.ts`): each point's smoothed noise, one
    // drawn knot to the next along 3a² − 2a³, and its excursion. At a knot the
    // point turns, draws the next knot in the other half of its range and the
    // next segment's width, and carries the sample's leftover time across.
    for (let p = 0; p < 4; p++) {
      a = modPhase[p] + modDt[p];
      if (a >= 1) {
        a = (a - 1) / modDt[p];
        modFrom[p] += modSpan[p];
        this._modRising[p] = 1 - this._modRising[p];
        whole = p * MOD_DRAW_LENGTH + modCursor[p];
        modCursor[p] = (modCursor[p] + 2) & (MOD_DRAW_LENGTH - 1);
        draw = MOD_HALF * MOD_DRAWS[whole];
        modSpan[p] = (this._modRising[p] === 1 ? MOD_HALF + draw : draw) - modFrom[p];
        this._modWidth[p] = MOD_WIDTH_MIN + MOD_DRAWS[whole + 1];
        modDt[p] = this._modSpeed / this._modWidth[p];
        a *= modDt[p];
      }
      modPhase[p] = a;
      modOffset[p] = modDepth[p] * (modFrom[p] + modSpan[p] * a * a * (3 - 2 * a));
      modDepth[p] += modDepthStep[p];
    }

    // Left loop. Line 11 is the right loop's output, and vice versa: the
    // cross-feed is what makes this a figure of eight rather than two tanks.
    // Each line's gain point (`tankGains.ts`) takes its sample in `_value`:
    // the plain gain, or the low band's shelf while it runs, g x + (gL − g) lp
    // with lp the trapezoidal one-pole in its integrator form, as the Retro
    // Reverb's (`retroTank.ts`, `writeSplit`). Point p is line p + 4; an
    // all-pass's point sits on the delayed sample both its sums read.
    this._read(11, 0);
    if (band) {
      x = this._value;
      if (seed) lowState[7] = x;
      delta = (x - lowState[7]) * cross;
      low = lowState[7] + delta;
      lowState[7] = low + delta;
      this._value = gain[7] * x + extra[7] * low;
    } else this._value *= gain[7];
    first = this._value;
    this._offset = modOffset[0];
    this._readCubic(4);
    if (band) {
      x = this._value;
      if (seed) lowState[0] = x;
      delta = (x - lowState[0]) * cross;
      low = lowState[0] + delta;
      lowState[0] = low + delta;
      this._value = gain[0] * x + extra[0] * low;
    } else this._value *= gain[0];
    let tapped = this._value;
    this._value = splitLeft + first + tank1 * tapped;
    this._write1(4);
    this._value = tapped - tank1 * this._value;
    this._write1(5);
    this._read(5, 0);
    const rawLeft = this._value;
    this._dampLp[0] += dampLp * (rawLeft - this._dampLp[0]);
    this._dampHp[0] += dampHp * (this._dampLp[0] - this._dampHp[0]);
    this._value = held ? rawLeft : this._dampLp[0] - this._dampHp[0];
    if (band) {
      x = this._value;
      if (seed) lowState[1] = x;
      delta = (x - lowState[1]) * cross;
      low = lowState[1] + delta;
      lowState[1] = low + delta;
      this._value = gain[1] * x + extra[1] * low;
    } else this._value *= gain[1];
    first = this._value;
    this._offset = modOffset[1];
    this._readCubic(6);
    if (band) {
      x = this._value;
      if (seed) lowState[2] = x;
      delta = (x - lowState[2]) * cross;
      low = lowState[2] + delta;
      lowState[2] = low + delta;
      this._value = gain[2] * x + extra[2] * low;
    } else this._value *= gain[2];
    tapped = this._value;
    this._value = first - tank2 * tapped;
    this._write1(6);
    this._value = tapped + tank2 * this._value;
    this._write1(7);

    // Right loop.
    this._read(7, 0);
    if (band) {
      x = this._value;
      if (seed) lowState[3] = x;
      delta = (x - lowState[3]) * cross;
      low = lowState[3] + delta;
      lowState[3] = low + delta;
      this._value = gain[3] * x + extra[3] * low;
    } else this._value *= gain[3];
    first = this._value;
    this._offset = modOffset[2];
    this._readCubic(8);
    if (band) {
      x = this._value;
      if (seed) lowState[4] = x;
      delta = (x - lowState[4]) * cross;
      low = lowState[4] + delta;
      lowState[4] = low + delta;
      this._value = gain[4] * x + extra[4] * low;
    } else this._value *= gain[4];
    tapped = this._value;
    this._value = splitRight + first + tank1 * tapped;
    this._write1(8);
    this._value = tapped - tank1 * this._value;
    this._write1(9);
    this._read(9, 0);
    const rawRight = this._value;
    this._dampLp[1] += dampLp * (rawRight - this._dampLp[1]);
    this._dampHp[1] += dampHp * (this._dampLp[1] - this._dampHp[1]);
    this._value = held ? rawRight : this._dampLp[1] - this._dampHp[1];
    if (band) {
      x = this._value;
      if (seed) lowState[5] = x;
      delta = (x - lowState[5]) * cross;
      low = lowState[5] + delta;
      lowState[5] = low + delta;
      this._value = gain[5] * x + extra[5] * low;
    } else this._value *= gain[5];
    first = this._value;
    this._offset = modOffset[3];
    this._readCubic(10);
    if (band) {
      x = this._value;
      if (seed) lowState[6] = x;
      delta = (x - lowState[6]) * cross;
      low = lowState[6] + delta;
      lowState[6] = low + delta;
      this._value = gain[6] * x + extra[6] * low;
    } else this._value *= gain[6];
    tapped = this._value;
    this._value = first - tank2 * tapped;
    this._write1(10);
    this._value = tapped + tank2 * this._value;
    this._write1(11);

    // The output taps (`reverbTapTables.ts`), each read `taps[t]` samples back
    // from its line's write head, linear between samples, at its signed gain:
    // the first TAPS_PER_SIDE to the left, the rest to the right. Written
    // out, never called (windsor#766), as R's chain is.
    let left = 0;
    for (let t = 0; t < TAPS_PER_SIDE; t++) {
      const tapLine = tapLines[t];
      line = buffers[tapLine];
      position = writes[tapLine] - taps[t];
      whole = Math.floor(position);
      a = line[whole & masks[tapLine]];
      left += (a + (line[(whole + 1) & masks[tapLine]] - a) * (position - whole)) * tapGains[t];
    }
    let right = 0;
    for (let t = TAPS_PER_SIDE; t < taps.length; t++) {
      const tapLine = tapLines[t];
      line = buffers[tapLine];
      position = writes[tapLine] - taps[t];
      whole = Math.floor(position);
      a = line[whole & masks[tapLine]];
      right += (a + (line[(whole + 1) & masks[tapLine]] - a) * (position - whole)) * tapGains[t];
    }
    // Build's direct path: each input's tap sum on its own side, ahead of the tail.
    left += buildLeft * direct;
    right += buildRight * direct;

    output[0][i] += left * wet * duck;
    output[1][i] += right * wet * duck;
    if (inputQuiet) {
      // Read at wet 1 and before the duck, so a ducked tail is not taken for silence.
      const magnitude = Math.max(Math.abs(left), Math.abs(right)) * trim;
      if (magnitude > loudest) loudest = magnitude;
    }

    if (ramping) {
      for (let p = 0; p < gain.length; p++) {
        gain[p] += this._gainStep[p];
        extra[p] += this._lowExtraStep[p];
      }
    }
    seed = false;
    buildWrite = (buildWrite + 1) & buildMask;
    if (buildRamping) {
      for (let t = 0; t < buildTime.length; t++) {
        buildTime[t] += buildTimeStep[t];
        buildGain[t] += buildGainStep[t];
      }
      direct += buildDirect[2];
    }

    for (let line = 0; line < LINE_COUNT; line++) {
      this._write[line] = (this._write[line] + 1) & this._mask[line];
    }
    if (stepping) {
      // Every line: the room voicing's input lines follow Size too (windsor#746).
      for (let line = 0; line < LINE_COUNT; line++) {
        this._length[line] += this._lengthStep[line];
      }
      for (let t = 0; t < taps.length; t++) {
        this._tap[t] += this._tapStep[t];
      }
    }
  }

  if (band) this._seedBand = false;
  this._buildWrite = buildWrite;
  this._preDelayWrite = (this._preDelayWrite + 128) % this._preDelayLength;
  this._duck = duck;
  endVoicingBlock(this);

  if (inputQuiet && loudest <= SLEEP_OUTPUT_FLOOR) this._quiet += 128;
  else this._quiet = 0;
  if (this._quiet > this._sleepSpan) this._sleep();
  // Always true, asleep or not: a reverb must keep rendering its tail after
  // its input stops, and must be there to wake when the input returns.
  return true;
}

export { _renderBlock };
