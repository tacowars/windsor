/**
 * What the Coarse / Fine pair reads and writes (#587).
 *
 * The knobs are DOM, but the path from a turn to the export is not: each
 * spec's `set` is what a commit calls, `pushPatch` is what carries the result
 * into the document's `patches` section through `hooks.commit`, and the
 * document is what the console exports. So the assertions here land on
 * `model.doc.patches`, not on a rendered element — UI movement alone is not
 * the evidence (`patchPanels.test.ts` takes the same shape).
 */
import { describe, expect, it } from 'vitest';

import {
  PATCH_LIBRARY,
  clonePatch,
  makeArrangement,
} from '../../../packages/client/src/audio/index-for-editor';
import { DocumentModel } from './documentModel';
import { keyTarget } from './knob';
import { hooks, partsState } from './patchState';
import { type Hideable, ratioKnobSpecs, readRatio, showPitchControls } from './ratioKnobs';
import {
  COARSE_DEF,
  COARSE_MAX,
  COARSE_MIN,
  COARSE_STEP,
  FINE_DEF,
  FINE_MAX,
  FINE_MIN,
  FINE_STEP,
  RATIO_MIN,
} from './ratioSplit';

/** A song whose arp slot plays the library's `lead-bell` — tacowars's own check. */
const SONG = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  arp: { part: 'arp', preset: 'lead-bell', velocity: 0.7 },
};

/** The working patch and the document, wired the way the Parts tab wires them. */
function openConsole(id: string): { model: DocumentModel; ratio: (op: number) => number } {
  const model = new DocumentModel(SONG);
  partsState.patch = clonePatch(PATCH_LIBRARY[id]!.patch);
  hooks.commit = (patch): void => model.merge({ patches: { [id]: patch } });
  return {
    model,
    ratio: (op) => model.doc.patches?.[id]?.ops?.[op]?.ratio ?? Number.NaN,
  };
}

function withConsole(id: string, body: (c: ReturnType<typeof openConsole>) => void): void {
  const previous = hooks.commit;
  try {
    body(openConsole(id));
  } finally {
    hooks.commit = previous;
  }
}

describe('the Coarse and Fine specs', () => {
  it('span the ratio in the terms the ticket set', () => {
    const { coarse, fine } = ratioKnobSpecs(0);
    expect(coarse.label).toBe('Coarse');
    expect([coarse.min, coarse.max, coarse.step, coarse.def]).toEqual([
      COARSE_MIN,
      COARSE_MAX,
      COARSE_STEP,
      COARSE_DEF,
    ]);
    expect(coarse.curve).toBeUndefined();
    expect(fine.label).toBe('Fine');
    expect([fine.min, fine.max, fine.step, fine.def]).toEqual([
      FINE_MIN,
      FINE_MAX,
      FINE_STEP,
      FINE_DEF,
    ]);
    expect(fine.curve).toBeUndefined();
  });

  it('reads the working patch as two halves of one field', () => {
    withConsole('lead-bell', () => {
      partsState.patch.ops[1]!.ratio = 3.5;
      const { coarse, fine } = ratioKnobSpecs(1);
      expect(coarse.get()).toBe(3);
      expect(fine.get()).toBe(0.5);
      expect(coarse.fmt?.(coarse.get())).toBe('3');
      expect(fine.fmt?.(fine.get())).toBe('0.500');
    });
  });
});

