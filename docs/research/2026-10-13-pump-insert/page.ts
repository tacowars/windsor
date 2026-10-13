/**
 * windsor#803: the page `bench.mjs` serves. Each cell renders the program on a
 * fresh OfflineAudioContext through N shipped Pump processors, keyed from a
 * kick, and posts the render's wall time. Bundled by esbuild, so it builds the
 * params the insert itself writes (`pumpParameters`, `DEFAULT_PUMP`).
 */
import { DEFAULT_PUMP } from '../../../packages/engine/src/inserts/pumpSpec';
import { pumpParameters } from '../../../packages/engine/src/inserts/pumpParameters';
import { PUMP_NAME } from '../../../packages/engine/src/inserts/pumpConstants';

export const PLAN = {
  rate: 48000,
  seconds: 20,
  bpm: 120,
  repeats: 5,
  instances: [1, 4, 16],
  modes: ['steady', 'edits', 'scope'],
  /** In `edits`, every this many quanta the second point's level flips on every instance. */
  editEveryQuanta: 16,
  editLevels: [0.05, 0.4],
  quantum: 128,
};

const BUNDLE = '/packages/engine/src/worklet/generated/pump-processor.js';

export interface Cell {
  mode: string;
  instances: number;
}

/** A stereo pad (three detuned sines) at −12 dBFS, and a kick on every beat. */
function program(ctx: BaseAudioContext): { input: AudioBuffer; key: AudioBuffer } {
  const frames = PLAN.rate * PLAN.seconds;
  const input = ctx.createBuffer(2, frames, PLAN.rate);
  const key = ctx.createBuffer(1, frames, PLAN.rate);
  const pad = [220, 277.18, 329.63];
  const beat = (60 / PLAN.bpm) * PLAN.rate;
  for (let ch = 0; ch < 2; ch++) {
    const data = input.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const f of pad) sum += Math.sin((2 * Math.PI * f * (1 + ch * 0.002) * i) / PLAN.rate);
      data[i] = sum * 0.08;
    }
  }
  const kick = key.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const t = (i % beat) / PLAN.rate;
    const hz = 50 + 100 * Math.exp(-t / 0.03);
    kick[i] = 0.9 * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * hz * t);
  }
  return { input, key };
}

function source(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const node = new AudioBufferSourceNode(ctx, { buffer });
  node.start(0);
  return node;
}

/** The second point's level flips every `editEveryQuanta`, so the shape rebuilds. */
function scheduleEdits(node: AudioWorkletNode): void {
  const param = node.parameters.get('level1')!;
  const step = (PLAN.editEveryQuanta * PLAN.quantum) / PLAN.rate;
  for (let n = 0, t = 0; t < PLAN.seconds; n++, t += step) {
    param.setValueAtTime(PLAN.editLevels[n % 2]!, t);
  }
}

function pumps(ctx: BaseAudioContext, cell: Cell, input: AudioNode, key: AudioNode): void {
  const parameterData = { ...pumpParameters(DEFAULT_PUMP, PLAN.bpm), external: 1 };
  for (let n = 0; n < cell.instances; n++) {
    const node = new AudioWorkletNode(ctx, PUMP_NAME, {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData,
    });
    input.connect(node);
    key.connect(node, 0, 1);
    node.connect(ctx.destination);
    if (cell.mode === 'edits') scheduleEdits(node);
    if (cell.mode === 'scope') node.port.postMessage({ type: 'scope', enabled: true });
  }
}

/** One repeat: build the graph, then time `startRendering` alone. */
async function render(cell: Cell): Promise<{ ms: number; peak: number; rms: number }> {
  const frames = PLAN.rate * PLAN.seconds;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: PLAN.rate });
  await ctx.audioWorklet.addModule(BUNDLE);
  const buffers = program(ctx);
  const input = source(ctx, buffers.input);
  const key = source(ctx, buffers.key);
  if (cell.instances === 0) input.connect(ctx.destination);
  else pumps(ctx, cell, input, key);
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
  // Each instance plays the whole program, so an instance's level is the sum over N.
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
