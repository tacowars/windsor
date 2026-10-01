/**
 * The shared envelope knob groups (#70, ported; #620 decision 4 split them
 * from the drawing in `envCanvas.ts`). The specs stay in `patchKnobTables.ts`
 * — `ENVELOPE_KNOBS` and `ENVELOPE_ADV_KNOBS` — so `knobDefaults.test.ts`
 * still walks every envelope knob.
 */
import { LOOP_MODE_NAMES } from '@windsor/engine';
import { el, seg } from './dom';
import { ENVELOPE_ADV_KNOBS, ENVELOPE_KNOBS, patchKnobOpts } from './patchKnobTables';
import type { PatchKnobTable } from './patchKnobTables';
import type { PatchEditor } from './partsSession';
import { getPath, pathKnob, setPath } from './patchPath';

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
  table: PatchKnobTable = ENVELOPE_ADV_KNOBS,
): DocumentFragment {
  return envelopeRow(editor, table, basePath, color, onChange);
}

/** The envelope's loop mode (None, Loop, Trigger) under `basePath`, as a labelled segment. */
export function envLoopPicker(editor: PatchEditor, basePath: string, color: string): HTMLElement {
  const path = `${basePath}.loopMode`;
  const wrap = el('div');
  wrap.style.cssText = 'width:100%;margin-top:5px';
  wrap.appendChild(el('span', 'field-label', 'Envelope Loop'));
  wrap.appendChild(
    seg(
      LOOP_MODE_NAMES.map((label, li) => ({ value: String(li), label })),
      () => String(getPath(editor.patch, path) ?? 0),
      (value) => {
        setPath(editor.patch, path, Number(value));
        editor.push();
      },
      color,
    ),
  );
  return wrap;
}
