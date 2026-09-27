/**
 * The one serialisation of a `patches/<id>.json` file (#563): the exact bytes
 * the #561 migration wrote — keys in the order `format, name, category, tags,
 * description, patch, headroom`, two-space `JSON.stringify`, a trailing
 * newline. The offline sweep (`packages/app/sweep-headroom.mjs`) and the
 * editor's Save path both write through this, so a file the editor produces is
 * byte-identical to a migrated one for the same data; `prettier --write` then
 * reshapes it the same way for every writer.
 *
 * A file that has not been swept yet carries no `headroom` key at all — the
 * sweep accepts that and adds the record — so `headroom` is optional here.
 */
import type { HeadroomRecord, PatchFile } from './patchLibrary';

/** A file about to be written: the record is absent until the sweep runs. */
export type UnsweptPatchFile = Omit<PatchFile, 'headroom'> & { headroom?: HeadroomRecord };

export function serialisePatchFile(file: UnsweptPatchFile): string {
  const ordered: Record<string, unknown> = {
    format: file.format,
    name: file.name,
    category: file.category,
    tags: [...file.tags],
    description: file.description,
    patch: file.patch,
  };
  if (file.headroom !== undefined) ordered['headroom'] = file.headroom;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
