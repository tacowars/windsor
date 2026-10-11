/**
 * bloom's signal path:
 *
 *   in ─┬──────────────────────────────────────────────────────────────────────────────────────────▶ dry ─┐
 *       └▶ (L+R)/2 ─▶ ÷D ═▶ bands ═▶ select ═▶ shared gain ═▶ ceiling ═▶ envelope ═▶ generator ═▶ synth ─▶ tone ─▶ output ─┴▶ out
 *          bloomDecimator.ts bloomBands.ts  bloomDynamics.ts         bloomEnvelope.ts bloomGenerator.ts bloomSynth.ts bloomTone.ts bloomOutput.ts
 *
 * ─ runs at the host rate, ═ at the analysis rate, host / D
 * (`bloomDecimator.ts`: D = 4 at 44.1/48 kHz, 8 at 88.2/96 kHz). Every D
 * host samples the decimator gives one analysis sample, and the analysis
 * modules `tick` once on it; every segment (`segmentHz`; whole steps:
 * 8 host samples at 44.1/48 kHz, 16 at 88.2/96 kHz) the synthesis renders the next segment from
 * where the last step left each band (`bloomSynth.ts`), which the output
 * mixes one sample at a time.
 *
 * Each module owns its controls (read from `slots`, raw this block, or
 * `controls`, the continuous ones smoothed here once a block) and its
 * tunables (`inserts/bloom<Module>Constants.ts`). Its `configure` runs once a
 * block, in the order above; samples pass between modules through fields
 * and per-band `Float64Array`s, so no double crosses a call (rule 2), and
 * every double field is born NaN (rule 7). The generated layer is late by
 * the bands' group delay, plus the decimator's delay,
 * one segment and the tone's filter (0.4 ms at 48 kHz); bloom reports no latency and the dry
 * path is undelayed. The segments run on their own count, so the output
 * does not depend on the host's block size.
 *
 * The on/off switch is the output's `level`. The first block that starts
 * fully off clears everything; while off nothing runs and the input is copied
 * to the bit, and switching on starts from rest.
 *
 * The wet-path slot: `sendLeft`/`sendRight` (the layer after Amount) and
 * `sendGain` (Mix's wet share × switch × split) leave beside `left`/`right`,
 * for the processor's outputs 1 and 2 (`bloomOutput.ts`). Dormant, they are 0.
 *
 * Sleep: once the input has been under `sleepInputFloor` for
 * `sleepWaitSeconds` and a whole block of the generated layer has stayed under
 * `sleepOutputFloor`, every state is cleared and `rest` runs instead of `run`
 * until the input returns, so waking is bit-identical to a fresh insert.
 *
 * Pinned by `inserts/bloomDsp.test.ts`, `bloomAllocation.test.ts` and
 * `bloomGolden.test.ts`.
 */
import { BLOOM_DSP as C } from '../../inserts/bloomConstants';
import { BloomBands } from './bloomBands';
import { BloomDecimator } from './bloomDecimator';
import { BloomDynamics } from './bloomDynamics';
import { BloomEnvelope } from './bloomEnvelope';
import { BloomGenerator } from './bloomGenerator';
import { BloomOutput } from './bloomOutput';
import { BloomSynth } from './bloomSynth';
import { BloomTone } from './bloomTone';
import { bloomOnePoleStep } from './bloomPortable';
import { BLOOM_SMOOTHED_MASK } from './bloomSlots';

class BloomDsp {
  rate: number;
  /** This block's control values, in descriptor order, and the continuous ones smoothed. */
  slots: Float64Array;
  controls: Float64Array;
  blockStep: number;
  blockFrames: number;
  decimator: BloomDecimator;
  bands: BloomBands;
  dynamics: BloomDynamics;
  envelope: BloomEnvelope;
  generator: BloomGenerator;
  output: BloomOutput;
  synth: BloomSynth;
  tone: BloomTone;
  /** Host samples a synthesis segment (whole analysis steps), and the sample within the current one. */
  segment: number;
  phase: number;
  /** Fully off with everything cleared: `tick` copies the input and runs nothing. */
  dormant: boolean;
  /** Asleep with everything cleared: `rest` runs until the input returns. */
  asleep: boolean;
  quietFrames: number;
  sleepWait: number;
  inputPeak: number;
  outputPeak: number;
  inputLeft: number;
  inputRight: number;
  left: number;
  right: number;
  /** The slot's send (outputs 1) and the gain its return takes (output 2). */
  sendLeft: number;
  sendRight: number;
  sendGain: number;

  constructor(rate: number, slots: Float64Array) {
    this.rate = this.blockStep = this.blockFrames = this.quietFrames = this.sleepWait = NaN;
    this.inputPeak = this.outputPeak = NaN;
    this.inputLeft = this.inputRight = this.left = this.right = NaN;
    this.sendLeft = this.sendRight = this.sendGain = NaN;
    this.rate = rate;
    this.slots = slots;
    this.controls = Float64Array.from(slots);
    const controls = this.controls;
    this.decimator = new BloomDecimator(rate);
    const analysis = this.decimator.analysisRate;
    this.bands = new BloomBands(analysis, slots, controls, this.decimator);
    this.dynamics = new BloomDynamics(analysis, slots, controls, this.bands);
    this.envelope = new BloomEnvelope(analysis, slots, controls, this.bands, this.dynamics);
    this.generator = new BloomGenerator(analysis, rate, slots, controls, this.envelope);
    this.output = new BloomOutput(rate, slots, controls);
    const factor = this.decimator.factor;
    this.segment = factor * Math.max(1, Math.round(rate / (C.segmentHz * factor)));
    this.synth = new BloomSynth(rate, this.segment, this.envelope, this.generator, this.output);
    this.tone = new BloomTone(rate);
    this.phase = 0;
    this.sleepWait = C.sleepWaitSeconds * rate;
    this.blockFrames = this.blockStep = 0;
    this.dormant = this.asleep = false;
    this.clear();
    this.dormant = false;
    this.left = this.right = 0;
    this.sendLeft = this.sendRight = this.sendGain = 0;
  }

