/**
 * The shared envelope knob groups (#70, ported; #620 decision 4 split them
 * from the drawing in `envCanvas.ts`). The specs stay in `patchKnobTables.ts`
 * — `ENVELOPE_KNOBS` and `ENVELOPE_ADV_KNOBS` — so `knobDefaults.test.ts`
 * still walks every envelope knob.
 */
import { ENVELOPE_ADV_KNOBS, ENVELOPE_KNOBS, patchKnobOpts } from './patchKnobTables';
import type { PatchKnobTable } from './patchKnobTables';
import type { PatchEditor } from './partsSession';
import { pathKnob } from './patchPath';

/** One envelope table's knobs under `basePath`, each defaulting to the engine's value there. */
function envelopeRow(
  editor: PatchEditor,
  table: PatchKnobTable,
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const entry of table) {
    const path = `${basePath}.${entry.f}`;
    frag.appendChild(
      pathKnob(editor, path, entry.label, { ...patchKnobOpts(entry, path), color, onChange }),
    );
  }
  return frag;
}

export function envKnobs(
  editor: PatchEditor,
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  return envelopeRow(editor, ENVELOPE_KNOBS, basePath, color, onChange);
}

export function envAdvKnobs(
  editor: PatchEditor,
  basePath: string,
  color: string,
  onChange: () => void,
): DocumentFragment {
  return envelopeRow(editor, ENVELOPE_ADV_KNOBS, basePath, color, onChange);
}
