/** Real synth → generated insert, with long pad gates and articulated saw bass. */
import { expect, it } from 'vitest';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';
import { PRESETS } from '../patch/presets';
import { DEFAULT_TAPE } from './tapeSpec';

it.each([
  ['saw-arp', 'ferric', [36], 2],
  ['pad-drift', 'vintage', [48, 55, 60], 6],
] as const)('processes %s in its intended register and gate', (patch, preset, notes, seconds) => {
  const fm = loadProcessor();
  const frames = Math.ceil((fm.sampleRate * seconds) / 128) * 128;
  const events: ScheduledEvent[] = notes.map((note, id) => ({
    type: 'noteOn',
    id,
    note,
    velocity: 0.7,
    frame: 0,
  }));
  if (preset === 'ferric') {
    events.push({ type: 'noteOff', id: 0, frame: fm.sampleRate / 4 });
    events.push({ type: 'noteOn', id: 1, note: 43, velocity: 1, frame: fm.sampleRate / 2 });
    events.push({ type: 'noteOff', id: 1, frame: (fm.sampleRate * 3) / 4 });
  }
  const dry = render(fm, fm.create(PRESETS[patch]!), frames / 128, events);
  expect(dry.nonFinite).toBe(0);
  expect(dry.rms).toBeGreaterThan(0.001);
  const params = tapeParams({ ...DEFAULT_TAPE, model: preset, drive: 12, wear: 25 });
  // Leave input headroom as a track fader would: this three-note pad already
  // exceeds unity dry. Tape coloration is not a final limiter.
  const trackLevel = 0.5;
  const fx = loadTape(fm.sampleRate, params);
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [[new Float32Array(128), new Float32Array(128)]];
  let peak = 0,
    energy = 0,
    difference = 0;
  for (let frame = 0; frame < frames; frame += 128) {
    for (let i = 0; i < 128; i++) {
      input[0]![i] = trackLevel * dry.samples[(frame + i) * 2]!;
      input[1]![i] = trackLevel * dry.samples[(frame + i) * 2 + 1]!;
    }
    fx.process([input], output, params);
    for (let channel = 0; channel < 2; channel++)
      for (let i = 0; i < 128; i++) {
        const x = output[0]![channel]![i]!;
        peak = Math.max(peak, Math.abs(x));
        energy += x * x;
        difference += (x - input[channel]![i]!) ** 2;
      }
  }
  expect(Number.isFinite(peak)).toBe(true);
  expect(peak).toBeLessThan(1);
  expect(Math.sqrt(energy / (frames * 2))).toBeGreaterThan(dry.rms * 0.1);
  expect(Math.sqrt(difference / (frames * 2))).toBeGreaterThan(dry.rms * 0.01);
});
