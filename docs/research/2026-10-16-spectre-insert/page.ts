/**
 * Records 2026-10-16-spectre-insert and 2026-10-17-spectre-drawn-cells: the
 * page `bench.mjs` serves. Each cell renders the program on a fresh
 * OfflineAudioContext through N shipped Spectre processors and posts the
 * render's wall time. Bundled by esbuild, so it builds each node as
 * `spectreInsert.ts` does: the params `spectreParameters` writes and the
 * cells `spectreCellPayload` hands over, both from one spec. Before the timed
 * cells, a check renders a lone click and posts the energy of its tail, so a
 * run shows the default cells' delay and feedback are live.
 */
import { DEFAULT_SPECTRE } from '../../../packages/engine/src/inserts/spectreSpec';
import type { SpectreSpec } from '../../../packages/engine/src/inserts/spectreSpec';
import { spectreParameters } from '../../../packages/engine/src/inserts/spectreParameters';
import { spectreCellPayload } from '../../../packages/engine/src/inserts/spectreCells';
import type { SpectreSelection } from '../../../packages/engine/src/inserts/spectreCells';
import {
  SPECTRE_CELLS,
  SPECTRE_NAME,
} from '../../../packages/engine/src/inserts/spectreConstants';

const D = DEFAULT_SPECTRE;

/** Half the cells selected, in alternating runs of ten. */
const HALF: SpectreSelection = Array.from(
  { length: SPECTRE_CELLS / 20 },
  (_, i) => [i * 20, i * 20 + 10] as const,
);
const SELECT: Partial<SpectreSpec> = {
  selection: HALF,
  gainSelect: 0.5,
  delaySelect: 0.5,
  feedbackSelect: 0.5,
};

/**
 * Each mode's settings over the defaults (Bleep Test). `moving` also steps the
 * delay shift; `follow-chord` changes the `pitches` param every bar; `scope`
 * turns the workbench's scope on.
 */
const MODES: Record<string, Partial<SpectreSpec>> = {
  default: {},
  coarse: { bands: '128' },
  fine: { bands: '2048', overlap: '4x' },
  blur: { mod: 'blur', modA: 0.7, modB: 0.6, modC: 0.3 },
  moving: {
    lfoHz: 0.5,
    lfoDest1: 'delayOffset',
    lfoDepth1: 0.5,
    lfoDest2: 'gainShift',
    lfoDepth2: 0.5,
    lfoDest3: 'feedbackOffset',
    lfoDepth3: 0.5,
  },
  'cells-stepped': {
    curves: {
      gain: { ...D.curves.gain, steps: true },
      delay: { ...D.curves.delay, steps: true },
      feedback: { ...D.curves.feedback, steps: true },
    },
  },
  select: SELECT,
  'follow-chord': { ...SELECT, follow: 'chord' },
  scope: {},
};

/** The chords `follow-chord` hands in, one a bar, as 12-bit pitch-class masks: C, F, G, Am. */
const CHORDS = [0b000010010001, 0b001000100001, 0b100010000100, 0b001000010001];

export const PLAN = {
  rate: 48000,
  seconds: 20,
  bpm: 120,
  repeats: 3,
  instances: [1, 4],
  modes: Object.keys(MODES),
  /** In `moving`, every this many quanta the delay curve's shift steps. */
  editEveryQuanta: 16,
  editShifts: [-1, 1],
  quantum: 128,
  /** After each render, untimed, the scope reports still in flight get this long to arrive. */
  drainMs: 200,
  /** The check: a lone click, and its output's RMS in two windows, in seconds (`tail`). */
  checkSeconds: 4,
  delayedFrom: 0.1,
  tailFrom: 0.7,
};

const BUNDLE = '/packages/engine/src/worklet/generated/spectre-processor.js';

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

function scheduleMoves(node: AudioWorkletNode): void {
  const param = node.parameters.get('delayShift')!;
  const step = (PLAN.editEveryQuanta * PLAN.quantum) / PLAN.rate;
  for (let n = 0, t = 0; t < PLAN.seconds; n++, t += step) {
    param.setValueAtTime(PLAN.editShifts[n % 2]!, t);
  }
}

/** A chord a bar into `pitches`, as the stage's `setChord` schedules them. */
function scheduleChords(node: AudioWorkletNode): void {
  const param = node.parameters.get('pitches')!;
  const bar = (4 * 60) / PLAN.bpm;
  for (let n = 0, t = 0; t < PLAN.seconds; n++, t += bar) {
    param.setValueAtTime(CHORDS[n % CHORDS.length]!, t);
  }
}

