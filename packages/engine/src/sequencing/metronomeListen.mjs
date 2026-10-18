/* global process, console, Buffer, URL */
/**
 * The metronome's listening renders (windsor#906 decision 7): the metronome
 * alone, offline, through the engine, written outside the repository as
 * stereo 48 kHz 16-bit WAVs for tacowars's ear and never committed.
 *
 *   node packages/engine/src/sequencing/metronomeListen.mjs [--out /tmp/windsor-906-metronome]
 *
 * Each file is four bars of the engine's own `Metronome` on a `TickTransport`
 * at the song's tempo and meter, its clicks played on the shipped
 * `metronome-click` patch by the shipped FM bundle (`fm-processor.js`) with
 * the part's voice count. The part's output is written as it is: live, the
 * aux strip and fader are at unity and the engine's output stage follows.
 *
 * - `metronome-4-4-125bpm.wav`: 4/4 at 125 BPM, four clicks a bar.
 * - `metronome-7-8-125bpm.wav`: 7/8 at 125 BPM, three a bar (2+2+3).
 * - `metronome-6-8-110bpm.wav`: 6/8 at 110 BPM, two a bar.
 *
 * It prints each file's clicks (bar.beat, MIDI note, velocity) and the
 * measured envelope of one accent: time to peak, the −20 dB point, and
 * where it falls under −60 dB.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const ENGINE = new URL('../', import.meta.url);
const BARS = 4;
const TAIL_S = 0.5;
const BLOCK = 128;
const RENDERS = [
  { file: 'metronome-4-4-125bpm.wav', meter: '4/4', bpm: 125 },
  { file: 'metronome-7-8-125bpm.wav', meter: '7/8', bpm: 125 },
  { file: 'metronome-6-8-110bpm.wav', meter: '6/8', bpm: 110 },
];

const args = { out: '/tmp/windsor-906-metronome' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

/** The metronome, its tables, the transport, the library, the FM harness and the WAV writer, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { Metronome } from './sequencing/metronome';
        export { METRONOME_TABLE } from './sequencing/metronomeTables';
        export { TickTransport } from './sequencing/scheduler';
        export { ticksPerBar } from './sequencing/meter';
        export { PRESETS } from './patch/presets';
        export { loadProcessor, render } from './__fixtures__/workletHarness';
        export { encodeWav } from './render/wavEncoder';`,
      resolveDir: ENGINE.pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
    // The harness reads the bundle beside its own folder; a data URL has no base for it.
    define: { 'import.meta.url': JSON.stringify(new URL('__fixtures__/harness.ts', ENGINE).href) },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
  return import(url);
}

/** Four bars of clicks at `bpm` in `meter`: the note events the part is posted, and what each click was. */
function clicks(m, { meter, bpm }, sampleRate) {
  const transport = new m.TickTransport(bpm);
  transport.meter = meter;
  const bar = m.ticksPerBar(meter);
  const events = [];
  const heard = [];
  let tick = 0;
  transport.subscribe(1, (event) => {
    tick = event.tick;
  });
  const voice = {
    trigger(note, velocity, duration, time) {
      const id = events.length + 1;
      const frame = Math.round(time * sampleRate);
      events.push({ type: 'noteOn', id, note, velocity, frame });
      events.push({ type: 'noteOff', id, frame: Math.round((time + duration) * sampleRate) });
      heard.push({ bar: Math.floor(tick / bar) + 1, tickInBar: tick % bar, note, velocity, frame });
      return id;
    },
    allNotesOff() {},
  };
  new m.Metronome(transport, voice).setOn(true);
  for (let i = 0; i < BARS * bar; i++) transport.advance(transport.transportSeconds);
  events.sort((a, b) => a.frame - b.frame);
  return { events, heard, seconds: transport.transportSeconds };
}

/** The left channel's envelope around the click at `frame`: peak, −20 dB and −60 dB times, in ms. */
function measure(left, frame, sampleRate) {
  const end = Math.min(left.length, frame + Math.round(0.1 * sampleRate));
  let peak = 0;
  let peakAt = frame;
  for (let i = frame; i < end; i++) {
    if (Math.abs(left[i]) > peak) [peak, peakAt] = [Math.abs(left[i]), i];
  }
  const lastAbove = (ratio) => {
    let last = frame;
    for (let i = frame; i < end; i++) if (Math.abs(left[i]) >= peak * ratio) last = i;
    return (((last - frame) / sampleRate) * 1000).toFixed(1);
  };
  return {
    peak: peak.toFixed(3),
    peakMs: (((peakAt - frame) / sampleRate) * 1000).toFixed(2),
    minus20Ms: lastAbove(0.1),
    minus60Ms: lastAbove(0.001),
  };
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (note) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

const m = await engineModules();
const dsp = m.loadProcessor();
const patch = m.PRESETS['metronome-click'];
mkdirSync(args.out, { recursive: true });
for (const spec of RENDERS) {
  const { events, heard, seconds } = clicks(m, spec, dsp.sampleRate);
  const blocks = Math.ceil(((seconds + TAIL_S) * dsp.sampleRate) / BLOCK);
  const processor = dsp.create(patch, m.METRONOME_TABLE.voices);
  const { samples, nonFinite } = m.render(dsp, processor, blocks, events);
  const frames = samples.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) [left[i], right[i]] = [samples[2 * i], samples[2 * i + 1]];
  const wav = m.encodeWav([left, right], dsp.sampleRate, 16);
  writeFileSync(join(args.out, spec.file), wav.bytes);
  const accent = heard.find((c) => c.tickInBar === 0 && c.bar === 2);
  const beat = heard.find((c) => c.tickInBar !== 0 && c.bar === 2);
  console.log(`${spec.file}: ${spec.meter} at ${spec.bpm} BPM, ${heard.length} clicks`);
  console.log(`  clipped ${wav.clipped}, non-finite ${nonFinite}`);
  const bar = heard.filter((c) => c.bar === 1);
  console.log(
    `  each bar: ${bar.map((c) => `tick ${c.tickInBar} ${noteName(c.note)} (MIDI ${c.note}) vel ${c.velocity.toFixed(3)}`).join(', ')}`,
  );
  console.log(`  accent, bar 2:`, measure(left, accent.frame, dsp.sampleRate));
  console.log(`  beat, bar 2:`, measure(left, beat.frame, dsp.sampleRate));
}
console.log(`wrote ${RENDERS.length} files to ${args.out}`);
