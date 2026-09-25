/** Delay adapter: block controls, stereo audio, shutdown and existing load telemetry. */
import { DELAY_NAME, DELAY_BOUNDS, DELAY_DEFAULTS, DELAY_DSP } from '../../inserts/delayConstants';
import type { LoadReportMessage, ReportLoadMessage } from '../../synth/workletMessages';
import { DelayDsp } from './delayDsp';
import type { DelayParams } from './delayDsp';

class DelayProcessor extends AudioWorkletProcessor {
  dsp: DelayDsp;
  running: boolean;
  loadQuanta: number;
  load: LoadReportMessage;
  wallStart: number;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries({
        ...DELAY_BOUNDS,
        leftMs: [1, DELAY_DSP.maxSeconds * DELAY_DSP.milliseconds],
        rightMs: [1, DELAY_DSP.maxSeconds * DELAY_DSP.milliseconds],
      }).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: DELAY_DEFAULTS[name as keyof typeof DELAY_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'mode', minValue: 0, maxValue: 2, defaultValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: DelayParams = {};
    for (const descriptor of DelayProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new DelayDsp(sampleRate, params);
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

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: DelayParams): boolean {
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
    if (elapsed - 1 >= (frames / sampleRate) * DELAY_DSP.milliseconds) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}

registerProcessor(DELAY_NAME, DelayProcessor);
