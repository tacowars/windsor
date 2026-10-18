/**
 * windsor#897: the page `bench.mjs` serves. Each cell renders the program on a
 * fresh OfflineAudioContext through N shipped Transient processors in
 * parallel and posts the render's wall time. Bundled by esbuild, so it builds
 * the params the insert itself writes (`transientParameters`,
 * `DEFAULT_TRANSIENT`).
 */
import { DEFAULT_TRANSIENT } from '../../../packages/engine/src/inserts/transientSpec';
import { transientParameters } from '../../../packages/engine/src/inserts/transientParameters';
import { TRANSIENT_NAME } from '../../../packages/engine/src/inserts/transientConstants';

export const PLAN = {
  rate: 48000,
  seconds: 20,
  bpm: 128,
  repeats: 5,
  instances: [1, 4, 16],
  modes: ['neutral', 'punch', 'meter', 'quiet'],
  quantum: 128,
};

const BUNDLE = '/packages/engine/src/worklet/generated/transient-processor.js';

export interface Cell {
  mode: string;
  instances: number;
}

/**
 * A stereo pad (three detuned sines) at about −12 dBFS with a kick on every
 * beat and a noise hat between, the drum-heavy program a Transient sits on;
 * in `quiet`, the same for the first 2 seconds and then silence, so the
 * insert sleeps once its sustain reference has released.
 */
function program(ctx: BaseAudioContext, mode: string): AudioBuffer {
  const frames = PLAN.rate * PLAN.seconds;
  const input = ctx.createBuffer(2, frames, PLAN.rate);
  const pad = [220, 277.18, 329.63];
  const beat = (60 / PLAN.bpm) * PLAN.rate;
  const end = mode === 'quiet' ? 2 * PLAN.rate : frames;
  let seed = 0x2545f491;
  for (let ch = 0; ch < 2; ch++) {
    const data = input.getChannelData(ch);
    for (let i = 0; i < end; i++) {
      let sum = 0;
      for (const f of pad) sum += Math.sin((2 * Math.PI * f * (1 + ch * 0.002) * i) / PLAN.rate);
      const t = (i % beat) / PLAN.rate;
      const hz = 50 + 100 * Math.exp(-t / 0.03);
      const kick = 0.6 * Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * hz * t);
      const off = ((i + beat / 2) % beat) / PLAN.rate;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const hat = 0.15 * Math.exp(-off / 0.02) * ((seed >>> 0) / 0x7fffffff - 1);
      data[i] = sum * 0.04 + kick + hat;
    }
  }
  return input;
}

function transients(ctx: BaseAudioContext, cell: Cell, input: AudioNode): void {
  const spec =
    cell.mode === 'neutral' ? DEFAULT_TRANSIENT : { ...DEFAULT_TRANSIENT, attack: 10, sustain: -12 };
  const parameterData = transientParameters(spec);
  for (let n = 0; n < cell.instances; n++) {
    const node = new AudioWorkletNode(ctx, TRANSIENT_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData,
    });
    input.connect(node);
    node.connect(ctx.destination);
    if (cell.mode === 'meter') node.port.postMessage({ type: 'meter', enabled: true });
  }
}

/** One repeat: build the graph, then time `startRendering` alone. */
async function render(cell: Cell): Promise<{ ms: number; peak: number; rms: number }> {
  const frames = PLAN.rate * PLAN.seconds;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: PLAN.rate });
  await ctx.audioWorklet.addModule(BUNDLE);
  const source = new AudioBufferSourceNode(ctx, { buffer: program(ctx, cell.mode) });
  source.start(0);
  if (cell.instances === 0) source.connect(ctx.destination);
  else transients(ctx, cell, source);
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
