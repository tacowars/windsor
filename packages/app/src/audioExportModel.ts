/**
 * Export Audio's rules (windsor#40), pure so they are tested without a DOM:
 * the file name, the destinations this browser offers, the one export run —
 * render, encode, write — with its cancel, and the notice that says where the
 * file went.
 *
 * A render cancelled or failed writes nothing: the sink is written only once
 * the whole file is encoded, and a sink opened ahead of the render (the save
 * picker must open inside the click's user activation, long before the render
 * ends) is told to discard instead. Discarding releases what the sink holds
 * and never deletes a file: a picked file may be one the user already had.
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
} from '@windsor/engine';
import { FILE_NAME_FORBIDDEN, WAV_EXTENSION, WAV_FALLBACK_NAME } from './audioExportConstants';
import type { ToastTone } from './toastModel';

export interface AudioExportSettings {
  sampleRate: RenderSampleRate;
  bitDepth: WavBitDepth;
  tailSeconds: number;
}

/** What a fresh page offers: the engine's defaults. */
export const defaultExportSettings = (): AudioExportSettings => ({
  sampleRate: RENDER_SAMPLE_RATE_DEFAULT,
  bitDepth: WAV_BIT_DEPTH_DEFAULT,
  tailSeconds: RENDER_TAIL_SECONDS.default,
});

export type ExportDestination = 'download' | 'saveAs';

/** Download always; Save as… only where the File System Access save picker exists (decision 2). */
export function exportDestinations(hasSavePicker: boolean): ExportDestination[] {
  return hasSavePicker ? ['download', 'saveAs'] : ['download'];
}

/** `<song name>.wav`, the song's name being the Export field's, less its `.json`. */
export function wavFileName(exportName: string): string {
  const stem = exportName
    .trim()
    .replace(/\.json$/i, '')
    .replace(FILE_NAME_FORBIDDEN, '-')
    .trim();
  return `${stem || WAV_FALLBACK_NAME}${WAV_EXTENSION}`;
}

/** Where an encoded file goes: written once, or discarded when the run does not finish. */
export interface WavSink {
  /** How the notice names the destination ("your downloads", "the file you chose"). */
  readonly where: string;
  write(bytes: Uint8Array): Promise<void>;
  /** The run will not write; release anything held. Never deletes a file the user picked. */
  discard(): Promise<void>;
}

export interface AudioExportRun {
  document: ArrangementDocument;
  settings: AudioExportSettings;
  fileName: string;
  sink: WavSink;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  render: (document: ArrangementDocument, options: RenderSongOptions) => Promise<RenderedSong>;
  encode: (channels: Float32Array[], sampleRate: number, bitDepth: WavBitDepth) => EncodedWav;
}

export type AudioExportOutcome =
  | { kind: 'saved'; fileName: string; where: string; clipped: number }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string };

export async function runAudioExport(run: AudioExportRun): Promise<AudioExportOutcome> {
  const { settings, sink, signal } = run;
  try {
    const rendered = await run.render(run.document, {
      sampleRate: settings.sampleRate,
      tailSeconds: settings.tailSeconds,
      signal,
      onProgress: run.onProgress,
    });
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    const { bytes, clipped } = run.encode(
      rendered.channels,
      rendered.sampleRate,
      settings.bitDepth,
    );
    await sink.write(bytes);
    return { kind: 'saved', fileName: run.fileName, where: sink.where, clipped };
  } catch (error) {
    await sink.discard().catch(() => undefined);
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { kind: 'cancelled' };
    }
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** The toast for an outcome: where the file went, and a warning when the render clipped. */
export function exportNotice(outcome: AudioExportOutcome): { message: string; tone: ToastTone } {
  switch (outcome.kind) {
    case 'cancelled':
      return { message: 'audio export cancelled — nothing was written', tone: 'info' };
    case 'failed':
      return { message: `audio export failed: ${outcome.error}`, tone: 'error' };
    case 'saved':
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
