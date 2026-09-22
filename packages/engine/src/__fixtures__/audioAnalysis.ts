/**
 * Test signals and measurements for renders of the graph stand-in, plus the
 * graph walks a routing assertion needs. Node-only, like the rest of this
 * directory.
 */
import type { FakeHost } from './fakeAudioNodes';
import { BLOCK, FakeBiquad, FakeNode } from './fakeAudioNodes';
import { SAMPLE_RATE } from './fakeAudioContext';
import type { Feed } from './reverbHarness';

/** Two sines, one per channel. Equal frequencies give a centred mono source. */
export function tones(leftHz: number, rightHz: number, amplitude = 0.5): Feed {
  return (block, left, right) => {
    const start = block * BLOCK;
    for (let i = 0; i < BLOCK; i++) {
      const t = (start + i) / SAMPLE_RATE;
      left[i] = amplitude * Math.sin(2 * Math.PI * leftHz * t);
      right[i] = amplitude * Math.sin(2 * Math.PI * rightHz * t);
    }
  };
}

/** `feed` for `seconds`, then silence -- so a tail has something to follow. */
export function burst(feed: Feed, seconds: number): Feed {
  const until = Math.round((seconds * SAMPLE_RATE) / BLOCK);
  return (block, left, right) => {
    if (block < until) feed(block, left, right);
  };
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let energy = 0;
  for (let i = from; i < to; i++) energy += (samples[i] ?? 0) ** 2;
  return Math.sqrt(energy / Math.max(1, to - from));
}

export function energy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  return sum;
}

/** Amplitude at one frequency, via Goertzel, on a mono array. */
export function toneLevel(samples: Float32Array, hz: number): number {
  const n = samples.length;
  const coeff = 2 * Math.cos((2 * Math.PI * hz) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (2 * Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2))) / n;
}

export function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}

function walk(start: FakeNode, next: (node: FakeNode) => FakeNode[]): Set<FakeNode> {
  const seen = new Set<FakeNode>();
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    stack.push(...next(node));
  }
  return seen;
}

/** Every node on some signal path from `from` to `to`, endpoints excluded. */
export function nodesBetween(from: FakeNode, to: FakeNode): FakeNode[] {
  const forward = walk(from, (n) => n.outbound.map((c) => c.to));
  const backward = walk(to, (n) => n.inbound.map((c) => c.from));
  return [...forward].filter((n) => backward.has(n) && n !== from && n !== to);
}

/** True when a signal path exists from `from` to `to`. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  return walk(from, (n) => n.outbound.map((c) => c.to)).has(to);
}

/** One sample of 1 at the start of block 0, then silence: the source for an impulse response. */
class ImpulseNode extends FakeNode {
  readonly kind = 'impulse';

  constructor(context: FakeHost) {
    super(context, 0, 1);
  }

  protected render(block: number): Float32Array[][] {
    const channel = new Float32Array(BLOCK);
    if (block === 0) channel[0] = 1;
    return [[channel]];
  }
}

/**
 * A biquad's impulse-response L1 norm, Σ|h[n]| over `seconds`: the most it can
 * scale any signal bounded by 1, overshoot and ringing included. A peak bound
 * derived from it is exact, where one from the analogue step response is not
 * (a digital filter near Nyquist rings differently).
 */
export function biquadL1(
  settings: { type: BiquadFilterType; frequency: number; Q: number },
  seconds = 1,
): number {
  const host: FakeHost = { sampleRate: SAMPLE_RATE, register: () => undefined };
  const filter = new FakeBiquad(host);
  filter.type = settings.type;
  filter.frequency.value = settings.frequency;
  filter.Q.value = settings.Q;
  new ImpulseNode(host).connect(filter);
  let sum = 0;
  const blocks = Math.round((seconds * SAMPLE_RATE) / BLOCK);
  for (let b = 0; b < blocks; b++) for (const v of filter.pull(b)[0] ?? []) sum += Math.abs(v);
  return sum;
}
