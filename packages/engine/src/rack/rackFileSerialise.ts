/**
 * The one serialisation of a `racks/<id>.json` file (windsor#862, record
 * `2026-10-17-racks` decision 8): keys in `RACK_FILE_KEYS` order, an
 * optional key written only when the file carries it, two-space
 * `JSON.stringify`, a trailing newline. A stored record, a download and a
 * folder file are the same bytes for the same data, as a patch file's are
 * through `serialisePatchFile`.
 */
import { RACK_FILE_KEYS } from './rackConstants';
import type { RackFile } from './rackFile';

export function serialiseRackFile(file: RackFile): string {
  const ordered: Record<string, unknown> = {};
  for (const key of RACK_FILE_KEYS) {
    const value = key === 'tags' ? [...file.tags] : file[key];
    if (value !== undefined) ordered[key] = value;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
