/** Phaser adapter: block controls, stereo audio, shutdown and existing load telemetry.
 * Its render allocates nothing (windsor#231): see phaserDsp.ts.
 */
import { PHASER_NAME, PHASER_BOUNDS, PHASER_DEFAULTS } from '../../inserts/phaserConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { PhaserDsp } from './phaserDsp';
import type { PhaserParams } from './phaserDsp';

class PhaserProcessor extends AudioWorkletProcessor {
  dsp: PhaserDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(PHASER_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: PHASER_DEFAULTS[name as keyof typeof PHASER_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: PhaserParams = {};
    for (const descriptor of PhaserProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new PhaserDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: PhaserParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    const input = dsp.input,
      output = dsp.output;
    dsp.configure(params, frames);
    for (let i = 0; i < frames; i++) {
      // Through slots, not arguments, which V8 boxes across a call it does not inline.
      input[0] = i < leftFrames ? left![i] : 0;
      input[1] = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = output[0];
      if (out[1]) out[1][i] = output[1];
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(PHASER_NAME, PhaserProcessor);
