/**
 * The one serialisation of a `patches/<id>.json` file (#563): keys in the
 * order `format, name, category, tags, description, patch`, two-space
 * `JSON.stringify`, a trailing newline. The editor's Save path and the Node
 * scripts that rewrite the bank all write through this, so a file the editor
 * produces is byte-identical to a rewritten one for the same data;
 * `prettier --write` then reshapes it the same way for every writer.
 */
import type { PatchFile } from './patchLibrary';

export function serialisePatchFile(file: PatchFile): string {
  const ordered: PatchFile = {
    format: file.format,
    name: file.name,
    category: file.category,
    tags: [...file.tags],
    description: file.description,
    patch: file.patch,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
