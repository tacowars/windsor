/**
 * Export Audio's rules (windsor#40), pure so they are tested without a DOM:
 * the file name, the destinations this browser offers, the one export run —
 * render, encode, write — with its cancel, and the notice that says where the
 * file went.
 *
 * A cancel during the write counts until the sink's commit point: the sink
 * gets the signal and aborts its write, so the destination keeps what it had
 * and the run reports `cancelled`, never `saved`. Past that point (a Save as
 * whose `close()` is called, windsor#51 decision 2) a Cancel changes nothing:
 * the run reports what the write did, `saved` or its own error.
 *
 * A render cancelled or failed writes nothing: the sink is written only once
 * the whole file is encoded, and a sink opened ahead of the render (the save
 * picker must open inside the click's user activation, long before the render
 * ends) is told to discard instead. Discarding releases what the sink holds
 * and never deletes a file: a picked file may be one the user already had.
 *
 * That is the in-memory run: Download, and stems on either destination. A
 * Save as of the mix streams instead (`audioExportStream.ts`, windsor#822),
 * and its rule is that nothing reaches the picked file until the writable
 * closes.
 */
import type {
  ArrangementDocument,
  EncodedWav,
  RenderSampleRate,
  RenderSongOptions,
  RenderedSong,
  WavBitDepth,
} from '@windsor/engine';
import {
  RENDER_SAMPLE_RATE_DEFAULT,
  RENDER_TAIL_SECONDS,
  WAV_BIT_DEPTH_DEFAULT,
  WAV_FLOAT_BIT_DEPTH,
} from '@windsor/engine';
import {
  FILE_NAME_FORBIDDEN,
  WAV_EXTENSION,
  WAV_FALLBACK_NAME,
  WAV_MIME,
} from './audioExportConstants';
import type { ToastTone } from './toastModel';

export interface AudioExportSettings {
  sampleRate: RenderSampleRate;
  bitDepth: WavBitDepth;
  tailSeconds: number;
  /** One WAV per part and return beside the master, as one zip (windsor#41). */
  stems: boolean;
  /** Stems only: export the parts routed "Sidechain only" too (windsor#41 decision 4). */
  includeMuted: boolean;
}

/** What a fresh page offers: the engine's defaults, the mix alone. */
export const defaultExportSettings = (): AudioExportSettings => ({
  sampleRate: RENDER_SAMPLE_RATE_DEFAULT,
  bitDepth: WAV_BIT_DEPTH_DEFAULT,
  tailSeconds: RENDER_TAIL_SECONDS.default,
  stems: false,
  includeMuted: false,
});

export type ExportDestination = 'download' | 'saveAs';

/** Download always; Save as… only where the File System Access save picker exists (decision 2). */
export function exportDestinations(hasSavePicker: boolean): ExportDestination[] {
  return hasSavePicker ? ['download', 'saveAs'] : ['download'];
}

/** The song's name for its files: the Export field's, less its `.json`, safe on any file system. */
export function songFileStem(exportName: string): string {
  const stem = exportName
    .trim()
    .replace(/\.json$/i, '')
    .replace(FILE_NAME_FORBIDDEN, '-')
    .trim();
  return stem || WAV_FALLBACK_NAME;
}

/** `<song name>.wav`. */
export const wavFileName = (exportName: string): string =>
  `${songFileStem(exportName)}${WAV_EXTENSION}`;

/** Where a finished file — a WAV, or the stems' zip — goes: written once, or discarded. */
export interface WavSink {
  /** How the notice names the destination ("your downloads", "the file you chose"). */
  readonly where: string;
  /**
   * Write the whole file, or reject with an `AbortError` and leave the
   * destination as it was once `signal` fires before the commit point.
   * Resolves only once written; past the commit point `signal` is ignored.
   */
  write(file: Blob, signal: AbortSignal): Promise<void>;
  /** The run will not write; release anything held. Never deletes a file the user picked. */
  discard(): Promise<void>;
  /**
   * Open the destination for a streamed write (windsor#822), where it can
   * take one: the picked file's writable. Absent on a download.
   */
  stream?: () => Promise<StreamWritable>;
}

/**
 * What a streamed export needs of a `FileSystemWritableFileStream`; a test
 * fakes it. The picked file keeps its old contents until `close()`, and
 * `abort()` leaves them as they were.
 */
