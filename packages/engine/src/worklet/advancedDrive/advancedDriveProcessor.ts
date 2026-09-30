/** Worklet lifecycle, parameter blocks and existing load telemetry for Advanced Drive. */
import { ADVANCED_DRIVE_NAME } from '../../inserts/advancedDriveConstants';
import { ADVANCED_DRIVE_PARAMETERS } from '../../inserts/advancedDriveParameters';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { AdvancedDriveDsp } from './advancedDriveDsp';
import type { AdvancedDriveParams } from './advancedDriveDsp';
class AdvancedDriveProcessor extends AudioWorkletProcessor {
  dsp: AdvancedDriveDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return ADVANCED_DRIVE_PARAMETERS;
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: AdvancedDriveParams = {};
    for (const descriptor of AdvancedDriveProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new AdvancedDriveDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: AdvancedDriveParams,
  ): boolean {
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
    dsp.configure(params, frames);
    for (let i = 0; i < frames; i++) {
      // Through fields, not arguments, which V8 boxes across a call it does not inline.
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(ADVANCED_DRIVE_NAME, AdvancedDriveProcessor);
