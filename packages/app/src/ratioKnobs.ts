/**
 * The operator bay's pitch controls (#587): the Coarse / Fine knob pair and
 * the combined readout, both bound through `ratioSplit` to the one
 * `ops.<i>.ratio` field of the working patch.
 *
 * Two knobs over one field cannot be two `pathKnob`s — each has to read the
 * field, change only its own half, and write the whole thing back — so the
 * specs are built here with their own `get`/`set` closures. They still end at
 * the editor's push, which is the only way a knob reaches the document
 * (`2026-09-11-music-document-carries-patches-and-returns`).
 *
 * `ratioKnobSpecs` is deliberately separate from the DOM: what a knob reads
 * and writes is the part worth testing, and the console's tests run without a
 * browser (`patchPanels.test.ts` takes the same shape).
 *
 * The ratio is a voice target (`ops.<i>.ratio`, windsor#646), so a song lane
 * or a macro mapping can hold it. While one does, both knobs lock and light
 * as every other path knob does (windsor#649 decision 9): the one lock the
 * editor answers for the path, split into each knob's half of the held
 * ratio, and the readout shows the held ratio too.
 */
import { el } from './dom';
import { makeKnob, type KnobElement, type KnobSpec } from './knob';
import type { KnobAutomation } from './knobAutomation';
import { followAutomation } from './knobLock';
import type { PatchEditor } from './partsSession';
import {
  COARSE_DEF,
  COARSE_MAX,
  COARSE_MIN,
  COARSE_STEP,
  FINE_DEF,
  FINE_MAX,
  FINE_MIN,
  FINE_STEP,
  fmtCoarse,
  fmtFine,
  fmtRatio,
  split,
  withCoarse,
  withFine,
} from './ratioSplit';

/** The working patch's stored ratio for operator `i`. */
export function readRatio(editor: PatchEditor, i: number): number {
  return Number(editor.patch.ops[i]?.ratio ?? COARSE_DEF);
}

/** The lock a lane or a macro puts on operator `i`'s ratio, or null while none holds it. */
export function ratioLock(editor: PatchEditor, i: number): KnobAutomation | null {
  return editor.automation?.(`ops.${i}.ratio`) ?? null;
}

/** One knob's share of the ratio lock: its half of the held ratio, in the lock's colour. */
function halfLock(
  editor: PatchEditor,
  i: number,
  half: (ratio: number) => number,
): Pick<KnobSpec, 'automation'> {
  if (!editor.automation) return {};
  return {
    automation: () => {
      const lock = ratioLock(editor, i);
      return lock && { ...lock, value: half(lock.value) };
    },
  };
}

function writeRatio(editor: PatchEditor, i: number, ratio: number): void {
  const target = editor.patch.ops[i];
  if (!target) return;
  target.ratio = ratio;
  editor.push();
}

/**
 * The pair's specs. `onChange` is how the two stay honest about each other:
 * a clamp on one (Coarse 0 with Fine 0.1 lands on the 0.25 floor) moves the
 * other's displayed value, so every commit re-reads both.
 */
const NO_OP = (): void => undefined;

export function ratioKnobSpecs(
  editor: PatchEditor,
  i: number,
  onChange: () => void = NO_OP,
): { coarse: KnobSpec; fine: KnobSpec } {
  return {
    coarse: {
      label: 'Coarse',
      min: COARSE_MIN,
      max: COARSE_MAX,
      def: COARSE_DEF,
      step: COARSE_STEP,
      fmt: fmtCoarse,
      get: () => split(readRatio(editor, i)).coarse,
      set: (v) => writeRatio(editor, i, withCoarse(readRatio(editor, i), v)),
      onChange,
      ...halfLock(editor, i, (ratio) => split(ratio).coarse),
    },
    fine: {
      label: 'Fine',
      min: FINE_MIN,
      max: FINE_MAX,
      def: FINE_DEF,
      step: FINE_STEP,
      fmt: fmtFine,
      get: () => split(readRatio(editor, i)).fine,
      set: (v) => writeRatio(editor, i, withFine(readRatio(editor, i), v)),
      onChange,
      ...halfLock(editor, i, (ratio) => split(ratio).fine),
    },
  };
}

/** Anything with a `display` — an element, or a test's stand-in for one. */
export interface Hideable {
  style: { display: string };
}

/**
 * The Fixed toggle's swap: an operator on a fixed frequency has no ratio, so
 * the pair and its readout give the row back to the Fixed Hz knob. The row's
 * visible count therefore never grows — two ratio knobs and a readout, or one
 * Fixed knob.
 */
export function showPitchControls(
  fixed: boolean,
  ratioNodes: readonly Hideable[],
  fixedNode: Hideable,
): void {
  for (const node of ratioNodes) node.style.display = fixed ? 'none' : '';
  fixedNode.style.display = fixed ? '' : 'none';
}

/** The ratio the readout shows: the held ratio while a lane or macro holds it, else the stored one. */
export function shownRatio(editor: PatchEditor, i: number): number {
  return ratioLock(editor, i)?.value ?? readRatio(editor, i);
}

/**
 * The combined ratio, beside the pair, so the stored value is always visible;
 * while the ratio is held, the held value in the lock's colour, following it.
 */
function ratioReadout(editor: PatchEditor, i: number): { node: HTMLElement; sync: () => void } {
  const node = el('div', 'knob-readout');
  node.innerHTML = '<span class="readout-val"></span><span class="readout-label">Ratio</span>';
  const out = node.querySelector('.readout-val') as HTMLElement;
  const sync = (): void => {
    const lock = ratioLock(editor, i);
    out.textContent = fmtRatio(shownRatio(editor, i));
    node.classList.toggle('locked', lock !== null);
    if (lock) node.style.setProperty('--lock-color', lock.color);
    else node.style.removeProperty('--lock-color');
  };
  node.title = 'The stored ratio: Coarse + Fine';
  sync();
  if (editor.automation) followAutomation(node, () => ratioLock(editor, i), sync);
  return { node, sync };
}

/** Coarse, Fine and the readout, in row order. */
export function ratioControls(editor: PatchEditor, i: number, color: string): HTMLElement[] {
  const readout = ratioReadout(editor, i);
  const pair: KnobElement[] = [];
  const afterCommit = (): void => {
    for (const knob of pair) knob.refresh();
    readout.sync();
  };
  const specs = ratioKnobSpecs(editor, i, afterCommit);
  pair.push(makeKnob({ ...specs.coarse, color }), makeKnob({ ...specs.fine, color }));
  return [...pair, readout.node];
}
