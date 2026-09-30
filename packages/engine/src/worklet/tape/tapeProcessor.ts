/** Tape adapter: block controls, stereo audio, shutdown and existing load telemetry. */
import {
  TAPE_NAME,
  TAPE_BOUNDS,
  TAPE_DEFAULTS,
  TAPE_DSP,
  TAPE_TYPES,
} from '../../inserts/tapeConstants';
import type { LoadReportMessage, ReportLoadMessage } from '../../synth/workletMessages';
import { TapeDsp } from './tapeDsp';
import type { TapeParams } from './tapeDsp';

class TapeProcessor extends AudioWorkletProcessor {
  dsp: TapeDsp;
  running: boolean;
  loadQuanta: number;
  load: LoadReportMessage;
  wallStart: number;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(TAPE_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: TAPE_DEFAULTS[name as keyof typeof TAPE_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      {
        name: 'model',
        minValue: 0,
        maxValue: TAPE_TYPES.length - 1,
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      { name: 'split', minValue: 0, maxValue: 1, defaultValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: TapeParams = {};
    for (const descriptor of TapeProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new TapeDsp(sampleRate, params);
    this.running = true;
    this.loadQuanta = 0;
    this.load = { type: 'load', busyMs: 0, wallMs: 0, quanta: 0, peakMs: 0, underruns: 0 };
    this.wallStart = 0;
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') {
        this.loadQuanta = Math.max(0, data.quanta | 0);
        this.load.busyMs = this.load.quanta = this.load.peakMs = 0;
        this.wallStart = Date.now();
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: TapeParams): boolean {
    if (!this.running) return false;
    const start = this.loadQuanta ? Date.now() : 0;
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    this.dsp.configure(params, frames);
    for (let i = 0; i < frames; i++) {
      this.dsp.tick(left?.[i] ?? 0, right?.[i] ?? 0);
      out[0][i] = this.dsp.left;
      if (out[1]) out[1][i] = this.dsp.right;
    }
    if (this.loadQuanta) this.report(frames, start);
    return true;
  }

  report(frames: number, start: number): void {
    const now = Date.now();
    const elapsed = now - start;
    const load = this.load;
    load.busyMs += elapsed;
    load.peakMs = Math.max(load.peakMs, elapsed);
    if (elapsed - 1 >= (frames / sampleRate) * TAPE_DSP.millisecondsPerSecond) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}

registerProcessor(TAPE_NAME, TapeProcessor);