describe('a turn of either knob', () => {
  it('commits the joined ratio to the document, and the export carries it', () => {
    withConsole('lead-bell', (c) => {
      // The non-mutation baseline is built here rather than pinned to today's
      // bank: what matters is that the factory entry is what it was.
      const factoryRatio = PATCH_LIBRARY['lead-bell']!.patch.ops[1]!.ratio;
      partsState.patch.ops[1]!.ratio = 1;
      const { coarse, fine } = ratioKnobSpecs(1);

      fine.set(0.5);
      expect(partsState.patch.ops[1]!.ratio).toBe(1.5);
      expect(c.ratio(1)).toBe(1.5);

      coarse.set(2);
      expect(c.ratio(1)).toBe(2.5);

      const exported = JSON.parse(c.model.toJson()) as unknown;
      const reread = makeArrangement(exported);
      expect(reread.usable).toBe(true);
      const roundTripped = reread.document.patches?.['lead-bell']?.ops?.[1]?.ratio;
      expect(roundTripped).toBe(2.5);
      // The library's own copy is untouched: the console edits a clone.
      expect(PATCH_LIBRARY['lead-bell']!.patch.ops[1]!.ratio).toBe(factoryRatio);
    });
  });

  it('leaves the other half where it was', () => {
    withConsole('lead-bell', (c) => {
      partsState.patch.ops[2]!.ratio = 2.5;
      const { coarse, fine } = ratioKnobSpecs(2);
      coarse.set(1);
      expect(c.ratio(2)).toBe(1.5);
      fine.set(0);
      expect(c.ratio(2)).toBe(1);
      expect(coarse.get()).toBe(1);
    });
  });

  it('clamps at the floor rather than writing a ratio the field cannot hold', () => {
    withConsole('lead-bell', (c) => {
      partsState.patch.ops[1]!.ratio = 0.5;
      const { coarse, fine } = ratioKnobSpecs(1);
      expect(coarse.get()).toBe(0);
      // Half the floor, written from the constant: the console clamps it there.
      fine.set(RATIO_MIN / 2);
      expect(c.ratio(1)).toBe(RATIO_MIN);
      // Which is why the pair re-reads itself after a commit: Fine was asked
      // for half the floor and the field now holds the floor.
      expect(fine.get()).toBe(RATIO_MIN);
    });
  });

  it('runs the pair through the callback that re-reads both displays', () => {
    withConsole('lead-bell', () => {
      let commits = 0;
      const { coarse, fine } = ratioKnobSpecs(1, () => (commits += 1));
      expect(coarse.onChange).toBe(fine.onChange);
      coarse.onChange?.();
      fine.onChange?.();
      expect(commits).toBe(2);
    });
  });

  it('reads a default for an operator index the patch does not have', () => {
    withConsole('lead-bell', () => {
      expect(readRatio(99)).toBe(COARSE_DEF);
      // And writing one is a no-op rather than a thrown bay.
      expect(() => ratioKnobSpecs(99).coarse.set(3)).not.toThrow();
    });
  });
});

describe('the keyboard on a coarsely stepped knob', () => {
  it('moves Coarse by a whole multiple in either direction', () => {
    const { coarse, fine } = ratioKnobSpecs(0);
    // One arrow key is 2% of the sweep, which over 0..24 is 0.48 — less than
    // half of Coarse's own step, so without `keyTarget`'s fallback the commit
    // rounds back to where it started and the knob is unreachable by keyboard.
    expect(keyTarget(coarse, 1, 1, false)).toBe(2);
    expect(keyTarget(coarse, 1, -1, false)).toBe(0);
    expect(keyTarget(coarse, 3, 1, true)).toBe(4);
    // Fine's own step is far smaller than its 2% share, so it is untouched.
    expect(keyTarget(fine, 0.5, 1, false)).toBeCloseTo(0.5 + FINE_MAX * 0.02, 6);
  });

  it('leaves a knob whose step the nudge already clears alone', () => {
    // Detune: 2% of ±100 is 4 cents, well past its 1-cent step.
    const detune = { min: -100, max: 100, step: 1 };
    expect(keyTarget(detune, 0, 1, false)).toBe(4);
    // Shift is 0.4 cents, which would round back to 0 — one step instead.
    expect(keyTarget(detune, 0, 1, true)).toBe(1);
    // An unstepped knob keeps the plain normalised nudge.
    expect(keyTarget({ min: 0, max: 1 }, 0.5, 1, false)).toBeCloseTo(0.52, 6);
  });
});

describe('the Pitch toggle', () => {
  it('swaps the pair and its readout against the Fixed Hz knob, and back', () => {
    const ratioNodes: Hideable[] = [
      { style: { display: '' } },
      { style: { display: '' } },
      { style: { display: '' } },
    ];
    const fixedNode: Hideable = { style: { display: '' } };

    showPitchControls(false, ratioNodes, fixedNode);
    expect(ratioNodes.map((n) => n.style.display)).toEqual(['', '', '']);
    expect(fixedNode.style.display).toBe('none');

    showPitchControls(true, ratioNodes, fixedNode);
    expect(ratioNodes.map((n) => n.style.display)).toEqual(['none', 'none', 'none']);
    expect(fixedNode.style.display).toBe('');

    showPitchControls(false, ratioNodes, fixedNode);
    expect(ratioNodes.map((n) => n.style.display)).toEqual(['', '', '']);
    expect(fixedNode.style.display).toBe('none');
  });
});
