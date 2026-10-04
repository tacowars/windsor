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

import type { Patch } from '@windsor/engine';
import {
  DRIVE_SHAPE,
  DRIVE_SHAPE_NAMES,
  FILTER_MODE,
  FILTER_MODE_NAMES,
  makePatch,
} from '@windsor/engine';
import { FILTER_KNOBS, lfoKnobs, patchKnobOpts } from './patchKnobTables';
import {
  DRIVE_SWITCH,
  GLOBAL_TOGGLES,
  driveInactive,
  driveShapeOptions,
  filterModeShows,
  LFO_PHASE_NAMES,
  LFO_RANGE_NAMES,
  lfoPhaseIndex,
  toggleIndex,
  writeLfoPhase,
  writeToggle,
} from './patchPanels';
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
    lfo: lfoKnobs('lfo').find((k) => k.f === 'lfo.modWheelDepth'),
  });

  it('sit beside the amounts they add to, over fields the patch really has', () => {
    const { filter, lfo } = wheelKnobs();
    expect(filter?.label).toBe('Wheel');
    expect(lfo?.label).toBe('Wheel');
    // Signed octaves on the filter, like Env Amt; unipolar on the LFO, like Amount.
    expect([filter?.o?.min, filter?.o?.max]).toEqual([-6, 6]);
    expect([lfo?.o?.min, lfo?.o?.max]).toEqual([0, 1]);
    const fresh = makePatch();
    for (const k of [...FILTER_KNOBS, ...lfoKnobs('lfo'), ...lfoKnobs('lfo2')]) {
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

describe('the LFO Phase segment (windsor#56)', () => {
  it('offers Free, Retrigger and One-shot', () => {
    expect(LFO_PHASE_NAMES).toEqual(['Free', 'Retrigger', 'One-shot']);
  });

  it('round-trips all three states on either LFO', () => {
    const patch = makePatch();
    for (const lfo of [patch.lfo, patch.lfo2]) {
      LFO_PHASE_NAMES.forEach((_, i) => {
        writeLfoPhase(lfo, i);
        expect(lfoPhaseIndex(lfo)).toBe(i);
      });
    }
  });

  it('sets both flags on One-shot, clears both on Free, clears oneShot only on Retrigger', () => {
    const { lfo2: lfo } = makePatch();
    writeLfoPhase(lfo, LFO_PHASE_NAMES.indexOf('One-shot'));
    expect([lfo.oneShot, lfo.retrigger]).toEqual([true, true]);
    writeLfoPhase(lfo, LFO_PHASE_NAMES.indexOf('Retrigger'));
    expect([lfo.oneShot, lfo.retrigger]).toEqual([false, true]);
    writeLfoPhase(lfo, LFO_PHASE_NAMES.indexOf('One-shot'));
    writeLfoPhase(lfo, LFO_PHASE_NAMES.indexOf('Free'));
    expect([lfo.oneShot, lfo.retrigger]).toEqual([false, false]);
  });

  it('shows One-shot whenever oneShot is set, whatever retrigger says', () => {
    const { lfo } = makePatch();
    lfo.oneShot = true;
    lfo.retrigger = false;
    expect(lfoPhaseIndex(lfo)).toBe(LFO_PHASE_NAMES.indexOf('One-shot'));
  });
});

describe('the Drive section Shape picker (windsor#309)', () => {
  it("offers Soft, Hard, Diode, Tube and Fold at the engine's DRIVE_SHAPE ids", () => {
    expect(driveShapeOptions()).toEqual([
      { value: DRIVE_SHAPE.SOFT, label: 'Soft' },
      { value: DRIVE_SHAPE.HARD, label: 'Hard' },
      { value: DRIVE_SHAPE.DIODE, label: 'Diode' },
      { value: DRIVE_SHAPE.TUBE, label: 'Tube' },
      { value: DRIVE_SHAPE.FOLD, label: 'Fold' },
    ]);
    expect(driveShapeOptions().map((o) => o.label)).toEqual([...DRIVE_SHAPE_NAMES]);
  });

  it("shows Soft on a fresh patch and a patch's own shape once it has one", () => {
    const label = (shape: number): string | undefined =>
      driveShapeOptions().find((o) => o.value === shape)?.label;
    expect(label(makePatch().drive.shape)).toBe('Soft');
    const diode = makePatch({
      drive: { ...makePatch().drive, on: true, shape: DRIVE_SHAPE.DIODE },
    });
    expect(label(diode.drive.shape)).toBe('Diode');
  });

  it('writes drive.shape alone and survives the JSON round trip', () => {
    const patch = makePatch();
    setPath(patch, 'drive.shape', DRIVE_SHAPE.TUBE);
    const imported = makePatch(JSON.parse(JSON.stringify(patch)) as Patch);
    expect(imported.drive).toEqual({ ...makePatch().drive, shape: DRIVE_SHAPE.TUBE });
  });
});

describe('the Drive section switch (windsor#309)', () => {
  it('reads Off | On over drive.on, a boolean the patch really has', () => {
    expect([DRIVE_SWITCH.off, DRIVE_SWITCH.on]).toEqual(['Off', 'On']);
    expect(typeof getPath(makePatch(), DRIVE_SWITCH.f)).toBe('boolean');
  });

  // Built here, not read from the library: a refit may move a kit's drive.
  const driven = (): Patch =>
    makePatch({ drive: { on: true, gain: 1.5, shape: DRIVE_SHAPE.DIODE, bias: 0.1, tone: 0.8 } });

  it('shows a driven patch On and one with no drive Off, the undriven one dimmed', () => {
    const kick = driven();
    const pad = makePatch({ drive: { ...makePatch().drive, gain: 1, bias: 0 } });
    expect(toggleIndex(kick, DRIVE_SWITCH.f)).toBe(1);
    expect(driveInactive(kick)).toBe(false);
    expect(toggleIndex(pad, DRIVE_SWITCH.f)).toBe(0);
    expect(driveInactive(pad)).toBe(true);
    expect(driveInactive(makePatch())).toBe(true);
  });

  it('switches drive.on alone, keeps the four controls, and survives the JSON round trip', () => {
    const committed: string[] = [];
    const editor: PatchEditor = {
      patch: driven(),
      push: () => committed.push(JSON.stringify(editor.patch.drive)),
      refresh: () => undefined,
    };
    const before = { ...editor.patch.drive };
    writeToggle(editor.patch, DRIVE_SWITCH.f, 0);
    editor.push();
    expect(editor.patch.drive).toEqual({ ...before, on: false });
    expect(driveInactive(editor.patch)).toBe(true);
    const imported = makePatch({ drive: JSON.parse(committed.at(-1) ?? '{}') as Patch['drive'] });
    expect(imported.drive).toEqual({ ...before, on: false });
    writeToggle(editor.patch, DRIVE_SWITCH.f, 1);
    editor.push();
    expect(JSON.parse(committed.at(-1) ?? '{}')).toEqual(before);
  });
});

describe('the LFO Range segment (windsor#56)', () => {
  it('writes unipolar on its own LFO only', () => {
    expect(LFO_RANGE_NAMES).toEqual(['Bipolar', 'Unipolar']);
    const patch = makePatch();
    expect(toggleIndex(patch, 'lfo2.unipolar')).toBe(0);
    writeToggle(patch, 'lfo2.unipolar', 1);
    expect(patch.lfo2.unipolar).toBe(true);
    expect(patch.lfo.unipolar).toBe(false);
    expect(toggleIndex(patch, 'lfo2.unipolar')).toBe(1);
  });
});

describe('the filter section in Formant mode (windsor#334)', () => {
  it('offers Off, LP, HP, BP, Notch, Formant and Acid, the sixth writing mode 5 through a push', () => {
    // windsor#573 appended Acid, the diode ladder, after Formant.
    expect(FILTER_MODE_NAMES).toEqual(['Off', 'LP', 'HP', 'BP', 'Notch', 'Formant', 'Acid']);
    expect(FILTER_MODE_NAMES.indexOf('Formant')).toBe(FILTER_MODE.FORMANT);
    const pushed: number[] = [];
    const editor: PatchEditor = {
      patch: makePatch(),
      push: () => pushed.push(editor.patch.filter.mode),
      refresh: () => undefined,
    };
    // What the picker's sixth button does: write the index, then push.
    editor.patch.filter.mode = FILTER_MODE_NAMES.indexOf('Formant');
    editor.push();
    expect(pushed).toEqual([5]);
    const imported = makePatch(JSON.parse(JSON.stringify(editor.patch)) as Partial<Patch>);
    expect(imported.filter.mode).toBe(5);
  });

  it('shows Vowel and hides Cutoff and Slope in Formant, Cutoff alone in Acid, and the reverse of Formant in every other mode', () => {
    expect(filterModeShows(FILTER_MODE.FORMANT)).toEqual({
      cutoff: false,
      slope: false,
      vowel: true,
    });
    // windsor#573: the ladder has its own slope and no vowel.
    expect(filterModeShows(FILTER_MODE.LADDER)).toEqual({
      cutoff: true,
      slope: false,
      vowel: false,
    });
    FILTER_MODE_NAMES.forEach((name, mode) => {
      if (mode === FILTER_MODE.FORMANT || mode === FILTER_MODE.LADDER) return;
      expect(filterModeShows(mode), name).toEqual({ cutoff: true, slope: true, vowel: false });
    });
  });

  it('keeps every other filter knob in Formant mode, since they shift the formants', () => {
    const toggled = new Set(['filter.cutoff', 'filter.vowel']);
    expect(FILTER_KNOBS.filter((k) => !toggled.has(k.f)).map((k) => k.label)).toEqual([
      'Reso',
      'Env Amt',
      'Wheel',
      'LFO Amt',
      'LFO 2 Amt',
      'Key Trk',
    ]);
  });
});