  configure(frames: number): void {
    if (frames !== this.blockFrames) {
      this.blockFrames = frames;
      this.blockStep = bloomOnePoleStep(this.rate / frames, C.smoothSeconds);
    }
    this.smooth();
    this.bands.configure();
    this.dynamics.configure();
    this.envelope.configure();
    this.generator.configure();
    this.tone.tilt(this.generator);
    this.output.configure();
    this.switching();
    if (!this.dormant && !this.asleep) this.drowse(frames);
    this.inputPeak = this.outputPeak = 0;
  }

  /** The continuous controls one block towards their slots; the stepped ones copied. */
  smooth(): void {
    const slots = this.slots,
      controls = this.controls,
      k = this.blockStep;
    for (let i = 0; i < slots.length; i++) {
      if (BLOOM_SMOOTHED_MASK[i] === 0) {
        controls[i] = slots[i];
        continue;
      }
      controls[i] += k * (slots[i] - controls[i]);
      if (Math.abs(slots[i] - controls[i]) < C.snapFloor) controls[i] = slots[i];
    }
  }

  /** The switch: clear on the first block that starts fully off; run again once it is on. */
  switching(): void {
    const output = this.output;
    if (output.level !== 0) this.dormant = false;
    else if (!this.dormant) this.clear();
    if (output.targetLevel !== 0) this.dormant = false;
  }

  /** Count quiet input; once long enough and the layer is silent, clear and sleep. */
  drowse(frames: number): void {
    if (this.inputPeak >= C.sleepInputFloor) {
      this.quietFrames = 0;
      return;
    }
    this.quietFrames += frames;
    if (this.quietFrames >= this.sleepWait && this.outputPeak < C.sleepOutputFloor) {
      this.clear();
      this.asleep = true;
    }
  }

  /** Every filter, follower and voice to zero, so nothing old is heard again. */
  clear(): void {
    this.decimator.clear();
    this.synth.clear();
    this.tone.clear();
    this.phase = 0;
    this.bands.clear();
    this.dynamics.clear();
    this.envelope.clear();
    this.generator.clear();
    this.output.clear();
    this.inputPeak = this.outputPeak = this.quietFrames = 0;
    this.left = this.right = 0;
    this.sendLeft = this.sendRight = this.sendGain = 0;
    this.dormant = true;
  }

  /** One host sample: `inputLeft`/`inputRight` in, `left`/`right` out. */
  tick(): void {
    if (this.dormant) {
      this.left = this.inputLeft;
      this.right = this.inputRight;
      this.sendLeft = this.sendRight = this.sendGain = 0;
      return;
    }
    if (this.asleep) {
      const l = this.inputLeft,
        r = this.inputRight;
      const loud = l > C.sleepInputFloor || l < -C.sleepInputFloor;
      if (!loud && r < C.sleepInputFloor && r > -C.sleepInputFloor) {
        this.rest();
        return;
      }
      this.asleep = false;
      this.quietFrames = 0;
    }
    this.run();
  }

  rest(): void {
    const output = this.output;
    output.inputLeft = this.inputLeft;
    output.inputRight = this.inputRight;
    output.rest();
    this.left = output.left;
    this.right = output.right;
    this.sendLeft = output.sendLeft;
    this.sendRight = output.sendRight;
    this.sendGain = output.sendGain;
  }

  run(): void {
    const l = this.inputLeft,
      r = this.inputRight;
    const inPeak = (l < 0 ? -l : l) > (r < 0 ? -r : r) ? (l < 0 ? -l : l) : r < 0 ? -r : r;
    if (inPeak > this.inputPeak) this.inputPeak = inPeak;
    const synth = this.synth,
      output = this.output,
      decimator = this.decimator;
    const phase = this.phase;
    if (phase === 0) {
      synth.render();
      this.tone.process(synth.left, synth.right, output.spread === 0);
    }
    const wetLeft = synth.left[phase],
      wetRight = synth.right[phase];
    output.inputLeft = l;
    output.inputRight = r;
    output.wetLeft = wetLeft;
    output.wetRight = wetRight;
    output.tick();
    const peakLeft = wetLeft < 0 ? -wetLeft : wetLeft,
      peakRight = wetRight < 0 ? -wetRight : wetRight;
    if (peakLeft > this.outputPeak) this.outputPeak = peakLeft;
    if (peakRight > this.outputPeak) this.outputPeak = peakRight;
    this.left = output.left;
    this.right = output.right;
    this.sendLeft = output.sendLeft;
    this.sendRight = output.sendRight;
    this.sendGain = output.sendGain;
    decimator.input = (l + r) / 2;
    decimator.push();
    this.phase = phase + 1 === this.segment ? 0 : phase + 1;
    if (decimator.ready) this.analyse();
  }

  /** One analysis sample through the bands, the dynamics, the envelope and the generator. */
  analyse(): void {
    const x = this.decimator.output,
      dynamics = this.dynamics,
      bands = this.bands;
    dynamics.input = x;
    dynamics.tick();
    bands.input = x;
    bands.tick();
    dynamics.limit();
    this.envelope.tick();
    this.generator.tick();
  }
}

export { BloomDsp };
