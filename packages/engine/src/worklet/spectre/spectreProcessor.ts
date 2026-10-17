/**
 * Spectre's adapter (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): one stereo input and output, the params
 * from `spectreParameters.ts`, the drawn cells as a posted payload
 * (`processorOptions.cells` at construction, a `cells` message after),
 * shutdown, load telemetry, and the workbench's `scope` and `listen`. Each
 * block it reads the input's peak first, so a sleeping Spectre wakes on the
 * block that is loud, then renders the block a sample at a time through the
 * DSP's fields. The render allocates nothing: a payload is copied in from
 * the message handler, and the scope's one report object is reused, posted
 * at most `scopeHz` times a second and only while the workbench is open.
 * `processorOptions.sleep: false` renders without the sleep, for tests.
 */
import { SPECTRE_NAME } from '../../inserts/spectreConstants';
import { SPECTRE_PARAMS } from '../../inserts/spectreParameters';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import type { SpectreParams } from './spectreControls';
import { SpectreDsp } from './spectreDsp';

type SpectreControl =
  | { type: 'stop' }
  | ReportLoadMessage
  | { type: 'cells'; cells: Float32Array }
  | { type: 'scope'; enabled: boolean }
  | { type: 'listen'; enabled: boolean };

interface SpectreOptions {
  sleep?: boolean;
  cells?: Float32Array;
}

class SpectreProcessor extends AudioWorkletProcessor {
  dsp: SpectreDsp;
  running: boolean;
  load: LoadSampler;
  report: {
    type: 'scope';
    input: Float32Array;
    output: Float32Array;
    lfo: number;
    pitches: number;
  };

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return SPECTRE_PARAMS.map((p) => ({ ...p, automationRate: 'k-rate' as const }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: SpectreParams = {};
    for (const { name, defaultValue } of SPECTRE_PARAMS) {
      params[name] = new Float32Array([Number(options.parameterData?.[name] ?? defaultValue)]);
    }
    const extra = (options.processorOptions ?? {}) as SpectreOptions;
    this.dsp = new SpectreDsp(sampleRate, params, extra.sleep !== false);
    if (extra.cells) this.dsp.cells.load(extra.cells);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    const scope = this.dsp.scope;
    this.report = {
      type: 'scope',
      input: scope.input,
      output: scope.output,
      lfo: NaN,
      pitches: NaN,
    };
    this.port.onmessage = ({ data }: MessageEvent<SpectreControl>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
      if (data.type === 'cells') this.dsp.cells.load(data.cells);
      if (data.type === 'scope') scope.setActive(data.enabled);
      if (data.type === 'listen') this.dsp.listen = data.enabled;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: SpectreParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const source = inputs[0];
    const left = source?.[0];
    const right = source?.[1] ?? left;
    // A bounded load stays a double; `left?.[i] ?? 0` would keep it tagged and box every sample.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const frames = out[0].length;
    const dsp = this.dsp;
    dsp.configure(params);
    let peak = 0;
    for (let i = 0; i < leftFrames; i++) {
      const x = left![i];
      if (x > peak) peak = x;
      else if (-x > peak) peak = -x;
    }
    for (let i = 0; i < rightFrames; i++) {
      const x = right![i];
      if (x > peak) peak = x;
      else if (-x > peak) peak = -x;
    }
    dsp.peak = peak;
    dsp.drowse();
    for (let i = 0; i < frames; i++) {
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
    const scope = dsp.scope;
    if (scope.pending) {
      scope.pending = false;
      this.report.lfo = scope.lfo;
      this.report.pitches = scope.pitches;
      this.port.postMessage(this.report);
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(SPECTRE_NAME, SpectreProcessor);
