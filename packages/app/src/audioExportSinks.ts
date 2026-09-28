/**
 * Where a rendered WAV goes (windsor#40 decision 2): the browser's download,
 * or a file the user picks with the File System Access save picker. The
 * picker's stable `id` makes it reopen in the last directory a render went
 * to. The patch-library folder grant is never used for renders.
 */
import {
  WAV_EXTENSION,
  WAV_MIME,
  WAV_SAVE_PICKER_ID,
  WAV_URL_TTL_MS,
} from './audioExportConstants';
import type { WavSink } from './audioExportModel';

interface SaveFilePickerOptions {
  id?: string;
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

/** Chrome's handle can delete itself; the spec's cannot yet. */
type RemovableFileHandle = FileSystemFileHandle & { remove?: () => Promise<void> };

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

export const savePickerAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/** A download, started only once the file is whole. */
export function downloadSink(fileName: string): WavSink {
  return {
    where: 'your downloads',
    write: (bytes) => {
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: WAV_MIME });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
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
 * and a render can outlast it). Null when the user closes the picker. A
 * cancelled render removes the file the picker may already have created.
 */
export async function pickSaveSink(fileName: string): Promise<WavSink | null> {
  let handle: RemovableFileHandle;
  try {
    handle = await window.showSaveFilePicker!({
      id: WAV_SAVE_PICKER_ID,
      suggestedName: fileName,
      types: [{ description: 'WAV audio', accept: { [WAV_MIME]: [WAV_EXTENSION] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  return {
    where: `${handle.name}, where you chose`,
    write: async (bytes) => {
      const writable = await handle.createWritable();
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
      await writable.close();
    },
    discard: async () => {
      await handle.remove?.();
    },
  };
}
