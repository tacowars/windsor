/**
 * The Pump insert's adapter (record `2026-10-13-pump-insert`): two stereo
 * inputs, the program and the mixer's detector, like the compressor's; the
 * params from `pumpParameters.ts`; shutdown, load telemetry, and the scope
 * the open card asks for. The render allocates nothing; the scope's two
 * report objects are reused and their posts throttled to `phaseHz`, plus
 * one trace a cycle, and only while the card is open.
 */
import { PUMP_DSP, PUMP_NAME } from '../../inserts/pumpConstants';
import { PUMP_PARAMS } from '../../inserts/pumpParameters';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { PumpDsp } from './pumpDsp';
import type { PumpParams } from './pumpDsp';

type PumpControl = { type: 'stop' } | ReportLoadMessage | { type: 'scope'; enabled: boolean };

class PumpProcessor extends AudioWorkletProcessor {
  dsp: PumpDsp;
  running: boolean;
  load: LoadSampler;
  /** Frames since the last phase report. */
  frames: number;
  phaseReport: { type: 'phase'; phase: number; gain: number };
  traceReport: { type: 'trace'; levels: Float32Array };

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return PUMP_PARAMS.map((p) => ({ ...p, automationRate: 'k-rate' as const }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: PumpParams = {};
    for (const { name, defaultValue } of PUMP_PARAMS) {
      params[name] = new Float32Array([Number(options.parameterData?.[name] ?? defaultValue)]);
    }
    this.dsp = new PumpDsp(sampleRate, params);
    this.running = true;
    this.frames = 0;
    this.phaseReport = { type: 'phase', phase: NaN, gain: NaN };
    this.traceReport = { type: 'trace', levels: this.dsp.scope.trace };
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<PumpControl>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'scope') {
        this.dsp.scope.setActive(data.enabled);
        this.frames = 0;
      }
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: PumpParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const source = inputs[0];
    const key = params.external[0] >= PUMP_DSP.switchOn ? inputs[1] : source;
    const left = source?.[0];
    const right = source?.[1] ?? left;
    const keyL = key?.[0];
    const keyR = key?.[1] ?? keyL;
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const keyLFrames = keyL ? keyL.length : 0,
      keyRFrames = keyR ? keyR.length : 0;
    const frames = out[0].length;
    const dsp = this.dsp;
    dsp.configure(params);
    if (dsp.bypassed) {
      for (let i = 0; i < frames; i++) {
        out[0][i] = i < leftFrames ? left![i] : 0;
        if (out[1]) out[1][i] = i < rightFrames ? right![i] : 0;
      }
    } else {
      for (let i = 0; i < frames; i++) {
        dsp.inputLeft = i < leftFrames ? left![i] : 0;
        dsp.inputRight = i < rightFrames ? right![i] : 0;
        dsp.keyLeft = i < keyLFrames ? keyL![i] : 0;
        dsp.keyRight = i < keyRFrames ? keyR![i] : 0;
        dsp.tick();
        out[0][i] = dsp.left;
        if (out[1]) out[1][i] = dsp.right;
      }
    }
    this.report(frames);
    this.load.end(frames);
    return true;
  }

  /** The open card's scope: a trace when a cycle closed, and the phase at `phaseHz`. */
  report(frames: number): void {
    const scope = this.dsp.scope;
    if (!scope.active) return;
    if (scope.pending) {
      this.port.postMessage(this.traceReport);
      scope.pending = false;
    }
    this.frames += frames;
    if (this.frames >= sampleRate / PUMP_DSP.phaseHz) {
      this.phaseReport.phase = this.dsp.phase;
      this.phaseReport.gain = this.dsp.gain;
      this.port.postMessage(this.phaseReport);
      this.frames = 0;
    }
  }
}

registerProcessor(PUMP_NAME, PumpProcessor);
