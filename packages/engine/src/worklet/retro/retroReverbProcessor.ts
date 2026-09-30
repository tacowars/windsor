/** Retro reverb adapter: block controls, stereo audio, shutdown and existing load telemetry. */
import {
  RETRO_REVERB_NAME,
  RETRO_REVERB_BOUNDS,
  RETRO_REVERB_DEFAULTS,
} from '../../inserts/retroReverbConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { RetroReverbDsp } from './retroReverbDsp';
import type { RetroParams } from './retroReverbDsp';

class RetroReverbProcessor extends AudioWorkletProcessor {
  dsp: RetroReverbDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(RETRO_REVERB_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: RETRO_REVERB_DEFAULTS[name as keyof typeof RETRO_REVERB_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
      { name: 'mode', minValue: 0, maxValue: 2, defaultValue: 0, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: RetroParams = {};
    for (const descriptor of RetroReverbProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new RetroReverbDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: RetroParams): boolean {
    if (!this.running) return false;
    this.load.begin();
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
    this.load.end(frames);
    return true;
  }
}

registerProcessor(RETRO_REVERB_NAME, RetroReverbProcessor);
