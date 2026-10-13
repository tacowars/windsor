/**
 * The Pump's shipped bundle (record `2026-10-13-pump-insert`): the drawn
 * shape plays as `pumpLevelAt` draws it, a key's onset starts the cycle
 * within a millisecond, the hold and the re-arm keep one kick one trigger,
 * the switch's off is the input to the bit, and the cycle's length holds at
 * 44.1, 48 and 96 kHz.
 */
import { describe, expect, it } from 'vitest';
import { kick, loadPump, pumpParams, pumpSignal, runPump } from '../__fixtures__/pumpHarness';
import { PUMP_DSP } from './pumpConstants';
import { pumpGain, pumpLevelAt } from './pumpCurves';
import { DEFAULT_PUMP } from './pumpSpec';
import type { PumpPoint } from './pumpSpec';

const RATE = 48000;
const DC = (frames: number): Float32Array[] => pumpSignal(frames, () => 1);
/** The first frame at or after `from` whose gain has left unity. */
const firstDuck = (out: Float32Array, from = 0): number =>
  out.findIndex((v, i) => i >= from && v < 0.99);

const SHAPE: PumpPoint[] = [
  { at: 0, level: 0, bend: 0 },
  { at: 0.1, level: 0.2, bend: 0.8 },
  { at: 0.1, level: 0.6, bend: -0.5 },
  { at: 0.7, level: 1, bend: 0 },
  { at: 1, level: 0.9, bend: 0 },
];

