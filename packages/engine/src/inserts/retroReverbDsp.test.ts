import { describe, expect, it } from 'vitest';
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import type { RetroProcessorLike } from '../__fixtures__/retroReverbHarness';
import type { RetroReverbSpec } from './retroReverbSpec';
import {
  RETRO_REVERB_BOUNDS,
  RETRO_REVERB_DSP as DSP,
  RETRO_REVERB_MODES,
} from './retroReverbConstants';

/** The multi-second renders take about 5 s on a loaded machine, past vitest's 5 s default. */
const SLOW = { timeout: 30_000 };

function render(spec: Partial<RetroReverbSpec>, rate = 48000, seconds = 1.5): Float32Array[] {
  const params = retroParams({ mix: 1, character: 0, ...spec });
  const processor = loadRetro(rate, params);
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(128), new Float32Array(128)];
  const result = [
    new Float32Array(Math.ceil(rate * seconds)),
    new Float32Array(Math.ceil(rate * seconds)),
  ];
  for (let frame = 0; frame < result[0]!.length; frame += 128) {
    input[0]!.fill(0);
    input[1]!.fill(0);
    if (frame === 0) input[0]![0] = input[1]![0] = 0.8;
    processor.process([input], [output], params);
    for (let channel = 0; channel < 2; channel++)
      result[channel]!.set(
        output[channel]!.subarray(0, Math.min(128, result[channel]!.length - frame)),
        frame,
      );
  }
  return result;
}
function energy(data: Float32Array, from = 0, to = data.length): number {
  let total = 0;
  for (let i = Math.floor(from); i < Math.floor(to); i++) total += data[i]! ** 2;
  return total;
}

/**
 * Seconds to fall 60 dB below 3 kHz: four one-pole lowpasses at 3 kHz, the backward-integrated
 * energy, and its fall from -5 to -25 dB scaled to 60.
 */
function rt60Below3k(data: Float32Array, rate = 48000): number {
  const pole = 1 - Math.exp((-2 * Math.PI * 3000) / rate);
  const state = [0, 0, 0, 0];
  const tail = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = data[i]!;
    for (let k = 0; k < state.length; k++) v = state[k]! += pole * (v - state[k]!);
    tail[i] = v * v;
  }
  for (let i = data.length - 2; i >= 0; i--) tail[i]! += tail[i + 1]!;
  const crossing = (db: number): number => tail.findIndex((e) => e < tail[0]! * 10 ** (db / 10));
  return ((crossing(-25) - crossing(-5)) / rate) * 3;
}

