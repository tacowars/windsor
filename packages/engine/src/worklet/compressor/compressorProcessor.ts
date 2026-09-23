/**
 * Compressor worklet adapter (#660). DSP is the tested CompressorDsp; this owns
 * two stereo inputs, AudioParams, shutdown and opt-in telemetry. The render
 * loop allocates nothing; report objects are reused and posts are throttled.
 */
/* eslint-disable no-magic-numbers -- DSP adapter: binary controls, stereo indices and milliseconds per second; tunables live in compressorConstants.ts */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import type { CompressorParams } from '../../inserts/compressorDsp';
import type { LoadReportMessage, ReportLoadMessage } from '../../workletMessages';
import { CompressorDsp } from '../../inserts/compressorDsp';
import {
  COMPRESSOR_NAME,
  COMPRESSOR_BOUNDS,
  COMPRESSOR_DEFAULTS,
  COMPRESSOR_DSP,
} from '../../inserts/compressorConstants';

type ControlMessage = { type: 'stop' } | ReportLoadMessage | { type: 'meter'; enabled: boolean };

class CompressorProcessor extends AudioWorkletProcessor {
  dsp: CompressorDsp;
  running: boolean;
  meter: boolean;
  frames: number;
  peak: number;
  meterReport: { type: 'reduction'; db: number };
  loadQuanta: number;
  load: LoadReportMessage;
  wallStart: number;

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
    this.dsp = new CompressorDsp(sampleRate, params);
    this.running = true;
    this.meter = false;
    this.frames = 0;
    this.peak = 0;
    this.meterReport = { type: 'reduction', db: 0 };
    this.loadQuanta = 0;
    this.load = { type: 'load', busyMs: 0, wallMs: 0, quanta: 0, peakMs: 0, underruns: 0 };
    this.wallStart = 0;
    this.port.onmessage = ({ data }: MessageEvent<ControlMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'meter') {
        this.meter = data.enabled;
        this.frames = 0;
        this.peak = 0;
      }
      if (data.type === 'reportLoad') {
        this.loadQuanta = Math.max(0, data.quanta | 0);
        this.load.busyMs = this.load.quanta = this.load.peakMs = 0;
        this.wallStart = Date.now();
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: CompressorParams): boolean {
    if (!this.running) return false;
    const start = this.loadQuanta ? Date.now() : 0;
    const out = outputs[0];
    if (!out?.[0]) return true;
    const source = inputs[0];
    const detector = params.external[0] >= 0.5 ? inputs[1] : source;
    const left = source?.[0];
    const right = source?.[1] ?? left;
    const keyL = detector?.[0];
    const keyR = detector?.[1] ?? keyL;
    this.dsp.configure(params);
    for (let i = 0; i < out[0].length; i++) {
      const gain = this.dsp.tick(keyL?.[i] ?? 0, keyR?.[i] ?? 0);
      out[0][i] = (left?.[i] ?? 0) * gain;
      if (out[1]) out[1][i] = (right?.[i] ?? 0) * gain;
      if (this.meter) this.peak = Math.max(this.peak, this.dsp.reductionDb);
    }
    this.report(params, out[0].length, start);
    return true;
  }

  report(params: CompressorParams, frames: number, start: number): void {
    if (this.meter) {
      this.frames += frames;
      if (this.frames >= sampleRate / COMPRESSOR_DSP.meterHz) {
        this.meterReport.db = params.enabled[0] ? this.peak : 0;
        this.port.postMessage(this.meterReport);
        this.frames = this.peak = 0;
      }
    }
    if (!this.loadQuanta) return;
    const now = Date.now();
    const elapsed = now - start;
    const load = this.load;
    load.busyMs += elapsed;
    load.peakMs = Math.max(load.peakMs, elapsed);
    if (elapsed - 1 >= (frames / sampleRate) * 1000) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}
registerProcessor(COMPRESSOR_NAME, CompressorProcessor);
