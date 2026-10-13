/**
 * Compressor worklet adapter (#660). DSP is the tested CompressorDsp; this owns
 * two stereo inputs, AudioParams, shutdown and opt-in telemetry. The render
 * loop allocates nothing; report objects are reused and posts are throttled.
 * Each sample reaches the DSP through its fields and each input load is
 * bounded, so no double is boxed (worklet rule 2), and every double field is
 * first written as one (rule 7). Pinned by inserts/compressorAllocation.test.ts.
 * An asleep block (windsor#793, `CompressorDsp.drowse`) is `rest`, outside the
 * awake loop: zeros, and the meter's report.
 */
/* eslint-disable no-magic-numbers -- DSP adapter: binary controls and stereo indices; tunables live in compressorConstants.ts */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import type { CompressorParams } from '../../inserts/compressorDsp';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { CompressorDsp } from '../../inserts/compressorDsp';
import {
  COMPRESSOR_NAME,
  COMPRESSOR_BOUNDS,
  COMPRESSOR_DEFAULTS,
  COMPRESSOR_DSP,
  COMPRESSOR_SLEEP,
} from '../../inserts/compressorConstants';
import { LoadSampler } from '../loadSampler';

type ControlMessage = { type: 'stop' } | ReportLoadMessage | { type: 'meter'; enabled: boolean };

class CompressorProcessor extends AudioWorkletProcessor {
  dsp: CompressorDsp;
  running: boolean;
  meter: boolean;
  frames: number;
  peak: number;
  meterReport: { type: 'reduction'; db: number };
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(COMPRESSOR_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: COMPRESSOR_DEFAULTS[name as keyof typeof COMPRESSOR_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
      { name: 'external', minValue: 0, maxValue: 1, defaultValue: 0, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: CompressorParams = {};
    for (const [name, value] of Object.entries(COMPRESSOR_DEFAULTS)) {
      params[name] = new Float32Array([Number(options.parameterData?.[name] ?? value)]);
    }
    // `sleep: false` is a test's, to prove the renders with and without it agree.
    this.dsp = new CompressorDsp(sampleRate, params, options.processorOptions?.sleep !== false);
    this.running = true;
    this.meter = false;
    this.frames = 0;
    this.peak = NaN;
    this.peak = 0;
    this.meterReport = { type: 'reduction', db: NaN };
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<ControlMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'meter') {
        this.meter = data.enabled;
        this.frames = 0;
        this.peak = 0;
      }
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: CompressorParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const source = inputs[0];
    const detector = params.external[0] >= 0.5 ? inputs[1] : source;
    const dsp = this.dsp;
    dsp.configure(params);
    if (dsp.sleepEnabled) {
      // Silent program, and silent key when the key is its own.
      const quiet = this.silent(source?.[0], source?.[1]);
      dsp.drowse(quiet && (detector === source || this.silent(detector?.[0], detector?.[1])));
    }
    if (dsp.asleep) this.rest(out, out[0].length);
    else this.render(source, detector, out);
    this.report(params, out[0].length);
    this.load.end(out[0].length);
    return true;
  }

  /**
   * One awake block, in a method of its own as the plate's `_renderBlock` is (windsor#793): V8
   * optimises it on sound alone, never inside a `process` that has so far only slept.
   */
  render(
    source: Float32Array[] | undefined,
    detector: Float32Array[] | undefined,
    out: Float32Array[],
  ): void {
    const left = source?.[0];
    const right = source?.[1] ?? left;
    const keyL = detector?.[0];
    const keyR = detector?.[1] ?? keyL;
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const keyLFrames = keyL ? keyL.length : 0,
      keyRFrames = keyR ? keyR.length : 0;
    const dsp = this.dsp;
    for (let i = 0; i < out[0].length; i++) {
      // Through fields, not arguments or a return, which V8 boxes across a call it does not inline.
      dsp.keyLeft = i < keyLFrames ? keyL![i] : 0;
      dsp.keyRight = i < keyRFrames ? keyR![i] : 0;
      dsp.advance();
      const gain = dsp.gain;
      out[0][i] = (i < leftFrames ? left![i] : 0) * gain;
      if (out[1]) out[1][i] = (i < rightFrames ? right![i] : 0) * gain;
      if (this.meter) this.peak = Math.max(this.peak, dsp.reductionDb);
    }
  }

  /** Every sample of the block within the sleep floor; an absent channel is silent. */
  silent(left: Float32Array | undefined, right: Float32Array | undefined): boolean {
    const floor = COMPRESSOR_SLEEP.inputFloor;
    if (left) for (let i = 0; i < left.length; i++) if (Math.abs(left[i]) > floor) return false;
    if (right && right !== left)
      for (let i = 0; i < right.length; i++) if (Math.abs(right[i]) > floor) return false;
    return true;
  }

  /** One asleep block: zeros, the input's silence to within its floor, and the controls' glides. */
  rest(out: Float32Array[], frames: number): void {
    this.dsp.rest(frames);
    out[0].fill(0);
    if (out[1]) out[1].fill(0);
  }

  /** The gain-reduction meter's throttled post. */
  report(params: CompressorParams, frames: number): void {
    if (this.meter) {
      this.frames += frames;
      if (this.frames >= sampleRate / COMPRESSOR_DSP.meterHz) {
        this.meterReport.db = params.enabled[0] ? this.peak : 0;
        this.port.postMessage(this.meterReport);
        this.frames = this.peak = 0;
      }
    }
  }
}
registerProcessor(COMPRESSOR_NAME, CompressorProcessor);
