/**
 * Record 2026-10-17-dub-delay-regeneration: the page `bench.mjs` serves. Each
 * cell renders the program on a fresh OfflineAudioContext through N shipped
 * Dub delay processors and posts the render's wall time. Bundled by esbuild,
 * so it builds the params the insert itself writes (`delayParameters`,
 * `DEFAULT_DELAY`, the starting points).
 */
import { DELAY_NAME } from '../../../packages/engine/src/inserts/delayConstants';
import { delayParameters } from '../../../packages/engine/src/inserts/delayParameters';
import { applyDelayPreset } from '../../../packages/engine/src/inserts/delayPresets';
import { DEFAULT_DELAY } from '../../../packages/engine/src/inserts/delaySpec';
import type { DelaySpec } from '../../../packages/engine/src/inserts/delaySpec';

/** Each mode's settings over the defaults. */
const MODES: Record<string, DelaySpec> = {
  default: DEFAULT_DELAY,
  runaway: applyDelayPreset(DEFAULT_DELAY, 'runaway'),
  sustain: { ...DEFAULT_DELAY, sustain: true },
  motion: { ...DEFAULT_DELAY, wave: 'sine', wow: 1, sweep: 4, modRate: 10 },
  fold: { ...DEFAULT_DELAY, character: 'fold', drive: 30, filter: 'peak', resonance: 12 },
};

export const PLAN = {
  rate: 48000,
  seconds: 20,
  bpm: 120,
  repeats: 3,
  instances: [1, 4],
  modes: Object.keys(MODES),
  quantum: 128,
};

const BUNDLE = '/packages/engine/src/worklet/generated/delay-processor.js';

export interface Cell {
  mode: string;
  instances: number;
}

/** A stereo pad (three detuned sines) at −12 dBFS with a click on every beat. */
function program(ctx: BaseAudioContext): AudioBuffer {
  const frames = PLAN.rate * PLAN.seconds;
  const input = ctx.createBuffer(2, frames, PLAN.rate);
  const pad = [220, 277.18, 329.63];
  const beat = (60 / PLAN.bpm) * PLAN.rate;
  for (let ch = 0; ch < 2; ch++) {
    const data = input.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const f of pad) sum += Math.sin((2 * Math.PI * f * (1 + ch * 0.002) * i) / PLAN.rate);
      const t = (i % beat) / PLAN.rate;
      data[i] = sum * 0.08 + 0.3 * Math.exp(-t / 0.01) * Math.sin(2 * Math.PI * 1800 * t);
    }
  }
  return input;
}

async function render(cell: Cell): Promise<{ ms: number; peak: number; rms: number }> {
  const frames = PLAN.rate * PLAN.seconds;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: PLAN.rate });
  await ctx.audioWorklet.addModule(BUNDLE);
  const source = new AudioBufferSourceNode(ctx, { buffer: program(ctx) });
  source.start(0);
  if (cell.instances === 0) source.connect(ctx.destination);
  const parameterData = delayParameters(MODES[cell.mode] ?? DEFAULT_DELAY, PLAN.bpm);
  for (let n = 0; n < cell.instances; n++) {
    const node = new AudioWorkletNode(ctx, DELAY_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData,
    });
    source.connect(node);
    node.connect(ctx.destination);
  }
  const started = performance.now();
  const rendered = await ctx.startRendering();
  const ms = performance.now() - started;
  let peak = 0;
  let energy = 0;
  const left = rendered.getChannelData(0);
  for (const v of left) {
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  const rms = Math.sqrt(energy / left.length) / Math.max(1, cell.instances);
  return { ms, peak, rms };
}

const post = (body: unknown): Promise<Response> =>
  fetch('/result', { method: 'POST', body: JSON.stringify(body) });

async function run(): Promise<void> {
  const cells: Cell[] = [{ mode: 'harness', instances: 0 }];
  for (const mode of PLAN.modes) {
    for (const instances of PLAN.instances) cells.push({ mode, instances });
  }
  for (const cell of cells) {
    for (let repeat = 0; repeat < PLAN.repeats; repeat++) {
      await post({ kind: 'repeat', cell, repeat, ...(await render(cell)) });
    }
  }
  await post({ kind: 'done', userAgent: navigator.userAgent, plan: PLAN });
}

run().catch((error: unknown) => post({ kind: 'error', message: String(error) }));
