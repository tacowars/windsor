/** The bench page, bundled by bench.mjs and driven over the DevTools protocol. It runs the
 * real engine: `renderSong` for the offline cases (the export path, so the whole graph the
 * console plays through), `FmEngine` + `AudioSystem` + the app's 25 ms pump for the live
 * cases, and a few node-only micro cases on an `OfflineAudioContext`.
 */
/* global window, performance, setInterval, clearInterval, structuredClone, AudioContext, OfflineAudioContext, AudioWorkletNode, ConstantSourceNode, GainNode, Blob, URL */
import {
  AudioSystem,
  FmEngine,
  makeArrangement,
  renderSong,
  songTicks,
} from '../../../packages/engine/src/index.ts';
import { createLowCutStage } from '../../../packages/engine/src/mixer/lowCutStage.ts';
import { createTap } from '../../../packages/engine/src/mixer/stripTap.ts';
import { HOST_PUMP_INTERVAL_MS } from '../../../packages/app/src/hostConstants.ts';
import { OFFLINE_CASES, KINDS, song } from './songs.mjs';
import { DocumentModel } from '../../../packages/app/src/documentModel.ts';

const RATE = 48000;
const MICRO_SECONDS = 20;

function made(raw) {
  const result = makeArrangement(raw);
  if (!result.usable) throw Error(`song refused: ${result.corrections.join('; ')}`);
  return result.document;
}

const caseByName = (name) => {
  const found = OFFLINE_CASES.find((c) => c.name === name);
  if (!found) throw Error(`no case ${name}`);
  return found.document;
};

/**
 * The time `OfflineAudioContext.startRendering()` took on the last call: the render phase
 * alone, without the two system builds `renderSong` makes first (`captureOpening`, then the
 * real one). The scheduler's stops and `setTimeout(0)` yields inside the render stay in it.
 */
let renderPhaseMs = 0;
const startRendering = OfflineAudioContext.prototype.startRendering;
OfflineAudioContext.prototype.startRendering = async function () {
  const t0 = performance.now();
  const buffer = await startRendering.call(this);
  renderPhaseMs = performance.now() - t0;
  return buffer;
};

/** Render one case offline at 48 kHz and time it: the whole `renderSong`, and its render phase. */
async function offline(name, document = caseByName(name)) {
  const doc = made(document);
  const t0 = performance.now();
  const rendered = await renderSong(doc, { sampleRate: RATE, tailSeconds: 1 });
  const ms = performance.now() - t0;
  const renderMs = renderPhaseMs;
  const frames = rendered.channels[0].length;
  let peak = 0;
  const left = rendered.channels[0];
  for (let i = 0; i < left.length; i += 7) peak = Math.max(peak, Math.abs(left[i]));
  return {
    name,
    renderMs: ms,
    audioSeconds: frames / RATE,
    msPerAudioSecond: ms / (frames / RATE),
    renderPhaseMs: renderMs,
    renderPhaseMsPerAudioSecond: renderMs / (frames / RATE),
    setupMs: ms - renderMs,
    peak,
    parts: doc.parts.length,
    sampleRate: RATE,
  };
}

/** 16 parts, each with one insert of `kind`, playing (or silent): that kind's cost × 16. */
async function kind(kindName, silent) {
  const built = song(`kind-${kindName}${silent ? '-silent' : ''}`, {
    parts: 16,
    bars: 4,
    silent,
  });
  // `none` is the baseline: the same 4-bar song with no insert.
  if (kindName !== 'none')
    for (const part of built.document.parts) part.strip.inserts = [{ kind: kindName }];
  return offline(built.name, built.document);
}

/* ------------------------------ live playback ------------------------------ */

let live = null;

async function startLive(name) {
  if (live) await stopLive();
  const raw = caseByName(name);
  const loop = { start: 0, end: songTicks(raw.transport.bars), on: true };
  const doc = made({ ...raw, transport: { ...raw.transport, loop } });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const engine = new FmEngine(ctx);
  await engine.init();
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(doc);
  // As the app runs: the part meter bank lit on every tab, the load meter on by default.
  system.partMeters.setActive(true);
  await engine.unlock();
  system.startMusic();
  const pump = setInterval(() => system.update(0), HOST_PUMP_INTERVAL_MS);
  live = { ctx, engine, system, pump, wall0: performance.now(), audio0: ctx.currentTime };
  return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, state: ctx.state };
}

function liveCounters() {
  const { ctx, system, wall0, audio0 } = live;
  const load = system.readout().load;
  return {
    wallMs: performance.now() - wall0,
    audioSeconds: ctx.currentTime - audio0,
    sampleRate: ctx.sampleRate,
    state: ctx.state,
    load,
  };
}

async function stopLive() {
  if (!live) return;
  clearInterval(live.pump);
  live.system.stopMusic();
  live.system.dispose();
  await live.ctx.close();
  live = null;
}

/* ------------------------------ micro cases ------------------------------ */

const PARAM_PROCESSOR = (name, count) => `
class P extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return Array.from({ length: ${count} }, (_, i) => ({ name: 'p' + i, defaultValue: 0, automationRate: 'k-rate' }));
  }
  process(inputs, outputs, params) { const o = outputs[0]; for (const c of o) c.fill(0); return true; }
}
registerProcessor('${name}', P);`;

