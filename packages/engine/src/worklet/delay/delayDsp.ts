/** Two preallocated delay lines with filtered, saturating feedback. Shipped-bundle tests
 * pin routing/timing and bounded regeneration. Moving time bends pitch; no buffer resets.
 */
import { DELAY_DSP as C, DELAY_DEFAULTS, DELAY_MODE_IDS } from '../../inserts/delayConstants';

type DelayParams = Record<string, Float32Array>;
const KEYS = [
  'leftMs',
  'rightMs',
  'feedback',
  'highpass',
  'lowpass',
  'drive',
  'mix',
  'outputDb',
  'enabled',
  'ping',
  'mid',
] as const;
type Controls = Record<(typeof KEYS)[number], number>;

class DelayDsp {
  readonly rate: number;
  readonly buffer: Float32Array[];
  readonly filter: Float64Array;
  readonly smooth: number;
  readonly timeSmooth: number;
  readonly controls: Controls;
  readonly targets: Controls;
  position: number;
  first: boolean;
  left: number;
  right: number;

  constructor(rate: number, _params: DelayParams) {
    this.rate = rate;
    const length = Math.ceil(rate * C.maxSeconds) + 2;
    this.buffer = [new Float32Array(length), new Float32Array(length)];
    this.filter = new Float64Array(C.filterStates);
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.timeSmooth = 1 - Math.exp(-1 / (rate * C.timeSmoothSeconds));
    this.controls = { ...DELAY_DEFAULTS, enabled: 1, ping: 0, mid: 0 };
    this.targets = { ...this.controls };
    this.position = this.left = this.right = 0;
    this.first = true;
  }

  configure(params: DelayParams, _frames: number): void {
    const t = this.targets;
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      if (key !== 'ping' && key !== 'mid') t[key] = params[key][0];
    }
    t.ping = params.mode[0] === DELAY_MODE_IDS['ping-pong'] ? 1 : 0;
    t.mid = params.mode[0] === DELAY_MODE_IDS['mid-side'] ? 1 : 0;
    // Smooth coefficients, not Hz: no exponentials in the sample loop.
    t.highpass = this.pole(t.highpass);
    t.lowpass = this.pole(t.lowpass);
    t.drive = C.dbBase ** (t.drive / C.dbDivisor);
    t.outputDb = C.dbBase ** (t.outputDb / C.dbDivisor);
    if (this.first) {
      for (let i = 0; i < KEYS.length; i++) this.controls[KEYS[i]] = t[KEYS[i]];
      this.first = false;
    }
  }

  pole(hz: number): number {
    return 1 - Math.exp(-((2 * Math.PI * Math.min(hz, this.rate * C.cutoffRateRatio)) / this.rate));
  }

  tick(left: number, right: number): void {
    const s = this.controls;
    const t = this.targets;
    const k = this.smooth;
    s.leftMs += this.timeSmooth * (t.leftMs - s.leftMs);
    s.rightMs += this.timeSmooth * (t.rightMs - s.rightMs);
    s.feedback += k * (t.feedback - s.feedback);
    s.highpass += k * (t.highpass - s.highpass);
    s.lowpass += k * (t.lowpass - s.lowpass);
    s.drive += k * (t.drive - s.drive);
    s.mix += k * (t.mix - s.mix);
    s.outputDb += k * (t.outputDb - s.outputDb);
    s.enabled += k * (t.enabled - s.enabled);
    s.ping += k * (t.ping - s.ping);
    s.mid += k * (t.mid - s.mid);
    const a = this.read(0, s.leftMs);
    const b = this.read(1, s.rightMs);
    const mid = (left + right) / 2;
    const side = (left - right) / 2;
    const inputA = left + s.mid * (mid - left) + s.ping * (mid - left);
    const inputB = right + s.mid * (side - right) - s.ping * right;
    const feedA = a + s.ping * (b - a);
    const feedB = b + s.ping * (a - b);
    this.write(0, inputA * s.enabled + s.feedback * feedA);
    this.write(1, inputB * s.enabled + s.feedback * feedB);
    const wetL = a + s.mid * b;
    const wetR = b + s.mid * (a - 2 * b);
    const mix = s.mix * s.enabled;
    const gain = 1 + s.enabled * (s.outputDb - 1);
    this.left = (left + mix * (wetL - left)) * gain;
    this.right = (right + mix * (wetR - right)) * gain;
    if (++this.position === this.buffer[0].length) this.position = 0;
  }

  read(channel: number, ms: number): number {
    const buffer = this.buffer[channel];
    const samples = Math.max(1, Math.min(buffer.length - 2, (ms * this.rate) / C.milliseconds));
    let position = this.position - samples;
    if (position < 0) position += buffer.length;
    const index = Math.floor(position);
    const next = index + 1 === buffer.length ? 0 : index + 1;
    let value = buffer[index] + (position - index) * (buffer[next] - buffer[index]);
    const offset = channel * C.polesPerChannel;
    const s = this.controls;
    // Two high-pass and two low-pass poles, inside the loop so every repeat darkens.
    for (let i = 0; i < 2; i++) {
      this.filter[offset + i] += s.highpass * (value - this.filter[offset + i]);
      value -= this.filter[offset + i];
    }
    for (let i = 2; i < C.polesPerChannel; i++) {
      this.filter[offset + i] += s.lowpass * (value - this.filter[offset + i]);
      value = this.filter[offset + i];
    }
    return value;
  }

  write(channel: number, value: number): void {
    const limit = C.feedbackCeiling / this.controls.drive;
    this.buffer[channel][this.position] = limit * Math.tanh(value / limit);
  }
}

export { DelayDsp };
export type { DelayParams };
