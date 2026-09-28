/**
 * Where a rendered WAV, or the stems' zip (windsor#41), goes (windsor#40
 * decision 2): the browser's download, or a file the user picks with the
 * File System Access save picker. The picker's stable `id` makes it reopen
 * in the last directory a render went to. The patch-library folder grant is
 * never used for renders.
 */
import {
  WAV_EXTENSION,
  WAV_MIME,
  WAV_SAVE_PICKER_ID,
  WAV_URL_TTL_MS,
  ZIP_EXTENSION,
  ZIP_MIME,
} from './audioExportConstants';
import type { WavSink } from './audioExportModel';
import { abortError, writeInChunks } from './audioExportWrite';

interface SaveFilePickerOptions {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

/** What the picker offers to save: the WAV, or the stems' zip. */
export type SaveFormat = 'wav' | 'zip';

const SAVE_TYPES: Record<SaveFormat, { description: string; accept: Record<string, string[]> }> = {
  wav: { description: 'WAV audio', accept: { [WAV_MIME]: [WAV_EXTENSION] } },
  zip: { description: 'ZIP archive of WAV stems', accept: { [ZIP_MIME]: [ZIP_EXTENSION] } },
};

export const savePickerAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/** A download, started only once the file is whole. */
export function downloadSink(fileName: string): WavSink {
  return {
    where: 'your downloads',
    write: (file, signal) => {
      if (signal.aborted) return Promise.reject(abortError());
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(file);
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), WAV_URL_TTL_MS);
      return Promise.resolve();
    },
    discard: () => Promise.resolve(),
  };
}

/**
 * Ask where to save, inside the click (the picker needs its user activation,
 * and a render can outlast it). Null when the user closes the picker.
 *
 * The picked file is never removed: it may be one the user already had, and
 * nothing proves it new. The file is opened for writing only once the whole
 * WAV or zip is made, and a writable stream keeps the old contents until it
 * closes, so a failed or cancelled write (`writeInChunks`) is aborted and
 * the file is left as it was. A cancel before that point never touches the
 * file (a browser that creates an empty file on picking a new name leaves
 * that empty file).
 */
export async function pickSaveSink(fileName: string, format: SaveFormat): Promise<WavSink | null> {
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker!({
      id: WAV_SAVE_PICKER_ID,
      suggestedName: fileName,
      types: [SAVE_TYPES[format]],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  return {
    where: `${handle.name}, where you chose`,
    write: async (file, signal) => {
      if (signal.aborted) throw abortError();
      const writable = await handle.createWritable();
      await writeInChunks(
        {
          write: (chunk) => writable.write(chunk),
          close: () => writable.close(),
          abort: () => writable.abort(),
        },
        file,
        signal,
      );
    },
    discard: () => Promise.resolve(),
  };
}