describe('retro reverb shipped DSP', () => {
  it.each(RETRO_REVERB_MODES)('%s has a finite stereo tail', (mode) => {
    const [left, right] = render({ mode });
    expect(left!.every(Number.isFinite)).toBe(true);
    expect(right!.every(Number.isFinite)).toBe(true);
    expect(energy(left!, 100)).toBeGreaterThan(1e-6);
    expect(right).not.toEqual(left);
  });
  it('longer decay sustains the late field; a short tail dies', () => {
    const [short] = render({ decay: RETRO_REVERB_BOUNDS.decay[0] });
    const [long] = render({ decay: RETRO_REVERB_BOUNDS.decay[1] });
    expect(energy(long!, 48000)).toBeGreaterThan(energy(short!, 48000) * 100);
    expect(energy(short!, 48000)).toBeLessThan(1e-12);
  });
  // Size 10 is the top of the range (RV-4): 540 ms lines, sized with Drift's reach.
  it.each([1, RETRO_REVERB_BOUNDS.size[1]])(
    'drift at Size %s moves the tail and keeps its decay below 3 kHz',
    SLOW,
    (size) => {
      const decay = 2;
      const still = render({ decay, size, tone: 9000 }, 48000, 4);
      const [left, right] = render(
        { decay, size, tone: 9000, driftDepth: 1, driftRate: 2 },
        48000,
        4,
      );
      expect(left).not.toEqual(still[0]);
      expect(right).not.toEqual(still[1]);
      expect(Math.abs(rt60Below3k(left!) / decay - 1)).toBeLessThan(0.1);
    },
  );
  it('density adds echoes in the first 50 ms and keeps the decay below 3 kHz', SLOW, () => {
    const decay = 2;
    const [sparse] = render({ decay, tone: 9000 }, 48000, 3);
    const [dense] = render({ decay, tone: 9000, density: 1 }, 48000, 3);
    expect(Math.abs(rt60Below3k(dense!) / rt60Below3k(sparse!) - 1)).toBeLessThan(0.05);
    // Diffusion 0 keeps each path one click: a rise past 10 % of the peak after a fall below 2.5 %.
    const echoes = (data: Float32Array): number => {
      const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      let count = 0,
        armed = true;
      for (const v of data) {
        if (armed && Math.abs(v) > peak / 10) count++;
        armed = armed ? Math.abs(v) <= peak / 10 : Math.abs(v) < peak / 40;
      }
      return count;
    };
    const [few] = render({ diffusion: 0 }, 48000, 0.05);
    const [many] = render({ diffusion: 0, density: 1 }, 48000, 0.05);
    expect(echoes(many!)).toBeGreaterThanOrEqual(echoes(few!) + 6);
    // At the box's corners the knob is a spread control: each step moves the output further from
    // Density 0, and 0.25 is well short of 1. Unheld, the largest Size at the shortest Decay
    // weighted its taps so far over the ends that any Density above 0 played as 1.
    const { size: sizes, decay: decays } = RETRO_REVERB_BOUNDS;
    for (const [size, decay] of [
      [sizes[1], decays[0]],
      [sizes[0], decays[1]],
    ] as const) {
      const spec = { size, decay, tone: 9000 };
      const [left0, right0] = render({ ...spec, density: 0 });
      const distances = [0.25, 0.5, 0.75, 1].map((density) => {
        const [left, right] = render({ ...spec, density });
        let moved = 0;
        for (let i = 0; i < left!.length; i++)
          moved += (left![i]! - left0![i]!) ** 2 + (right![i]! - right0![i]!) ** 2;
        return Math.sqrt(moved / (energy(left0!) + energy(right0!)));
      });
      const full = distances[distances.length - 1]!;
      expect(distances[0]).toBeLessThan(0.75 * full);
      for (let k = 1; k < distances.length; k++)
        expect(distances[k]! - distances[k - 1]!).toBeGreaterThan(0.05 * full);
    }
    // Level-neutral within 1 dB at the darkest Tone too: the ends' energy against the taps' follows
    // Tone, Size and Decay. A fixed match measured at 9 kHz played the box's corner (Size 10,
    // Decay 0.2 s) 3 dB louder at Tone 800, and a setting between the table's nodes 1.7 dB.
    for (const spec of [
      { tone: RETRO_REVERB_BOUNDS.tone[0], size: sizes[1], decay: decays[0] },
      { tone: 1100, size: 2, decay: 1 },
    ]) {
      const levels = render({ ...spec, density: 0 }, 48000, 3);
      render({ ...spec, density: 1 }, 48000, 3).forEach((data, channel) =>
        expect(Math.abs(10 * Math.log10(energy(data) / energy(levels[channel]!)))).toBeLessThan(1),
      );
    }
  });
  it.each(['gated', 'reverse'] as const)(
    '%s skips Drift, which only the tank plays',
    SLOW,
    (mode) => {
      expect(render({ mode, driftDepth: 1, driftRate: 2 }, 48000, 0.5)).toEqual(
        render({ mode }, 48000, 0.5),
      );
    },
  );
  it.each(['gated', 'reverse'] as const)('%s ends after its selected duration', SLOW, (mode) => {
    const duration = 0.3;
    const [left] = render({ mode, duration });
    expect(energy(left!, 0, 48000 * duration)).toBeGreaterThan(1e-6);
    expect(energy(left!, 48000 * (duration + 0.03))).toBeLessThan(1e-12);
  });
  it('reverse builds towards its end instead of applying an ordinary decay', SLOW, () => {
    const [left] = render({ mode: 'reverse', duration: 0.6 });
    const early = energy(left!, 0, 48000 * 0.2);
    const late = energy(left!, 48000 * 0.4, 48000 * 0.59);
    expect(late).toBeGreaterThan(early * 4);
  });
  it('pre-delay shifts the finite response and character changes conversion', SLOW, () => {
    const preDelay = 0.15;
    const [dryStart] = render({ mode: 'gated', preDelay: 0 });
    const [delayed] = render({ mode: 'gated', preDelay });
    const [coloured] = render({ mode: 'gated', character: 1 });
    expect(energy(delayed!, 0, 48000 * preDelay)).toBe(0);
    expect(energy(delayed!, 48000 * preDelay)).toBeGreaterThan(1e-6);
    expect(energy(dryStart!, 0, 48000 * preDelay)).toBeGreaterThan(1e-6);
    expect(coloured).not.toEqual(dryStart);
  });
  it('tone reduces rapid changes in the finite field', SLOW, () => {
    const [dark] = render({ mode: 'gated', tone: RETRO_REVERB_BOUNDS.tone[0] });
    const [bright] = render({ mode: 'gated', tone: RETRO_REVERB_BOUNDS.tone[1] });
    const roughness = (data: Float32Array): number => {
      let total = 0;
      for (let i = 1; i < data.length; i++) total += (data[i]! - data[i - 1]!) ** 2;
      return total / energy(data);
    };
    expect(roughness(dark!)).toBeLessThan(roughness(bright!));
  });
  it.each([44100, 48000, 96000])('keeps a 400 ms finite field at %s Hz', (rate) => {
    const [left] = render({ mode: 'gated', duration: 0.4 }, rate);
    expect(energy(left!, Math.floor(rate * 0.3), Math.floor(rate * 0.39))).toBeGreaterThan(1e-7);
    expect(energy(left!, Math.floor(rate * 0.43))).toBeLessThan(1e-12);
  });
  it.each([{ mix: 0 }, { enabled: false }])('keeps stereo dry exact: %j', (spec) => {
    const p = retroParams(spec),
      node = loadRetro(48000, p);
    const input = [
      Float32Array.from({ length: 128 }, (_, i) => i / 128),
      new Float32Array(128).fill(-0.25),
    ];
    const output = [new Float32Array(128), new Float32Array(128)];
    node.process([input], [output], p);
    expect(output).toEqual(input);
  });
  // 46,875 Hz runs exactly 64 internal ticks a 128-frame block; 44.1 and 48 kHz alternate counts.
  it.each([44100, 46875, 48000])('a live Size move lands on each block target at %s Hz', (rate) => {
    const p = retroParams({ size: 1 }),
      node = loadRetro(rate, p) as RetroProcessorLike & {
        dsp: { tank: { size: number; sizeTarget: number } };
      };
    const input = [[new Float32Array(128).fill(0.1)]];
    const output = [new Float32Array(128), new Float32Array(128)];
    p.size![0] = RETRO_REVERB_BOUNDS.size[1];
    for (let block = 0; block < 40; block++) {
      node.process(input, [output], p);
      expect(node.dsp.tank.size).not.toBe(1);
      expect(node.dsp.tank.size).toBe(node.dsp.tank.sizeTarget);
    }
  });
  it("density's taps glide with a Size move, tick by tick, and land with the line ends", () => {
    interface Tank {
      size: number;
      tapWhole: Int32Array;
      tapFraction: Float64Array;
      tapFractions: Float64Array;
      tapLines: Uint8Array;
      configure(settings: Record<string, number>): void;
      tick(): void;
    }
    const node = loadRetro(48000, retroParams({ density: 1 })) as unknown as {
      dsp: { tank: Tank };
    };
    const tank = node.dsp.tank;
    const ticks = 8;
    const settings = { ticks, decay: 1.4, tone: 6000, diffusion: 0.5, driftRate: 0.5 };
    tank.configure({ ...settings, size: 3, driftDepth: 0, density: 1, finite: 0 });
    for (let t = 1; t <= ticks; t++) {
      tank.tick();
      expect(tank.size).toBeCloseTo(1 + (2 * t) / ticks, 12);
      tank.tapWhole.forEach((whole, k) =>
        expect(whole - tank.tapFraction[k]!).toBeCloseTo(
          tank.tapFractions[k]! * DSP.tankSeconds[tank.tapLines[k]!]! * tank.size * DSP.rate,
          9,
        ),
      );
    }
    expect(tank.size).toBe(3);
  });
  it('handles absent input, different block sizes, live extremes, telemetry and stop', () => {
    const p = retroParams(),
      node = loadRetro(48000, p);
    node.port.onmessage({ data: { type: 'reportLoad', quanta: 2 } });
    for (let block = 0; block < 100; block++) {
      const frames = block % 2 ? 64 : 256;
      const output = [new Float32Array(frames), new Float32Array(frames)];
      for (const [key, bounds] of Object.entries(RETRO_REVERB_BOUNDS))
        p[key]![0] = bounds[block % 2]!;
      p.mode![0] = block % RETRO_REVERB_MODES.length;
      const input = block < 30 ? [[new Float32Array(frames).fill(0.8)]] : [[]];
      expect(node.process(input, [output], p)).toBe(true);
      expect(output.every((ch) => ch.every((v) => Number.isFinite(v) && Math.abs(v) < 2))).toBe(
        true,
      );
    }
    expect(node.port.posted).toContainEqual(expect.objectContaining({ type: 'load', quanta: 2 }));
    node.port.onmessage({ data: { type: 'stop' } });
    expect(node.process([[]], [[new Float32Array(128)]], p)).toBe(false);
  });
});
