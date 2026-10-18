/* global process, console, Buffer, URL, structuredClone */
/**
 * The Transient insert's listening renders (record `2026-10-18-transient-insert`
 * decision 5): stereo 48 kHz 16-bit WAVs and the two songs they play, written
 * outside the repository for tacowars's ear and never committed.
 *
 *   node docs/research/2026-10-18-transient-insert/listen.mjs [--out ~/Desktop/transient-listen]
 *
 * Two songs at 128 BPM, four bars, each a Roll per part so every note is
 * written out, built and normalised by the engine's own `makeArrangement`
 * (bundled here with esbuild) and saved beside the WAVs, `version` and
 * patches included, with a Transient on the master at "punch" to import:
 *
 * - `drums`: `kick` on every beat, `snare` on 2 and 4, `fm-hat-closed` on
 *   the off sixteenths and `fm-hat-open` on the off eighths, Windsor's own
 *   drum patches.
 * - `bass`: `score-dockside-bass` (mono, sustain 0.38) playing E1, G1, A1
 *   and E1 (MIDI 28, 31, 33, 28; 41.2, 49.0, 55.0 and 41.2 Hz), one note a
 *   bar, each held for most of its bar. It exposes low-frequency ripple.
 *
 * Each song's parts are rendered by the shipped FM bundle and summed, then
 * played through the shipped `transient-processor.js` (`transientBundle.mjs`)
 * under each timing row of `transientTables.ts` (`processorOptions.timing`):
 *
 * - `drums-dry.wav`, then `drums-<row>-<setting>.wav` for Attack +15, Attack
 *   −15, Sustain +24, Sustain −24, "punch" (Attack +10, Sustain −12) and
 *   "soft" (Attack −8, Sustain +12).
 * - `bass-dry.wav`, then `bass-<row>-attack-plus-15.wav` and
 *   `bass-<row>-sustain-plus-24.wav`.
 *
 * Every file of a song shares one gain, set so its loudest file peaks at
 * −1 dBFS, so the files compare level for level; the script prints it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { TIMINGS, render as throughTransient, transient } from './transientBundle.mjs';

const RATE = 48000;
const BLOCK = 128;
const BPM = 128;
const BARS = 4;
const TAIL_S = 1;
const PEAK_DB = -1;
const STRIP_LEVEL = 0.25;

const args = { out: join(homedir(), 'Desktop', 'transient-listen') };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const ENGINE = new URL('../../../packages/engine/src/', import.meta.url);

/** The engine's song normaliser, library, version and Transient defaults, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { makeArrangement } from './song/arrangementDocument';
        export { PRESETS } from './patch/presets';
        export { ARRANGEMENT_VERSION } from './audioConstants';
        export { TICKS_PER_BAR } from './sequencing/scheduler';
        export { DEFAULT_TRANSIENT } from './inserts/transientSpec';`,
      resolveDir: ENGINE.pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
    // The worklet URLs the song modules name are never fetched here; a data URL has no base for them.
    define: { 'import.meta.url': JSON.stringify(ENGINE.href) },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
  return import(url);
}

/** The steps of a bar's sixteen each part plays, and its pitch. */
const DRUMS = [
  { name: 'Kick', preset: 'kick', pitch: 36, steps: [0, 4, 8, 12], velocity: 1 },
  { name: 'Snare', preset: 'snare', pitch: 38, steps: [4, 12], velocity: 0.9 },
  { name: 'Closed hat', preset: 'fm-hat-closed', pitch: 42, steps: [1, 3, 5, 7, 9, 11, 13, 15], velocity: 0.6 },
  { name: 'Open hat', preset: 'fm-hat-open', pitch: 46, steps: [2, 6, 10, 14], velocity: 0.55 },
];
const BASS = { name: 'Bass', preset: 'score-dockside-bass', pitches: [28, 31, 33, 28], velocity: 0.9 };

/** A song of Roll parts over `parts`, each `{ name, preset, notes, loopTicks, velocity }`. */
function song(m, parts, master) {
  const raw = {
    version: m.ARRANGEMENT_VERSION,
    transport: { bpm: BPM, bars: BARS },
    harmony: { root: 4, scale: 'naturalMinor', events: [{ start: 0, duration: BARS * m.TICKS_PER_BAR, degree: 0, size: 3 }] },
    parts: parts.map((p, slot) => ({
      slot,
      name: p.name,
      preset: p.preset,
      velocity: p.velocity,
      regions: [{ start: 0, duration: BARS * m.TICKS_PER_BAR }],
      sequencer: { kind: 'roll', loopTicks: p.loopTicks, notes: p.notes },
      // Room on the master for the Transient's lift when the song is imported; the WAVs set their own gain.
      strip: { level: STRIP_LEVEL },
    })),
    patches: Object.fromEntries(parts.map((p) => [p.preset, m.PRESETS[p.preset]])),
    master: { inserts: [master] },
  };
  const made = m.makeArrangement(raw);
  for (const line of [...made.corrections, ...made.dangling]) console.log(`song: ${line}`);
  return made.document;
}