async function timeOffline(build) {
  const ctx = new OfflineAudioContext(2, RATE * MICRO_SECONDS, RATE);
  await build(ctx);
  const t0 = performance.now();
  await ctx.startRendering();
  return (performance.now() - t0) / MICRO_SECONDS;
}

const paramModule = (name, count) =>
  URL.createObjectURL(new Blob([PARAM_PROCESSOR(name, count)], { type: 'text/javascript' }));

/** Node-only costs, each as ms of render-thread time per second of audio. */
async function micro(n = 16) {
  const out = { n, sampleRate: RATE };
  // An empty context: the floor.
  out.empty = await timeOffline(async () => {});
  // The shipped FM part, idle (no notes), n of them.
  out.fmIdle = await timeOffline(async (ctx) => {
    const engine = new FmEngine(ctx);
    await engine.init();
    for (let i = 0; i < n; i++) engine.createPart(`p${i}`);
  });
  // A bare worklet with 3 and with 11 k-rate params, n of each: the per-param tax.
  for (const count of [0, 3, 11, 27]) {
    out[`worklet${count}p`] = await timeOffline(async (ctx) => {
      await ctx.audioWorklet.addModule(paramModule(`p${count}`, count));
      for (let i = 0; i < n; i++) {
        const node = new AudioWorkletNode(ctx, `p${count}`, { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(ctx.destination);
      }
    });
  }
  // The strip's native chain as shipped (low cut, head, gate, splitter, 4 gains, merger, 2 sends), n strips, each fed by a constant source.
  const returns = (ctx) => ({ a: { input: ctx.createGain() }, b: { input: ctx.createGain() } });
  out.stripChain = await timeOffline(async (ctx) => {
    const r = returns(ctx);
    const strip = { level: 1, pan: 0.3, lowCut: 20, sends: { a: 0.3, b: 0.2 }, inserts: [] };
    for (let i = 0; i < n; i++) {
      const src = new ConstantSourceNode(ctx, { offset: 0.1 });
      const lowCut = createLowCutStage(ctx, 20);
      src.connect(lowCut.input);
      createTap(ctx, strip, r, ctx.destination, lowCut.output);
      src.start();
    }
  });
  // The same signal through one gain: what a strip would cost if its pan, gate, head and
  // low cut were folded into one node (a floor for the chain's cost, not a design).
  out.oneGain = await timeOffline(async (ctx) => {
    for (let i = 0; i < n; i++) {
      const src = new ConstantSourceNode(ctx, { offset: 0.1 });
      const g = new GainNode(ctx, { gain: 0.5 });
      src.connect(g);
      g.connect(ctx.destination);
      src.start();
    }
  });
  // The rotation alone (splitter, 4 gains, merger) against a single gain.
  out.rotationOnly = await timeOffline(async (ctx) => {
    for (let i = 0; i < n; i++) {
      const src = new ConstantSourceNode(ctx, { offset: 0.1 });
      const strip = { level: 1, pan: 0.3, lowCut: 20, sends: {}, inserts: [] };
      createTap(ctx, strip, {}, ctx.destination, src);
      src.start();
    }
  });
  return out;
}

/** The main thread's cost per knob tick on a 16-part song: the document merge and renormalise
 * (`DocumentModel.merge`, every `ctx.change`), the export text (`toJson`, which `changed` reads),
 * and the engine's live apply of one patch (`AudioSystem.apply`, which posts the patch to the
 * parts playing it) on an idle offline context. Medians of 30 calls, in ms. */
async function mainThread() {
  const raw = caseByName('16-3ins');
  const model = new DocumentModel(raw);
  const patch = structuredClone(model.doc.patches['pad-drift']);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
  const time = (fn, n = 30) => {
    const out = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(i); out.push(performance.now() - t0); }
    return median(out);
  };
  const merge = time((i) => { patch.ops[0].level = 0.5 + i * 0.001; model.merge({ patches: { 'pad-drift': structuredClone(patch) } }); });
  const stripMerge = time((i) => model.merge({ parts: { 3: { strip: { level: 0.5 + i * 0.001 } } } }));
  const json = time(() => model.toJson());
  const bytes = model.toJson().length;
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  const engine = new FmEngine(ctx);
  await engine.init();
  const system = new AudioSystem(engine, { meterLoad: false });
  await system.init();
  system.initMusic(model.doc);
  const apply = time((i) => { patch.ops[0].level = 0.5 + i * 0.001; system.apply({ patches: { 'pad-drift': structuredClone(patch) } }); });
  const applyStrip = time((i) => system.apply({ parts: { 3: { strip: { level: 0.5 + i * 0.001 } } } }));
  system.dispose();
  return { mergeMs: merge, stripMergeMs: stripMerge, toJsonMs: json, documentBytes: bytes, applyPatchMs: apply, applyStripMs: applyStrip, parts: model.doc.parts.length };
}

window.bench = {
  mainThread, offline, kind, startLive, liveCounters, stopLive, micro, KINDS };
