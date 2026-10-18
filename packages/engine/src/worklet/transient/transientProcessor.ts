/**
 * The Transient insert's adapter (record `2026-10-18-transient-insert`): one
 * stereo input, the params from `transientParameters.ts`, shutdown, load
 * telemetry, the sleep's dispatch and the gain meter the open card asks for.
 * `process` dispatches each block to one of three loops: fully off, a copy
 * of the input; asleep (`TransientDsp.drowse`), `idle`; awake, `render`. The
 * awake loop is a method of its own, as the compressor's is, so V8 optimises
 * it on sound alone.
 *
 * The meter (decision 9): while the card is on screen, each window of
 * `sampleRate / meterHz` frames posts its largest boost and largest cut of
 * the shaping's gain in dB, in one reused report object. The render
 * allocates nothing and no double crosses a call: samples reach the DSP
 * through its fields, and every input load is bounded (worklet rule 2).
 * `processorOptions.timing` (a `TransientTiming` row) and `sleep: false` are
 * the tests' and the listen's, never the insert's. Pinned by
 * `inserts/transientAllocation.test.ts`.
 */
import { TRANSIENT_DSP, TRANSIENT_NAME, TRANSIENT_SLEEP } from '../../inserts/transientConstants';
import { TRANSIENT_PARAMS } from '../../inserts/transientParameters';
import { TRANSIENT_SHIPPED_TIMING, TRANSIENT_TIMINGS } from '../../inserts/transientTables';
import type { TransientTiming } from '../../inserts/transientTables';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { TransientDsp } from './transientDsp';
import type { TransientParams } from './transientDsp';

type TransientControl = { type: 'stop' } | ReportLoadMessage | { type: 'meter'; enabled: boolean };

interface TransientOptions {
  timing?: TransientTiming;
  sleep?: boolean;
}

/** The row `options` names, if it is a whole one of positive times; else the shipped row. */
function timingOf(options: TransientOptions | undefined): TransientTiming {
  const timing = options?.timing;
  const shipped = TRANSIENT_TIMINGS[TRANSIENT_SHIPPED_TIMING];
  if (!timing) return shipped;
  const times = [timing.holdMs, timing.fReleaseMs, timing.aAttackMs, timing.sReleaseMs];
  return times.every((ms) => Number.isFinite(ms) && ms > 0) ? timing : shipped;
}

class TransientProcessor extends AudioWorkletProcessor {
  dsp: TransientDsp;
  running: boolean;
  load: LoadSampler;
  meter: boolean;
  /** Frames since the last meter report, and the window's largest boost and cut. */
  frames: number;
  boost: number;
  cut: number;
  meterReport: { type: 'shaping'; boost: number; cut: number };

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return TRANSIENT_PARAMS.map((p) => ({ ...p, automationRate: 'k-rate' as const }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: TransientParams = {};
    for (const { name, defaultValue } of TRANSIENT_PARAMS) {
      params[name] = new Float32Array([Number(options.parameterData?.[name] ?? defaultValue)]);
    }
    const opts = options.processorOptions as TransientOptions | undefined;
    this.dsp = new TransientDsp(sampleRate, params, timingOf(opts), opts?.sleep !== false);
    this.running = true;
    this.meter = false;
    this.frames = 0;
    this.boost = this.cut = NaN;
    this.boost = this.cut = 0;
    this.meterReport = { type: 'shaping', boost: NaN, cut: NaN };
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<TransientControl>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'meter') {
        this.meter = data.enabled;
        this.frames = 0;
        this.boost = this.cut = 0;
      }
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: TransientParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    const dsp = this.dsp;
    dsp.configure(params);
    if (dsp.bypassed) {
      this.copy(left, right, out, frames);
      dsp.rest(frames);
    } else {
      if (dsp.sleepEnabled) dsp.drowse(this.silent(left, right));
      if (dsp.asleep) this.idle(left, right, out, frames);
      else this.render(left, right, out, frames);
    }
    this.report(params, frames);
    this.load.end(frames);
    return true;
  }

  /** One awake block, every sample through the detector, the meter's extremes kept while it is on. */
  render(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
  ): void {
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    for (let i = 0; i < frames; i++) {
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
      if (this.meter) {
        const db = dsp.gainDb;
        if (db > this.boost) this.boost = db;
        if (db < this.cut) this.cut = db;
      }
    }
  }

  /** One asleep block: the input at the Output's gain, the controls and the switch stepping. */
  idle(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
  ): void {
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    for (let i = 0; i < frames; i++) {
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.idle();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
  }

  /** Fully off: the input, to the bit. */
  copy(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
  ): void {
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    for (let i = 0; i < frames; i++) {
      out[0][i] = i < leftFrames ? left![i] : 0;
      if (out[1]) out[1][i] = i < rightFrames ? right![i] : 0;
    }
  }

  /** Every sample of the block within the sleep floor; an absent channel is silent. */
  silent(left: Float32Array | undefined, right: Float32Array | undefined): boolean {
    const floor = TRANSIENT_SLEEP.floor;
    if (left) for (let i = 0; i < left.length; i++) if (Math.abs(left[i]) > floor) return false;
    if (right && right !== left)
      for (let i = 0; i < right.length; i++) if (Math.abs(right[i]) > floor) return false;
    return true;
  }

  /** The open card's meter: the window's largest boost and cut, posted at `meterHz`. */
  report(params: TransientParams, frames: number): void {
    if (!this.meter) return;
    this.frames += frames;
    if (this.frames < sampleRate / TRANSIENT_DSP.meterHz) return;
    const on = params.enabled[0] >= TRANSIENT_DSP.switchOn;
    this.meterReport.boost = on ? this.boost : 0;
    this.meterReport.cut = on ? this.cut : 0;
    this.port.postMessage(this.meterReport);
    this.frames = 0;
    this.boost = this.cut = 0;
  }
}

registerProcessor(TRANSIENT_NAME, TransientProcessor);
