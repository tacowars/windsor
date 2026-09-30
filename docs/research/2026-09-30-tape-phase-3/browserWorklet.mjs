/** Research adapter, never imported by the app. Date.now is telemetry only.
 * Mirrors the existing coarse load estimator; no clock enters DSP generation.
 */
/* global AudioWorkletProcessor, sampleRate, registerProcessor */
import { ResampledHysteresis } from './resampler';
import { BROWSER as B } from './experimentConstants';
import { TapeDsp } from '../../../packages/engine/src/worklet/tape/tapeDsp';
import { TAPE_DEFAULTS } from '../../../packages/engine/src/inserts/tapeConstants';

class ResearchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.options = options.processorOptions;
    this.params = Object.fromEntries(
      Object.entries({ ...TAPE_DEFAULTS, model: 0 }).map(([key, value]) => [
        key,
        new Float32Array([Number(value)]),
      ]),
    );
    this.legacy = new TapeDsp(sampleRate, this.params);
    this.left = new ResampledHysteresis({ rate: sampleRate, ...this.options });
    this.right = new ResampledHysteresis({ rate: sampleRate, ...this.options });
    this.frame = 0;
    this.quanta = 0;
    this.start = 0;
    this.report = {
      busyMs: 0,
      peakMs: 0,
      underruns: 0,
      wallMs: 0,
      quanta: 0,
      resets: 0,
      clips: 0,
      nonfinite: 0,
      performanceAvailable: typeof performance !== 'undefined',
    };
  }
  process(_inputs, outputs) {
    const start = Date.now(),
      out = outputs[0],
      frames = out[0].length;
    if (this.quanta === B.warmupQuanta) this.start = start;
    if (this.options.moving && this.quanta % B.editQuanta === 0) {
      const drive = this.quanta % (2 * B.editQuanta) ? B.editLow : B.editHigh;
      this.left.core.configure(drive, 0.5, 0.5);
      this.right.core.configure(drive, 0.5, 0.5);
      this.params.drive[0] = drive * B.legacyDriveScale;
    }
    if (this.options.legacy) this.legacy.configure(this.params, frames);
    for (let i = 0; i < frames; i++) {
      // Deterministic bass/chord/bright partial workload; not a song or an audition.
      const t = this.frame++ / sampleRate;
      const x =
        0.2 * Math.sin(2 * Math.PI * 110 * t) +
        0.15 * Math.sin(2 * Math.PI * 440 * t) +
        0.1 * Math.sin(2 * Math.PI * 659.25 * t) +
        0.05 * Math.sin(2 * Math.PI * 7900 * t);
      if (this.options.legacy) {
        this.legacy.tick(x, -x);
        out[0][i] = this.legacy.left;
        out[1][i] = this.legacy.right;
      } else {
        out[0][i] = this.left.tick(x);
        out[1][i] = this.right.tick(-x);
      }
      if (!Number.isFinite(out[0][i]) || !Number.isFinite(out[1][i])) this.report.nonfinite++;
    }
    const end = Date.now(),
      elapsed = end - start;
    if (this.quanta++ >= B.warmupQuanta) {
      this.report.busyMs += elapsed;
      this.report.peakMs = Math.max(this.report.peakMs, elapsed);
      if (elapsed - 1 >= (frames / sampleRate) * 1000) this.report.underruns++;
      this.report.quanta++;
    }
    if (this.report.quanta === B.measuredQuanta) {
      this.report.wallMs = end - this.start;
      this.report.resets = this.left.core.resets + this.right.core.resets;
      this.report.clips = this.left.core.clips + this.right.core.clips;
      this.port.postMessage(this.report);
      return false;
    }
    return true;
  }
}
registerProcessor('tape-research', ResearchProcessor);