/** The shipped FM processor class, under the shims the automation listen uses. */
function fmProcessor() {
  const bundle = readFileSync(new URL('worklet/generated/fm-processor.js', ENGINE), 'utf8');
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  const scope = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${bundle}; return { setFrame: (f) => { currentFrame = f; } };`,
  )(RATE, PortShim, (_name, cls) => (Processor = cls));
  return { Processor, scope };
}

/** One part's notes rendered, stereo, `frames` long, each tick at the song's tempo. */
function renderPart(fm, part, patch, ticksPerBar, frames) {
  const { notes, loopTicks } = part.sequencer;
  const frameOfTick = (tick) => Math.round((tick * 60 * RATE) / (BPM * (ticksPerBar / 4)));
  const events = [];
  let id = 0;
  for (let loop = 0; loop * loopTicks < BARS * ticksPerBar; loop++) {
    for (const note of notes) {
      const on = frameOfTick(loop * loopTicks + note.tick);
      const vel = part.velocity * (note.velocity ?? 1);
      events.push({ type: 'noteOn', id, note: note.pitch, velocity: vel, frame: on });
      events.push({ type: 'noteOff', id, frame: frameOfTick(loop * loopTicks + note.tick + note.ticks) });
      id++;
    }
  }
  events.sort((a, b) => a.frame - b.frame);
  const voice = new fm.Processor({ processorOptions: { maxVoices: 16, patch: structuredClone(patch), seed: 0xa204 } });
  const params = { pitchBend: new Float32Array([0]), modWheel: new Float32Array([0]), gain: new Float32Array([1]) };
  const out = [new Float32Array(frames), new Float32Array(frames)];
  const block = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  let next = 0;
  for (let at = 0; at < frames; at += BLOCK) {
    fm.scope.setFrame(at);
    while (next < events.length && events[next].frame < at + BLOCK) voice.port.onmessage({ data: events[next++] });
    voice.process([], [block], params);
    out[0].set(block[0].subarray(0, Math.min(BLOCK, frames - at)), at);
    out[1].set(block[1].subarray(0, Math.min(BLOCK, frames - at)), at);
  }
  return out;
}

/** A song's parts rendered and summed. */
function mixdown(fm, document, ticksPerBar) {
  const frames = Math.ceil(((BARS * 4 * 60) / BPM + TAIL_S) * RATE / BLOCK) * BLOCK;
  const sum = [new Float32Array(frames), new Float32Array(frames)];
  for (const part of document.parts) {
    const rendered = renderPart(fm, part, document.patches[part.preset], ticksPerBar, frames);
    for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) sum[c][i] += rendered[c][i];
  }
  return sum;
}

/** Stereo 16-bit WAV of `channels` times `gain`. */
function wav([left, right], gain) {
  const data = Buffer.alloc(left.length * 4);
  const s16 = (v) => Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767);
  for (let i = 0; i < left.length; i++) {
    data.writeInt16LE(s16(left[i]), i * 4);
    data.writeInt16LE(s16(right[i]), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const peakOf = (channels) => channels.reduce((p, c) => c.reduce((q, v) => Math.max(q, Math.abs(v)), p), 0);

/** Every render of a song, written at one gain that brings its loudest to PEAK_DB. */
function save(prefix, renders) {
  const loudest = Math.max(...renders.map(([, channels]) => peakOf(channels)));
  const gain = 10 ** (PEAK_DB / 20) / loudest;
  console.log(`${prefix}: gain ${(20 * Math.log10(gain)).toFixed(1)} dB on every file`);
  for (const [name, channels] of renders) {
    const file = join(args.out, `${prefix}-${name}.wav`);
    writeFileSync(file, wav(channels, gain));
    console.log(`${file}: peak ${(20 * Math.log10(peakOf(channels) * gain)).toFixed(1)} dBFS`);
  }
}

const DRUM_SETTINGS = {
  'attack-plus-15': { attack: 15 },
  'attack-minus-15': { attack: -15 },
  'sustain-plus-24': { sustain: 24 },
  'sustain-minus-24': { sustain: -24 },
  punch: { attack: 10, sustain: -12 },
  soft: { attack: -8, sustain: 12 },
};
const BASS_SETTINGS = { 'attack-plus-15': { attack: 15 }, 'sustain-plus-24': { sustain: 24 } };

const m = await engineModules();
const fm = fmProcessor();
const T = m.TICKS_PER_BAR;
const sixteenth = T / 16;
mkdirSync(args.out, { recursive: true });
const punch = { ...m.DEFAULT_TRANSIENT, attack: 10, sustain: -12 };
const drumSong = song(
  m,
  DRUMS.map((d) => ({
    ...d,
    loopTicks: T,
    notes: d.steps.map((s) => ({ tick: s * sixteenth, ticks: sixteenth, pitch: d.pitch })),
  })),
  punch,
);
const bassSong = song(
  m,
  [
    {
      ...BASS,
      loopTicks: BARS * T,
      notes: BASS.pitches.map((pitch, bar) => ({ tick: bar * T, ticks: T - sixteenth, pitch })),
    },
  ],
  punch,
);
writeFileSync(join(args.out, 'transient-drums.song.json'), `${JSON.stringify(drumSong, null, 2)}\n`);
writeFileSync(join(args.out, 'transient-bass.song.json'), `${JSON.stringify(bassSong, null, 2)}\n`);
console.log(`songs: version ${drumSong.version}, in ${args.out}`);

for (const [prefix, document, settings] of [
  ['drums', drumSong, DRUM_SETTINGS],
  ['bass', bassSong, BASS_SETTINGS],
]) {
  const dry = mixdown(fm, document, T);
  const renders = [['dry', dry]];
  for (const [row, timing] of Object.entries(TIMINGS))
    for (const [name, spec] of Object.entries(settings))
      renders.push([`${row}-${name}`, throughTransient(transient(RATE, spec, timing), dry)]);
  save(prefix, renders);
}
