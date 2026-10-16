/** The measuring page (windsor#822 decision 6), bundled by measure.mjs and driven over the
 * DevTools protocol. One call, `measure.run(spec)`, exports a long song through the app's own
 * run into a file in the origin-private file system: today's whole-file Save as path
 * (`runAudioExport`, then `writeInChunks` into the writable, as `pickSaveSink` does for stems)
 * or the streamed one (`runStreamedExport` over `encodeWavStream`). Both get the same
 * `FileSystemWritableFileStream` a save picker's handle gives, from an OPFS handle, since a
 * headless browser cannot drive the native dialog. The file is read back, checked and removed.
 */
/* global window, navigator, performance, AbortController */
import {
  RENDER_STREAM_MAX_FRAMES,
  encodeWavAsync,
  encodeWavStream,
  renderSong,
} from '../../../packages/engine/src/index.ts';
import { FULL_DOCUMENT } from '../../../packages/engine/src/__fixtures__/fullArrangement.ts';
import { runAudioExport } from '../../../packages/app/src/audioExportModel.ts';
import { runStreamedExport } from '../../../packages/app/src/audioExportStream.ts';
import { writeInChunks } from '../../../packages/app/src/audioExportWrite.ts';

const FILE = 'windsor-822-export.wav';

/** The fixture song (kick, hat, arp line and chord pad, each live for the whole song) at a length. */
function song({ bars, bpm, meter }) {
  return { ...FULL_DOCUMENT, transport: { ...FULL_DOCUMENT.transport, bars, bpm, meter } };
}

async function opfsFile() {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(FILE).catch(() => undefined);
  return { root, handle: await root.getFileHandle(FILE, { create: true }) };
}

/** The writable as the app's sinks adapt it. */
async function writableOf(handle) {
  const writable = await handle.createWritable();
  return {
    write: (bytes) => writable.write(bytes),
    close: () => writable.close(),
    abort: () => writable.abort(),
  };
}

/** The file's RIFF chunks, its format fields and its data length, read back from disk. */
async function readBack(handle) {
  const file = await handle.getFile();
  const head = new DataView(await file.slice(0, 64).arrayBuffer());
  const text = (at) => String.fromCharCode(...new Uint8Array(head.buffer, at, 4));
  const chunks = {};
  for (let at = 12; at + 8 <= head.byteLength; ) {
    const size = head.getUint32(at + 4, true);
    chunks[text(at)] = { at: at + 8, size };
    if (text(at) === 'data') break;
    at += 8 + size;
  }
  const fmt = chunks['fmt '].at;
  return {
    bytes: file.size,
    riff: text(0),
    riffSize: head.getUint32(4, true),
    format: head.getUint16(fmt, true),
    channels: head.getUint16(fmt + 2, true),
    rate: head.getUint32(fmt + 4, true),
    bits: head.getUint16(fmt + 14, true),
    fact: chunks.fact ? head.getUint32(chunks.fact.at, true) : null,
    dataAt: chunks.data.at,
    dataBytes: chunks.data.size,
  };
}

async function run(spec) {
  const { root, handle } = await opfsFile();
  const settings = {
    sampleRate: 48000,
    bitDepth: spec.bitDepth,
    tailSeconds: spec.tailSeconds,
    stems: false,
    includeMuted: false,
  };
  let renderMs = 0;
  let frames = 0;
  // Today's path refuses past RENDER_MAX_FRAMES; the measurement lifts that cap on both paths
  // so the whole-file path is measured at the lengths it refuses.
  const render = async (document, options) => {
    const t0 = performance.now();
    const rendered = await renderSong(document, options, RENDER_STREAM_MAX_FRAMES);
    renderMs = performance.now() - t0;
    frames = rendered.channels[0].length;
    return rendered;
  };
  const common = {
    document: song(spec.song),
    settings,
    fileName: FILE,
    signal: new AbortController().signal,
    onProgress: () => {},
    render,
  };
  const t0 = performance.now();
  const outcome =
    spec.path === 'stream'
      ? await runStreamedExport({
          ...common,
          sink: { where: 'opfs', stream: () => writableOf(handle), discard: async () => {} },
          encodeStream: encodeWavStream,
        })
      : await runAudioExport({
          ...common,
          sink: {
            where: 'opfs',
            write: async (file, signal) => writeInChunks(await writableOf(handle), file, signal),
            discard: async () => {},
          },
          encode: encodeWavAsync,
        });
  const totalMs = performance.now() - t0;
  const file = outcome.kind === 'saved' ? await readBack(handle) : null;
  await root.removeEntry(FILE).catch(() => undefined);
  return { outcome, frames, renderMs, writeMs: totalMs - renderMs, totalMs, file };
}

window.measure = { run };
