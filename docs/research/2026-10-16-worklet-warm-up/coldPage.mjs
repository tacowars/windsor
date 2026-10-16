/** The cold-start page (windsor#837), bundled by coldStart.mjs and driven over the DevTools
 * protocol. It builds the system the way the console's power button does (a fresh realtime
 * `AudioContext`, `FmEngine.init`, `AudioSystem.init`, `initMusic`, the part meter bank lit,
 * the load meter on, the 25 ms pump), then plays from the top twice, and samples both underrun
 * counts every `SAMPLE_MS` the whole time: the device's (`playbackStats.underrunEvents`, what
 * the power button's title calls device underruns) and the processors' load sampler's (the
 * title's underruns).
 */
/* global window, performance, setInterval, clearInterval, AudioContext */
import { AudioSystem, FmEngine, makeArrangement, songTicks } from '../../../packages/engine/src/index.ts';
import { HOST_PUMP_INTERVAL_MS } from '../../../packages/app/src/hostConstants.ts';
import { CASES } from './coldSongs.mjs';

const SAMPLE_MS = 25;

let live = null;

function made(raw) {
  const loop = { start: 0, end: songTicks(raw.transport.bars), on: true };
  const result = makeArrangement({ ...raw, transport: { ...raw.transport, loop } });
  if (!result.usable) throw Error(`song refused: ${result.corrections.join('; ')}`);
  return result.document;
}

function sample() {
  const { ctx, system, timeline } = live;
  const stats = ctx.playbackStats;
  const load = system ? system.readout().load : null;
  timeline.push({
    t: performance.now(),
    device: stats ? stats.underrunEvents : null,
    deviceMs: stats ? stats.underrunDuration * 1000 : null,
    dsp: load ? load.underruns : null,
    audio: ctx.currentTime,
  });
}

function mark(name) {
  live.marks.push({ name, t: performance.now() });
}

/** The power button: a fresh context and the whole system for `name`'s song. */
async function build(name, rate) {
  const doc = made(CASES[name].document);
  const ctx = new AudioContext({ latencyHint: 'interactive', ...(rate ? { sampleRate: rate } : {}) });
  live = { ctx, system: null, timeline: [], marks: [], sampler: null, pump: null };
  live.sampler = setInterval(sample, SAMPLE_MS);
  mark('build');
  const engine = new FmEngine(ctx);
  await engine.init();
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(doc);
  system.partMeters.setActive(true);
  await engine.unlock();
  live.system = system;
  live.pump = setInterval(() => system.update(0), HOST_PUMP_INTERVAL_MS);
  mark('built');
  return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, state: ctx.state };
}

/** ▶ from the top. */
function play() {
  mark('play');
  live.system.startMusic();
}

/** ■. */
function stop() {
  mark('stop');
  live.system.stopMusic();
}

async function finish() {
  clearInterval(live.sampler);
  clearInterval(live.pump);
  sample();
  const out = { timeline: live.timeline, marks: live.marks };
  live.system.stopMusic();
  live.system.dispose();
  await live.ctx.close();
  live = null;
  return out;
}

window.cold = { build, play, stop, finish };
