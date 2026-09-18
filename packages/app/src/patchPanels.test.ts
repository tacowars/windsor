/**
 * The global row's boolean toggles (#453).
 *
 * The widget is DOM, but what a toggle reads and writes is not: the table
 * names a boolean path in the working patch, `writeToggle` is the write behind
 * one of its two buttons, and the editor's push is what carries the result
 * into the document's `patches` section (#620). That is the whole path from a
 * click to the export, and none of it needs a browser.
 */
import { describe, expect, it } from 'vitest';

import type { Patch } from '../../../packages/client/src/audio/index-for-editor';
import { makePatch } from '../../../packages/client/src/audio/index-for-editor';
import { FILTER_KNOBS, LFO_KNOBS, patchKnobOpts } from './patchKnobTables';
import { GLOBAL_TOGGLES, toggleIndex, writeToggle } from './patchPanels';
import type { PatchEditor } from './partsSession';
import { getPath, setPath } from './patchPath';

describe('the global row toggles', () => {
  it('offers Mono over a field the patch really has, as a boolean', () => {
    const mono = GLOBAL_TOGGLES.find((t) => t.f === 'mono');
    expect(mono?.on).toBe('Mono');
    expect(mono?.off).toBe('Poly');
    // Every entry, not just this one: a toggle over a number or a missing
    // field would silently write junk into the document.
    const fresh = makePatch();
    for (const t of GLOBAL_TOGGLES) {
      expect(typeof getPath(fresh, t.f), t.f).toBe('boolean');
    }
  });

  it('shows the working patch and commits both directions', () => {
    const committed: boolean[] = [];
    const editor: PatchEditor = {
      patch: makePatch(),
      push: () => committed.push((editor.patch as Patch).mono),
      refresh: () => undefined,
    };
    expect(toggleIndex(editor.patch, 'mono')).toBe(0);

    writeToggle(editor.patch, 'mono', 1);
    editor.push();
    expect(editor.patch.mono).toBe(true);
    expect(toggleIndex(editor.patch, 'mono')).toBe(1);

    writeToggle(editor.patch, 'mono', 0);
    editor.push();
    expect(editor.patch.mono).toBe(false);
    expect(toggleIndex(editor.patch, 'mono')).toBe(0);
    expect(committed).toEqual([true, false]);
  });
});

describe('the Wheel knobs (#586)', () => {
  const wheelKnobs = () => ({
    filter: FILTER_KNOBS.find((k) => k.f === 'filter.modWheelDepth'),
    lfo: LFO_KNOBS.find((k) => k.f === 'lfo.modWheelDepth'),
  });

  it('sit beside the amounts they add to, over fields the patch really has', () => {
    const { filter, lfo } = wheelKnobs();
    expect(filter?.label).toBe('Wheel');
    expect(lfo?.label).toBe('Wheel');
    // Signed octaves on the filter, like Env Amt; unipolar on the LFO, like Amount.
    expect([filter?.o?.min, filter?.o?.max]).toEqual([-6, 6]);
    expect([lfo?.o?.min, lfo?.o?.max]).toEqual([0, 1]);
    const fresh = makePatch();
    for (const k of [...FILTER_KNOBS, ...LFO_KNOBS]) {
      expect(typeof getPath(fresh, k.f), k.f).toBe('number');
    }
    // The knob's centre is the schema's default, so a fresh patch reads as untouched.
    expect(filter && patchKnobOpts(filter).def).toBe(fresh.filter.modWheelDepth);
    expect(lfo && patchKnobOpts(lfo).def).toBe(fresh.lfo.modWheelDepth);
  });

  it('round-trip through the JSON export and the makePatch import', () => {
    const edited = makePatch();
    setPath(edited, 'filter.modWheelDepth', 3);
    setPath(edited, 'lfo.modWheelDepth', 0);
    const imported = makePatch(JSON.parse(JSON.stringify(edited)) as Patch);
    expect(imported.filter.modWheelDepth).toBe(3);
    expect(imported.lfo.modWheelDepth).toBe(0);
    expect(imported).toEqual(edited);
  });
});
