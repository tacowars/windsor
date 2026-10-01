/**
 * Export Audio's stems (windsor#41), pure so they are tested without a DOM:
 * the file names, and the one run — the engine's `renderStems`, each stem
 * encoded as it arrives, the lot laid out as one stored zip — written
 * through the same sink and the same cancel rules as the WAV
 * (`runToSink`).
 *
 * The files are `<song>.wav` (the master, as the WAV export writes it),
 * `<song>-<nn>-<part name>.wav` with `nn` the part's number (slot + 1),
 * `<song>-group-<n>-<group name>.wav` with `n` the group's place in the
 * song's list, from 1 (windsor#286), and `<song>-send-a.wav` and
 * `<song>-send-b.wav` for the send buses (decision 3, windsor#172), in
 * `<song>-stems.zip`. Both destinations get the zip: a
 * page cannot save several downloads in a row
 * without the browser stopping to ask, and one Save as… picks one file.
 *
 * Each stem's bytes go into a `Blob` as soon as they are checksummed, so the
 * run holds one pass of float audio and one encoded stem at a time; the
 * browser keeps the rest.
 */
import type {
  ArrangementDocument,
  RenderStemsOptions,
  RenderedStem,
  RenderedStems,
  Stem,
} from '@windsor/engine';
import { StoredZipWriter, crc32Async } from '@windsor/engine';
import {
  FILE_NAME_FORBIDDEN,
  STEMS_ZIP_SUFFIX,
  STEM_GROUP_WORD,
  STEM_NUMBER_DIGITS,
  STEM_RETURN_WORD,
  WAV_EXTENSION,
  ZIP_EXTENSION,
  ZIP_MIME,
} from './audioExportConstants';
import type { AudioExportOutcome, AudioExportRun } from './audioExportModel';
import { runToSink, songFileStem } from './audioExportModel';

/** `<song>-stems.zip`. */
export const stemsZipName = (exportName: string): string =>
  `${songFileStem(exportName)}${STEMS_ZIP_SUFFIX}${ZIP_EXTENSION}`;

/** One stem's name inside the zip. */
export function stemFileName(exportName: string, stem: Stem): string {
  const song = songFileStem(exportName);
  switch (stem.kind) {
    case 'master':
      return `${song}${WAV_EXTENSION}`;
    case 'part': {
      const number = String(stem.slot + 1).padStart(STEM_NUMBER_DIGITS, '0');
      return `${song}-${number}${labelSuffix(stem.name)}${WAV_EXTENSION}`;
    }
    case 'group':
      return `${song}-${STEM_GROUP_WORD}-${stem.position}${labelSuffix(stem.name)}${WAV_EXTENSION}`;
    case 'return':
      return `${song}-${STEM_RETURN_WORD}-${stem.name}${WAV_EXTENSION}`;
  }
}

/** `-<name>` with the characters no file system takes made `-`, or nothing for a blank name. */
function labelSuffix(name: string): string {
  const label = name.replace(FILE_NAME_FORBIDDEN, '-').trim();
  return label ? `-${label}` : '';
}

export interface StemExportRun extends Omit<AudioExportRun, 'render'> {
  /** The Export field's text: the song's name for every file. */
  exportName: string;
  /** Every entry's modification time in the zip. */
  modified: Date;
  render: (
    document: ArrangementDocument,
    options: RenderStemsOptions,
    onStem: (rendered: RenderedStem) => Promise<void>,
  ) => Promise<RenderedStems>;
}

export function runStemExport(run: StemExportRun): Promise<AudioExportOutcome> {
  const { settings, signal } = run;
  return runToSink(run, async () => {
    const zip = new StoredZipWriter(run.modified);
    const parts: BlobPart[] = [];
    let clipped = 0;
    await run.render(
      run.document,
      {
        sampleRate: settings.sampleRate,
        tailSeconds: settings.tailSeconds,
        includeMuted: settings.includeMuted,
        signal,
        onProgress: run.onProgress,
      },
      async ({ stem, channels, sampleRate }) => {
        const wav = await run.encode(channels, sampleRate, settings.bitDepth, { signal });
        clipped += wav.clipped;
        const crc = await crc32Async(wav.bytes, { signal });
        const header = zip.entry(stemFileName(run.exportName, stem), wav.bytes.length, crc);
        parts.push(
          header as Uint8Array<ArrayBuffer>,
          new Blob([wav.bytes as Uint8Array<ArrayBuffer>]),
        );
      },
    );
    parts.push(zip.finish() as Uint8Array<ArrayBuffer>);
    return { file: new Blob(parts, { type: ZIP_MIME }), clipped };
  });
}
