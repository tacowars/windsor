/** Worklet lifecycle, parameter blocks and existing load telemetry for Advanced Drive. */
import { ADVANCED_DRIVE_NAME, DRIVE_DSP } from '../../inserts/advancedDriveConstants';
import { ADVANCED_DRIVE_PARAMETERS } from '../../inserts/advancedDriveParameters';
import type { LoadReportMessage, ReportLoadMessage } from '../../synth/workletMessages';
import { AdvancedDriveDsp } from './advancedDriveDsp';
import type { AdvancedDriveParams } from './advancedDriveDsp';
class AdvancedDriveProcessor extends AudioWorkletProcessor {
  dsp: AdvancedDriveDsp;
  running: boolean;
  loadQuanta: number;
  load: LoadReportMessage;
  wallStart: number;

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

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: AdvancedDriveParams,
  ): boolean {
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
    if (elapsed - 1 >= (frames / sampleRate) * DRIVE_DSP.ms) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}

registerProcessor(ADVANCED_DRIVE_NAME, AdvancedDriveProcessor);
