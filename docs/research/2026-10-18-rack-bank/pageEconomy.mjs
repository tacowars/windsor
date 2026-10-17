/* global performance, setInterval, clearInterval, setTimeout, structuredClone, AudioContext */
/**
 * The rack bank's economy (windsor#878 decision 4), in the page: each rack
 * added to a drum-heavy and a pad-heavy song, with its chain and with its
 * chain emptied after the load, so the difference is the chain alone.
 *
 * - `live` plays the song as the console does (`FmEngine`, `AudioSystem`,
 *   the part meter bank lit, the app's 25 ms pump, the song looping) and
 *   reads the engine's own load report, `AudioSystem.readout().load`, the
 *   number the console's CPU meter shows (`cost/audioLoad.ts`).
 * - `offline` times the engine's `renderSong`, the export path, whose cost
 *   includes the native-node inserts the load report cannot see.
 */
import { AudioSystem, FmEngine, renderSong, songTicks } from '../../../packages/engine/src/index.ts';
import { PRESETS } from '../../../packages/engine/src/patch/presets.ts';
import { HOST_PUMP_INTERVAL_MS } from '../../../packages/app/src/hostConstants.ts';
import { loadBuiltIns } from '../../../packages/app/src/builtInLibrary.ts';
import { withRack } from './rackPart.mjs';

const RATE = 48000;
const BAR = 96;
const LEVEL = 0.5;
const WARM_MS = 3000;
const SAMPLE_MS = 250;

/** A 16-step Euclid row from `x` and `.`, on the fitted pitch. */
const euclid = (pattern) => ({
  kind: 'euclidean',
  seed: 0,
  note: 60,
  hold: 0.1,
  steps: 16,
  divisor: 6,
  pulses: { min: 3, max: 9, start: 5 },
  rotate: 0,
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  pattern: [...pattern].map((c) => c === 'x'),
});

/** A Chord Player holding the chord for four bars at `octave`, following the changes. */
const held = (octave) => ({
  kind: 'chord',
  divisor: BAR,
  gate: 1,
  voicing: 'close',
  register: { octave },
  steps: [{ kind: 'hit', inversion: 0, octave: 0, duration: 4, repeat: 1 }],
  follow: true,
});

/** The background parts: seven drum lines, or four held pads; no inserts, each its own patch. */
const BACKGROUNDS = {
  drums: [
    ['tr909-kick', euclid('x...x...x...x...')],
    ['tr909-hat-closed', euclid('xxxxxxxxxxxxxxxx')],
    ['tr909-hat-open', euclid('..x...x...x...x.')],
    ['tr909-clap', euclid('....x.......x...')],
    ['tr909-snare', euclid('......x..x....x.')],
    ['tr909-ride', euclid('x.x.x.x.x.x.x.x.')],
    ['tr909-rimshot', euclid('...x..x....x..x.')],
  ],
  pads: [
    ['pad-drift', held(3)],
    ['pad-drift', held(4)],
    ['str-ob-strings', held(3)],
    ['str-solina-ensemble', held(4)],
  ],
};

/** The listen song with `kind`'s background on slots 1 and up, looping. */
function background(song, kind) {
  const parts = BACKGROUNDS[kind].map(([, sequencer], i) => ({
    slot: i + 1,
    name: `${kind} ${i + 1}`,
    preset: `bg-${i + 1}`,
    velocity: 1,
    regions: [{ start: 0, duration: songTicks(song.transport.bars) }],
    sequencer,
    strip: { level: LEVEL, pan: 0, lowCut: 20, sends: {}, inserts: [] },
  }));
  const patches = Object.fromEntries(
    BACKGROUNDS[kind].map(([preset], i) => [`bg-${i + 1}`, structuredClone(PRESETS[preset])]),
  );
  const loop = { start: 0, end: songTicks(song.transport.bars), on: true };
  return {
    ...song,
    transport: { ...song.transport, loop },
    parts: [...song.parts, ...parts],
    patches: { ...song.patches, ...patches },
  };
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The case's song: the background with the rack, its chain or none. */
async function caseSong(song, { background: kind, rack, bare }) {
  await loadBuiltIns();
  return withRack(background(song, kind), rack, bare).doc;
}

/** Plays the case live for `seconds` after a warm-up and reads the engine's load report. */
async function live(song, spec, seconds) {
  const doc = await caseSong(song, spec);
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const engine = new FmEngine(ctx);
  await engine.init();
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(doc);
  system.partMeters.setActive(true);
  await engine.unlock();
  system.startMusic();
  const pump = setInterval(() => system.update(0), HOST_PUMP_INTERVAL_MS);
  await wait(WARM_MS);
  const samples = [];
  const audio0 = ctx.currentTime;
  const wall0 = performance.now();
  while (performance.now() - wall0 < seconds * 1000) {
    await wait(SAMPLE_MS);
    samples.push(system.readout().load);
  }
  const clockRate = (ctx.currentTime - audio0) / ((performance.now() - wall0) / 1000);
  const { sampleRate } = ctx;
  clearInterval(pump);
  system.stopMusic();
  system.dispose();
  await ctx.close();
  const loads = samples.map((load) => load.loadPct);
  return {
    loadPct: median(loads),
    processors: median(samples.map((load) => load.processors)),
    underruns: samples.at(-1).underruns,
    clockRate,
    sampleRate,
  };
}

/** Renders the case offline at 48 kHz and times the whole `renderSong`. */
async function offline(song, spec) {
  const doc = await caseSong(song, spec);
  const t0 = performance.now();
  const rendered = await renderSong(doc, { sampleRate: RATE, tailSeconds: 1 });
  const ms = performance.now() - t0;
  return { msPerAudioSecond: ms / (rendered.channels[0].length / RATE) };
}

export const economy = (song) => ({
  live: (spec, seconds) => live(song, spec, seconds),
  offline: (spec) => offline(song, spec),
});
