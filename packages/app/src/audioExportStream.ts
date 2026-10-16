/**
 * The streamed Save as export (windsor#822), pure so it is tested without a
 * DOM: which export streams, the cap each one takes, and the run itself.
 *
 * A Save as of the mix renders the song, then opens the picked file's
 * writable and has the engine's `encodeWavStream` write the WAV into it one
 * chunk at a time, so the tab holds the float render and one chunk, never
 * the whole file. That lifts its cap from `RENDER_MAX_FRAMES` to
 * `RENDER_STREAM_MAX_FRAMES`. Download and stems still make the whole file in
 * memory first (`runToSink`), and keep the smaller cap.
 *
 * Nothing reaches the picked file until the writable closes: a
 * `FileSystemWritableFileStream` keeps the file's old contents until
 * `close()`. A cancel or a failure at any point before the close aborts the
 * writable, if it is open, and leaves the file as it was. The close is the
 * commit point (windsor#51 decision 2): a Cancel once it is called changes
 * nothing, and the run reports what the close did.
 */
import type {
  ArrangementDocument,
  RenderSongOptions,
  RenderedSong,
  WavBitDepth,
  WavCounts,
} from '@windsor/engine';
import { RENDER_MAX_FRAMES, RENDER_STREAM_MAX_FRAMES, renderRefusal } from '@windsor/engine';
import { DOWNLOAD_LENGTH_REMEDY } from './audioExportConstants';
import type {
  AudioExportOutcome,
  AudioExportRun,
  AudioExportSettings,
  ExportDestination,
  StreamWritable,
  WavSink,
} from './audioExportModel';
import { failureOutcome } from './audioExportModel';

/** True for the one export that streams: Save as of the mix. */
export const exportStreams = (destination: ExportDestination, stems: boolean): boolean =>
  destination === 'saveAs' && !stems;

/** The longest render, in frames, an export to `destination` takes (decision 3). */
export const exportFrameCap = (destination: ExportDestination, stems: boolean): number =>
  exportStreams(destination, stems) ? RENDER_STREAM_MAX_FRAMES : RENDER_MAX_FRAMES;

/**
 * Why this export would be refused, or null: the engine's `renderRefusal`
 * at the destination's cap. A Download the streamed Save as could take says
 * so, and names Save as…, where this browser has the save picker.
 */
export function exportRefusal(
  document: ArrangementDocument,
  settings: AudioExportSettings,
  destination: ExportDestination,
  hasSavePicker: boolean,
): string | null {
  const cap = exportFrameCap(destination, settings.stems);
  const streamable =
    destination === 'download' &&
    !settings.stems &&
    hasSavePicker &&
    renderRefusal(document, settings, RENDER_STREAM_MAX_FRAMES) === null;
  return streamable
    ? renderRefusal(document, settings, cap, DOWNLOAD_LENGTH_REMEDY)
    : renderRefusal(document, settings, cap);
}

/** A destination that takes a streamed write: the picked file. */
export interface StreamSink extends Pick<WavSink, 'where' | 'discard'> {
  stream: () => Promise<StreamWritable>;
}

export interface StreamedExportRun extends Omit<AudioExportRun, 'sink' | 'encode' | 'render'> {
  sink: StreamSink;
  /** The engine's `renderSong`, given the stream cap. */
  render: (
    document: ArrangementDocument,
    options: RenderSongOptions,
    maxFrames: number,
  ) => Promise<RenderedSong>;
  /**
   * The engine's `encodeWavStream`: the header, then one chunk at a time to
   * `write`, each awaited; it rejects with an `AbortError` once `signal`
   * fires, or with a write's own error.
   */
  encodeStream: (
    channels: Float32Array[],
    sampleRate: number,
    bitDepth: WavBitDepth,
    options: { signal: AbortSignal; write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void> },
  ) => Promise<WavCounts>;
}

/** Render, then stream the encode into the picked file and close it; or abort it and say why. */
export async function runStreamedExport(run: StreamedExportRun): Promise<AudioExportOutcome> {
  const { settings, signal, sink } = run;
  let writable: StreamWritable | null = null;
  let closing = false;
  try {
    const rendered = await run.render(
      run.document,
      {
        sampleRate: settings.sampleRate,
        tailSeconds: settings.tailSeconds,
        signal,
        onProgress: run.onProgress,
      },
      RENDER_STREAM_MAX_FRAMES,
    );
    if (signal.aborted) throw new DOMException('canceled', 'AbortError');
    const open = await sink.stream();
    writable = open;
    const { clipped, nonFinite } = await run.encodeStream(
      rendered.channels,
      rendered.sampleRate,
      settings.bitDepth,
      { signal, write: (bytes) => open.write(bytes) },
    );
    // The last look at the signal: once the close is called it commits.
    if (signal.aborted) throw new DOMException('canceled', 'AbortError');
    closing = true;
    await open.close();
    return { kind: 'saved', fileName: run.fileName, where: sink.where, clipped, nonFinite };
  } catch (error) {
    await writable?.abort().catch(() => undefined);
    await sink.discard().catch(() => undefined);
    return failureOutcome(error, signal, closing);
  }
}

/** The sink as a streamed one, when it takes a streamed write. */
export function streamSink(sink: WavSink): StreamSink | null {
  const { stream } = sink;
  return stream ? { where: sink.where, discard: () => sink.discard(), stream } : null;
}
