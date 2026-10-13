/**
 * Dotted paths into the working patch (#70): what a knob table names, what a
 * knob reads and writes, and the knob bound to one path (#620 decision 3 —
 * the working patch itself is the `PartsSession`). A knob on one of the 29
 * voice targets locks while the selected part has a lane on it that is on
 * (windsor#351): the editor answers which (`PatchEditor.automation`). It
 * shows an env ring while a roll's clip envelope moves it (windsor#725,
 * `PatchEditor.envelope`), and stays live. A MIDI CC mapping on the
 * selected part can drive it (windsor#785, `PatchEditor.cc`): its tag, ring
 * and right-click menu.
 */
import { isCcMappableTarget } from '@windsor/engine';
import { makeKnob, type KnobSpec } from './knob';
import { voiceKnobTarget } from './knobAutomation';
import { type KnobCcBinding, partTargetAt } from './knobCc';
import { emptyKnobEnvelope } from './knobEnvelope';
import type { PatchEditor } from './partsSession';

export const getPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);

export function setPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop() ?? '';
  const target = parts.reduce<unknown>(
    (o, k) => (o == null ? o : (o as Record<string, unknown>)[k]),
    obj,
  );
  if (target != null) (target as Record<string, unknown>)[last] = value;
}

/**
 * The CC binding of the knob at `path` (windsor#785): the selected part's
 * voice target there, shown through `view` (a knob's share of the value);
 * none without the editor's scope.
 */
export function pathCc(
  editor: PatchEditor,
  path: string,
  view?: (value: number) => number,
): Pick<KnobSpec, 'cc'> {
  const target = voiceKnobTarget(path);
  const cc = editor.cc;
  if (!cc || target === null || !isCcMappableTarget(target)) return {};
  const binding: KnobCcBinding = {
    scope: cc.scope,
    at: partTargetAt(() => cc.part(), target),
    ...(view ? { view } : {}),
  };
  return { cc: binding };
}

/**
 * The lock, the env ring and the CC binding on the knob at `path`: only a
 * voice target's, and each only when the editor answers. The ring's answer
 * is the knob's own, reused frame after frame.
 */
function pathLock(
  editor: PatchEditor,
  path: string,
): Pick<KnobSpec, 'automation' | 'envelope' | 'cc'> {
  if (voiceKnobTarget(path) === null) return {};
  const automation = editor.automation?.bind(editor);
  const envelope = editor.envelope?.bind(editor);
  const out = emptyKnobEnvelope();
  return {
    ...(automation ? { automation: () => automation(path) } : {}),
    ...(envelope ? { envelope: () => envelope(path, out) } : {}),
    ...pathCc(editor, path),
  };
}

/** A knob bound to a path in the working patch; every commit pushes the patch. */
export function pathKnob(
  editor: PatchEditor,
  path: string,
  label: string,
  opts: Partial<Omit<KnobSpec, 'label' | 'get' | 'set'>> = {},
): HTMLElement {
  return makeKnob({
    label,
    min: opts.min ?? 0,
    max: opts.max ?? 1,
    def: opts.def ?? 0,
    ...opts,
    ...pathLock(editor, path),
    get: () => Number(getPath(editor.patch, path) ?? 0),
    set: (v) => {
      setPath(editor.patch, path, v);
      editor.push();
    },
  });
}
