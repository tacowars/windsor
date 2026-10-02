/**
 * A song's text handed to the browser's download path, byte for byte: the
 * Document section's Export and a stored song's Export .json (windsor#434).
 */
import { EXPORT_URL_TTL_MS } from './arrangementConstants';

export function downloadSong(text: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), EXPORT_URL_TTL_MS);
}