describe('the Pump bundle', () => {
  it('plays the drawn shape as pumpLevelAt draws it, sample for sample', () => {
    const params = pumpParams(
      { points: SHAPE, sync: false, lengthMs: 100, smoothMs: 0, depth: 1 },
      { external: true },
    );
    const pump = loadPump(RATE, params);
    const frames = 6400;
    const onset = 300;
    const key = pumpSignal(frames, (i) => (i >= onset ? 0.5 : 0));
    const { left, right } = runPump(pump, DC(frames), params, key);
    const step = 1000 / (params.lengthMs![0]! * RATE);
    // The points reach the worklet as k-rate params, so at single precision.
    const sent = SHAPE.map((p) => ({
      at: Math.fround(p.at),
      level: Math.fround(p.level),
      bend: Math.fround(p.bend),
    }));
    let phase = 0;
    for (let i = onset; i < onset + 4800 + 50; i++) {
      const level = phase < 1 ? pumpLevelAt(sent, phase) : sent[sent.length - 1]!.level;
      expect(left[i]).toBeCloseTo(pumpGain(level, 1), 6);
      if (phase < 1) phase += step;
    }
    expect(right).toEqual(left);
    // Before the key, the shape rests at its last level.
    expect(left[onset - 1]).toBeCloseTo(0.9, 6);
  });

  it('starts the cycle within a millisecond of a kick on the key', () => {
    const params = pumpParams({ smoothMs: 0 }, { external: true });
    const frames = RATE;
    const onsets = [4800, 4800 + RATE / 2];
    const { left } = runPump(
      loadPump(RATE, params),
      DC(frames),
      params,
      kick(frames, RATE, onsets),
    );
    for (const onset of onsets) {
      const at = firstDuck(left, onset - 100);
      expect(at).toBeGreaterThanOrEqual(onset);
      expect(at - onset).toBeLessThan(RATE / 1000);
    }
  });

  it('keys from its own input when not external, and takes one trigger per kick', () => {
    const params = pumpParams({ sync: false, lengthMs: 50, smoothMs: 0 });
    const frames = RATE;
    const onsets = [2400, 2400 + RATE / 4, 2400 + RATE / 2];
    const program = kick(frames, RATE, onsets);
    const pump = loadPump(RATE, params);
    const { phases } = runPump(pump, program, params);
    // A cycle of 50 ms is 19 quanta: count the quanta where a new cycle began.
    const starts = phases.filter((p, q) => q > 0 && p < phases[q - 1]!).length;
    expect(starts + (phases[0]! < 1 ? 1 : 0)).toBe(onsets.length);
  });

  it('holds off a second onset inside the hold time', () => {
    const params = pumpParams(
      { sync: false, lengthMs: 400, smoothMs: 0, holdMs: 80 },
      { external: true },
    );
    const frames = RATE / 2;
    const pump = loadPump(RATE, params);
    const { phases } = runPump(pump, DC(frames), params, kick(frames, RATE, [1200, 1200 + 1440]));
    // With no retrigger the phase only grows until it rests.
    for (let q = 1; q < phases.length; q++) {
      if (phases[q - 1]! < 1) expect(phases[q]!).toBeGreaterThanOrEqual(phases[q - 1]!);
    }
  });

  it('does not retrigger on a steady tone', () => {
    const params = pumpParams({ sync: false, lengthMs: 50 });
    const frames = RATE;
    const tone = pumpSignal(frames, (i) => 0.5 * Math.sin((2 * Math.PI * 80 * i) / RATE));
    const { phases } = runPump(loadPump(RATE, params), tone, params);
    const starts = phases.filter((p, q) => q > 0 && p < phases[q - 1]!).length;
    expect(starts).toBe(0);
  });

  it('copies its input to the bit when switched off, and fades between', () => {
    const on = pumpParams({ smoothMs: 0 }, { external: true });
    const off = pumpParams({ smoothMs: 0, enabled: false }, { external: true });
    const pump = loadPump(RATE, on);
    const frames = 4096;
    const program = pumpSignal(frames, (i) => Math.sin(i * 0.01) * 0.7);
    runPump(pump, program, on, kick(frames, RATE, [128]));
    const { left } = runPump(pump, program, off, kick(frames, RATE, [128]));
    const fade = Math.ceil(0.005 * RATE);
    expect(Array.from(left.subarray(fade + 128))).toEqual(
      Array.from(program[0]!.subarray(fade + 128)),
    );
    expect(pump.dsp.bypassed).toBe(true);
  });

  it.each([44100, 48000, 96000])('runs a 1/8 cycle at 120 BPM for 250 ms at %i Hz', (rate) => {
    const params = pumpParams({ division: '1/8', smoothMs: 0 }, { external: true });
    const pump = loadPump(rate, params);
    const frames = Math.round(rate * 0.4);
    const key = pumpSignal(frames, (i) => (i >= 256 ? 0.5 : 0));
    runPump(pump, DC(frames), params, key);
    expect(pump.dsp.phaseStep * rate * 0.25).toBeCloseTo(1, 6);
    expect(pump.dsp.phase).toBeGreaterThanOrEqual(1);
  });

  it('posts a trace of the key across the cycle while the scope is on', () => {
    const params = pumpParams({ sync: false, lengthMs: 100 }, { external: true });
    const pump = loadPump(RATE, params);
    pump.port.onmessage({ data: { type: 'scope', enabled: true } });
    const frames = RATE / 2;
    runPump(pump, DC(frames), params, kick(frames, RATE, [1000]));
    const traces = pump.port.posted.filter(
      (m): m is { type: 'trace'; levels: Float32Array } => (m as { type: string }).type === 'trace',
    );
    expect(traces).toHaveLength(1);
    const levels = Array.from(traces[0]!.levels);
    expect(levels).toHaveLength(PUMP_DSP.scopeBins);
    // The kick is loudest at its onset and decays across the cycle.
    expect(levels[0]!).toBeGreaterThan(0.7);
    expect(levels[levels.length - 1]!).toBeLessThan(levels[0]! / 2);
    expect(pump.port.posted.some((m) => (m as { type: string }).type === 'phase')).toBe(true);
  });

  it('posts nothing while the scope is off', () => {
    const params = pumpParams(DEFAULT_PUMP, { external: true });
    const pump = loadPump(RATE, params);
    runPump(pump, DC(RATE / 4), params, kick(RATE / 4, RATE, [1000]));
    expect(pump.port.posted).toEqual([]);
  });
});