export interface StreamWritable {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface AudioExportRun {
  document: ArrangementDocument;
  settings: AudioExportSettings;
  fileName: string;
  sink: WavSink;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  /** The engine's `renderSong`; `maxFrames` is its cap, `RENDER_MAX_FRAMES` when absent. */
  render: (
    document: ArrangementDocument,
    options: RenderSongOptions,
    maxFrames?: number,
  ) => Promise<RenderedSong>;
  /**
   * The engine's chunked encoder (`encodeWavAsync`): it yields between chunks
   * and rejects with an `AbortError` once `signal` fires, so a Cancel during
   * a long song's encode lands before the file reaches the sink (windsor#51).
   */
  encode: (
    channels: Float32Array[],
    sampleRate: number,
    bitDepth: WavBitDepth,
    options: { signal: AbortSignal },
  ) => Promise<EncodedWav>;
}

export type AudioExportOutcome =
  | { kind: 'saved'; fileName: string; where: string; clipped: number; nonFinite: number }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string };

export async function runAudioExport(run: AudioExportRun): Promise<AudioExportOutcome> {
  const { settings, signal } = run;
  return runToSink(run, async () => {
    const rendered = await run.render(run.document, {
      sampleRate: settings.sampleRate,
      tailSeconds: settings.tailSeconds,
      signal,
      onProgress: run.onProgress,
    });
    if (signal.aborted) throw new DOMException('canceled', 'AbortError');
    const { bytes, clipped, nonFinite } = await run.encode(
      rendered.channels,
      rendered.sampleRate,
      settings.bitDepth,
      { signal },
    );
    const file = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: WAV_MIME });
    return { file, clipped, nonFinite };
  });
}

/** What a run makes before it writes: the whole file, and the samples clipped or non-finite making it. */
export interface MadeFile {
  file: Blob;
  clipped: number;
  nonFinite: number;
}

/**
 * Make the file, then write it to the sink: the cancel rules every export
 * shares, the WAV's and the stems' (windsor#41). Nothing reaches the sink
 * until the file is whole; a cancel or a failure before then discards.
 */
export async function runToSink(
  run: Pick<AudioExportRun, 'sink' | 'signal' | 'fileName'>,
  make: () => Promise<MadeFile>,
): Promise<AudioExportOutcome> {
  const { sink, signal } = run;
  let writing = false;
  try {
    const { file, clipped, nonFinite } = await make();
    if (signal.aborted) throw new DOMException('canceled', 'AbortError');
    // From here the sink decides: past its commit point a Cancel changes
    // nothing, and the write resolves (saved) or fails with its own error.
    writing = true;
    await sink.write(file, signal);
    return { kind: 'saved', fileName: run.fileName, where: sink.where, clipped, nonFinite };
  } catch (error) {
    await sink.discard().catch(() => undefined);
    return failureOutcome(error, signal, writing);
  }
}

/**
 * A run that threw: `cancelled` on an `AbortError`, or on any error while
 * the signal has fired before the commit point (`committed` false);
 * otherwise `failed`, with the error's message.
 */
export function failureOutcome(
  error: unknown,
  signal: AbortSignal,
  committed: boolean,
): AudioExportOutcome {
  const abortError = error instanceof DOMException && error.name === 'AbortError';
  if (abortError || (signal.aborted && !committed)) return { kind: 'cancelled' };
  return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
}

/**
 * The toast for an outcome: where the file went, and a warning when samples
 * passed full scale, clipped in a PCM file and kept in a float one
 * (windsor#822 decision 4), or when a float file wrote non-finite samples as
 * silence.
 */
export function exportNotice(
  outcome: AudioExportOutcome,
  bitDepth: WavBitDepth,
): { message: string; tone: ToastTone } {
  switch (outcome.kind) {
    case 'cancelled':
      return { message: 'audio export canceled — nothing was written', tone: 'info' };
    case 'failed':
      return { message: `audio export failed: ${outcome.error}`, tone: 'error' };
    case 'saved':
      if (bitDepth === WAV_FLOAT_BIT_DEPTH && (outcome.clipped > 0 || outcome.nonFinite > 0)) {
        return { message: floatWarning(outcome), tone: 'warning' };
      }
      if (outcome.clipped > 0) {
        return {
          message:
            `saved ${outcome.fileName} to ${outcome.where} — ${outcome.clipped} samples ` +
            'clipped at full scale; lower the master level and export again',
          tone: 'warning',
        };
      }
      return { message: `saved ${outcome.fileName} to ${outcome.where}`, tone: 'success' };
  }
}

/** A float file's warning: the samples kept over full scale, and the non-finite ones written as 0. */
function floatWarning(outcome: Extract<AudioExportOutcome, { kind: 'saved' }>): string {
  const notes: string[] = [];
  if (outcome.clipped > 0) {
    notes.push(`${outcome.clipped} samples over full scale, kept in the float file`);
  }
  if (outcome.nonFinite > 0) {
    notes.push(`${outcome.nonFinite} non-finite samples written as silence`);
  }
  return `saved ${outcome.fileName} to ${outcome.where} — ${notes.join('; ')}`;
}
