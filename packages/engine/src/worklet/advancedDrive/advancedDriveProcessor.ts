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

registerProcessor(ADVANCED_DRIVE_NAME, AdvancedDriveProcessor);
