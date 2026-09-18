/**
 * Dotted paths into the working patch (#70): what a knob table names, what a
 * knob reads and writes, and the knob bound to one path (#620 decision 3 —
 * the working patch itself is the `PartsSession`).
 */
import { makeKnob, type KnobSpec } from './knob';
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
    get: () => Number(getPath(editor.patch, path) ?? 0),
    set: (v) => {
      setPath(editor.patch, path, v);
      editor.push();
    },
  });
}
