import { describe, expect, it } from 'vitest';
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import type { RetroReverbSpec } from './retroReverbSpec';
import { RETRO_REVERB_BOUNDS, RETRO_REVERB_MODES } from './retroReverbConstants';

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
  it.each(['gated', 'reverse'] as const)('%s ends after its selected duration', (mode) => {
    const duration = 0.3;
    const [left] = render({ mode, duration });
    expect(energy(left!, 0, 48000 * duration)).toBeGreaterThan(1e-6);
    expect(energy(left!, 48000 * (duration + 0.03))).toBeLessThan(1e-12);
  });
  it('reverse builds towards its end instead of applying an ordinary decay', () => {
    const [left] = render({ mode: 'reverse', duration: 0.6 });
    const early = energy(left!, 0, 48000 * 0.2);
    const late = energy(left!, 48000 * 0.4, 48000 * 0.59);
    expect(late).toBeGreaterThan(early * 4);
  });
  it('pre-delay shifts the finite response and character changes conversion', () => {
    const preDelay = 0.15;
    const [dryStart] = render({ mode: 'gated', preDelay: 0 });
    const [delayed] = render({ mode: 'gated', preDelay });
    const [coloured] = render({ mode: 'gated', character: 1 });
    expect(energy(delayed!, 0, 48000 * preDelay)).toBe(0);
    expect(energy(delayed!, 48000 * preDelay)).toBeGreaterThan(1e-6);
    expect(energy(dryStart!, 0, 48000 * preDelay)).toBeGreaterThan(1e-6);
    expect(coloured).not.toEqual(dryStart);
  });
  it('tone reduces rapid changes in the finite field', () => {
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
