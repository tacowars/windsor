/* global OfflineAudioContext, performance */
/**
 * What a roll's clip envelopes (windsor#702) cost the main thread per tick,
 * in the browser. Research only.
 *
 * Served by the app's dev server and imported in a page
 * (`/@fs/<checkout>/docs/research/2026-10-11-roll-envelope-cost/bench.mjs`),
 * so the engine's TypeScript comes through Vite. `runBench(mode)` builds
 * eight real `AudioPart`s (the FM worklet, `FmEngine`) on an
 * `OfflineAudioContext`, the real `AutomationPlayer` on a `TickTransport`
 * over them through the live resolver, and plays a 16-bar song at 120 BPM:
 * the context renders in 0.5 s steps (`suspend`), and at each stop the
 * ticks up to the next stop plus the scheduler's look-ahead are issued, as
 * `render/renderPass.ts` does, so the audio thread consumes the scheduled
 * events as live playback would. Only the ticks' fan-out is timed
 * (`performance.now()` around each batch: the page's clock reads in 0.1 ms
 * steps, so batches of 24 ticks, summed).
 *
 * Every part plays four regions of four bars, each its own roll with a
 * one-bar loop. The modes:
 *
 * - `none`: no envelopes (each part's source is null);
 * - `envelopes`: four envelopes on every roll (Cutoff, Resonance, LFO 1
 *   amount, operator B's level), eight bent points each;
 * - `lanes`: no envelopes, a song lane on each of the same four targets;
 * - `summed`: both, so every envelope sums with a lane in its slot.
 */
import { partOwner } from '../../../packages/engine/src/automation/automationOwner';
import { AutomationPlayer } from '../../../packages/engine/src/automation/automationPlayer';
import { clipEnvelopeSource } from '../../../packages/engine/src/automation/clipEnvelopeSource';
import { TickTransport } from '../../../packages/engine/src/sequencing/scheduler';
import { FmEngine } from '../../../packages/engine/src/synth/fmEngine';
import { automationResolver } from '../../../packages/engine/src/system/automationResolver';

const PARTS = 8;
const BPM = 120;
const BAR = 96;
const BARS = 16;
const SONG = BARS * BAR;
const REGION = 4 * BAR;
const STEP = 0.5;
const LOOK_AHEAD = 0.12;
const SAMPLE_RATE = 48000;
const TARGETS = ['filter.cutoff', 'filter.resonance', 'lfo.amount', 'ops.1.level'];
const LANE_RANGES = {
  'filter.cutoff': [300, 4000],
  'filter.resonance': [0.7, 6],
  'lfo.amount': [0, 0.8],
  'ops.1.level': [0.2, 0.9],
};

const bentPoints = (seed) =>
  Array.from({ length: 8 }, (_, i) => ({
    tick: i * 12,
    value: Math.sin(seed + i) * 0.9,
    bend: i % 2 ? 0.4 : -0.3,
  }));

function rollPart(withEnvelopes) {
  const regions = Array.from({ length: BARS / 4 }, (_, r) => ({
    start: r * REGION,
    duration: REGION,
    pattern: {
      kind: 'roll',
      loopTicks: BAR,
      notes: [{ tick: 0, ticks: BAR, pitch: 48 + r }],
      envelopes: withEnvelopes
        ? TARGETS.map((target, t) => ({ target, on: true, points: bentPoints(r * 4 + t) }))
        : [],
    },
  }));
  return { regions, sequencer: regions[0].pattern };
}

const songLanes = () =>
  TARGETS.map((path) => ({
    target: `voice.${path}`,
    on: true,
    points: [
      { tick: 0, value: LANE_RANGES[path][0], bend: 0.3 },
      { tick: SONG, value: LANE_RANGES[path][1], bend: 0 },
    ],
  }));

/** One play of the song in `mode`: the ticks issued and the ms they took. */
export async function runBench(mode) {
  const envelopes = mode === 'envelopes' || mode === 'summed';
  const lanes = mode === 'lanes' || mode === 'summed';
  const seconds = (SONG * 60) / BPM / 24 + 1;
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const engine = new FmEngine(context);
  await engine.init({});
  const strips = Array.from({ length: PARTS }, (_, slot) => ({
    part: engine.createPart(`bench${slot}`),
  }));
  const transport = new TickTransport(BPM);
  const player = new AutomationPlayer({
    transport,
    now: () => context.currentTime,
    resolve: automationResolver((slot) => strips[slot]),
    songTicks: SONG,
    restTick: 0,
    defer: (run) => run(),
  });
  for (let slot = 0; slot < PARTS; slot++) {
    player.setLanes(partOwner(slot), lanes ? songLanes() : []);
    player.setEnvelopes(partOwner(slot), clipEnvelopeSource(rollPart(envelopes), SONG));
  }
  let ms = 0;
  let ticks = 0;
  const pump = () => {
    const until = context.currentTime + STEP + LOOK_AHEAD;
    const start = performance.now();
    while (ticks < SONG && transport.transportSeconds < until) {
      transport.advance(transport.transportSeconds);
      ticks++;
    }
    ms += performance.now() - start;
  };
  pump();
  for (let t = STEP; t < seconds - STEP; t += STEP) {
    context.suspend(t).then(() => {
      pump();
      context.resume();
    });
  }
  await context.startRendering();
  player.dispose();
  return { mode, ticks, ms, usPerTick: (ms * 1000) / ticks };
}
