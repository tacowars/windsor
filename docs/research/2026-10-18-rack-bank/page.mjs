/* global window, AbortController */
/**
 * The rack bank's page (windsor#878), bundled by `browser.mjs` and driven
 * over the DevTools protocol. Every rack is played as the console plays it:
 * the listen song opened in the app's `DocumentModel`, the rack added as a
 * new part by the app's own `addPartFromRackChange` (record
 * `2026-10-17-racks` decision 12), an external key re-picked as the user
 * would after the load (decision 3: the listen song's muted kick, slot 0),
 * and the part's velocity set to 1. The listen is the console's own audio
 * export, `runAudioExport` over the engine's `renderSong` and
 * `encodeWavAsync` at the export's defaults: 48 kHz, 24-bit, a 2 s tail.
 */
import { encodeWavAsync, partAt, renderSong } from '../../../packages/engine/src/index.ts';
import { RACK_BANK } from '../../../packages/engine/src/rack/rackBank.ts';
import { renderBounceRegion } from '../../../packages/engine/src/song/bounceRender.ts';
import { loadBuiltIns } from '../../../packages/app/src/builtInLibrary.ts';
import { defaultExportSettings, runAudioExport } from '../../../packages/app/src/audioExportModel.ts';
import SONG from './listen-song.json';
import { economy } from './pageEconomy.mjs';
import { withRack } from './rackPart.mjs';

const TICKS_PER_BAR = 96;
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const OCTAVE_OFFSET = 1;
const SEMITONES = 12;

const noteName = (pitch) =>
  `${NOTE_NAMES[pitch % SEMITONES]}${Math.floor(pitch / SEMITONES) - OCTAVE_OFFSET}`;

/** The pitches the part plays in each bar, through the player's own wiring (`renderBounceRegion`). */
function pitchesPerBar(doc, slot) {
  const { notes } = renderBounceRegion(doc, doc.patches, slot, 0);
  const bars = Array.from({ length: doc.transport.bars }, () => []);
  for (const note of notes) bars[Math.floor(note.tick / TICKS_PER_BAR)]?.push(note);
  return bars.map((list) => list.map((note) => noteName(note.pitch) + (note.accent ? '!' : '')));
}

/** Peak and RMS in dBFS over both channels. */
function levels(channels) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
    }
    count += channel.length;
  }
  const db = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / count)) };
}

/** The bytes as base64, in slices so a long file does not overflow the argument list. */
async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const SLICE = 0x8000;
  let text = '';
  for (let at = 0; at < bytes.length; at += SLICE)
    text += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  return window.btoa(text);
}

/** Rack `id` through the console's export: the WAV, its levels and the pitches per bar. */
async function listen(id) {
  await loadBuiltIns();
  const { doc, slot } = withRack(SONG, id);
  let channels = [];
  let written = null;
  const settings = defaultExportSettings();
  const outcome = await runAudioExport({
    document: doc,
    settings,
    fileName: `${id}.wav`,
    signal: new AbortController().signal,
    onProgress: () => {},
    render: async (document, options, maxFrames) => {
      const rendered = await renderSong(document, options, maxFrames);
      channels = rendered.channels;
      return rendered;
    },
    encode: encodeWavAsync,
    sink: { where: 'the page', write: async (file) => void (written = file), discard: async () => {} },
  });
  if (outcome.kind !== 'saved') throw Error(`${id}: ${JSON.stringify(outcome)}`);
  return {
    id,
    wav: await base64(written),
    sampleRate: settings.sampleRate,
    bitDepth: settings.bitDepth,
    channels: channels.length,
    seconds: channels[0].length / settings.sampleRate,
    clipped: outcome.clipped,
    ...levels(channels),
    pitches: pitchesPerBar(doc, slot),
    chain: partAt(doc, slot).strip.inserts.map((spec) => spec.kind),
  };
}

window.rackBank = { ids: () => Object.keys(RACK_BANK), listen, ...economy(SONG) };
