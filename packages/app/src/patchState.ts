/**
 * The Parts tab's working patch (#70): a clone of the selected part's patch,
 * edited by the knobs and pushed to the real `AudioPart` via `setPatch`. The
 * document stores preset *names* only, so edits here are live sound design —
 * the Patch JSON dialog is the export path (land it in `presetsAuthored.ts`).
 */
import type {
  AudioPart,
  MusicPartId,
  Patch,
} from '../../../packages/client/src/audio/index-for-editor';
import { makePatch } from '../../../packages/client/src/audio/index-for-editor';
import { makeKnob, type KnobSpec } from './knob';

interface PartsState {
  selected: MusicPartId;
  patch: Patch;
  part: AudioPart | null;
  dirty: boolean;
}

export const partsState: PartsState = {
  selected: 'kick',
  patch: makePatch(),
  part: null,
  dirty: false,
};

/** Cross-module callbacks the tab assembly fills in. */
export const hooks = {
  /** Rebuild the whole patch UI (an algorithm change recolours the bays). */
  refresh: (): void => {},
  /** The working patch diverged from the named preset. */
  dirty: (): void => {},
};

/** Push the working patch to the live part. Live-only by design (see above). */
export function pushPatch(): void {
  partsState.part?.setPatch(partsState.patch);
  if (!partsState.dirty) {
    partsState.dirty = true;
    hooks.dirty();
  }
}

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
    get: () => Number(getPath(partsState.patch, path) ?? 0),
    set: (v) => {
      setPath(partsState.patch, path, v);
      pushPatch();
    },
  });
}