/** A node for `spec`, built as `spectreInsert.ts` builds it; `cells` false leaves the fallback cells. */
function spectreNode(ctx: BaseAudioContext, spec: SpectreSpec, cells = true): AudioWorkletNode {
  return new AudioWorkletNode(ctx, SPECTRE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: spectreParameters(spec, PLAN.bpm),
    processorOptions: cells ? { cells: spectreCellPayload(spec) } : {},
  });
}

interface Rendered {
  ms: number;
  peak: number;
  rms: number;
  /** Scope reports the main thread received (the `scope` mode's proof that it ran). */
  scopeReports: number;
}

async function render(cell: Cell): Promise<Rendered> {
  const frames = PLAN.rate * PLAN.seconds;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: PLAN.rate });
  await ctx.audioWorklet.addModule(BUNDLE);
  const source = new AudioBufferSourceNode(ctx, { buffer: program(ctx) });
  source.start(0);
  if (cell.instances === 0) source.connect(ctx.destination);
  const spec: SpectreSpec = { ...D, ...MODES[cell.mode] };
  let scopeReports = 0;
  for (let n = 0; n < cell.instances; n++) {
    const node = spectreNode(ctx, spec);
    source.connect(node);
    node.connect(ctx.destination);
    if (cell.mode === 'moving') scheduleMoves(node);
    if (cell.mode === 'follow-chord') scheduleChords(node);
    if (cell.mode === 'scope') {
      node.port.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
        if (data.type === 'scope') scopeReports++;
      };
      node.port.postMessage({ type: 'scope', enabled: true });
    }
  }
  if (cell.mode === 'scope') await new Promise((resolve) => setTimeout(resolve, PLAN.drainMs));
  const started = performance.now();
  const rendered = await ctx.startRendering();
  const ms = performance.now() - started;
  // Untimed: let the scope reports still queued for this thread arrive.
  await new Promise((resolve) => setTimeout(resolve, PLAN.drainMs));
  let peak = 0;
  let energy = 0;
  const left = rendered.getChannelData(0);
  for (const v of left) {
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  const rms = Math.sqrt(energy / left.length) / Math.max(1, cell.instances);
  return { ms, peak, rms, scopeReports };
}

/**
 * One Spectre's left output, fed a lone click at 0: its RMS from `delayedFrom`
 * (the dry click gone) to `tailFrom` (Bleep Test's longest delay, 500 ms,
 * passed), where only delays sound, and from `tailFrom` on, where only
 * feedback does.
 */
interface Tail {
  delayed: number;
  fedBack: number;
}

async function tail(spec: SpectreSpec, cells: boolean): Promise<Tail> {
  const frames = PLAN.rate * PLAN.checkSeconds;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: PLAN.rate });
  await ctx.audioWorklet.addModule(BUNDLE);
  const click = ctx.createBuffer(2, PLAN.rate, PLAN.rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = click.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const t = i / PLAN.rate;
      data[i] = 0.5 * Math.exp(-t / 0.01) * Math.sin(2 * Math.PI * 1800 * t);
    }
  }
  const source = new AudioBufferSourceNode(ctx, { buffer: click });
  const node = spectreNode(ctx, spec, cells);
  source.connect(node);
  node.connect(ctx.destination);
  source.start(0);
  const out = (await ctx.startRendering()).getChannelData(0);
  const rms = (fromSeconds: number, toSeconds: number): number => {
    const from = Math.round(fromSeconds * PLAN.rate),
      to = Math.min(out.length, Math.round(toSeconds * PLAN.rate));
    let energy = 0;
    for (let i = from; i < to; i++) energy += out[i]! * out[i]!;
    return Math.sqrt(energy / (to - from));
  };
  return {
    delayed: rms(PLAN.delayedFrom, PLAN.tailFrom),
    fedBack: rms(PLAN.tailFrom, PLAN.checkSeconds),
  };
}

/** The check: the defaults' tail, the same with the feedback drawn to zero, and on the fallback cells. */
async function check(): Promise<Record<string, Tail>> {
  const zero = new Array<number>(SPECTRE_CELLS).fill(0);
  const noFeedback: SpectreSpec = {
    ...D,
    curves: { ...D.curves, feedback: { left: zero, link: true, steps: false } },
  };
  return {
    defaultCells: await tail(D, true),
    feedbackZeroed: await tail(noFeedback, true),
    fallbackCells: await tail(D, false),
  };
}

const post = (body: unknown): Promise<Response> =>
  fetch('/result', { method: 'POST', body: JSON.stringify(body) });

async function run(): Promise<void> {
  await post({ kind: 'check', tailRms: await check() });
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
