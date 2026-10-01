/**
 * The Parts tab's knob tables for operator width and the second LFO (windsor#56).
 *
 * The tables are what the panels and bays build, so walking them is walking
 * every knob without a DOM: each path must exist on `makePatch()`, and the
 * two LFOs' tables must edit their own settings and nothing else.
 */
import { describe, expect, it } from 'vitest';

import type { Patch } from '@windsor/engine';
import { OP_NAMES, WIDTH_RANGE, makePatch } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import {
  DRIVE_KNOBS,
  FILTER_KNOBS,
  OP_KNOBS,
  allPatchKnobs,
  lfoKnobs,
  lfoToOpKnobs,
  lfoToWidthKnobs,
  patchKnobOpts,
  type LfoKey,
} from './patchKnobTables';
import type { PatchEditor } from './partsSession';
import { getPath, setPath } from './patchPath';

describe('allPatchKnobs', () => {
  it('lists only paths that resolve to a number on a fresh patch', () => {
    const fresh = makePatch();
    for (const { path } of allPatchKnobs()) {
      expect(typeof getPath(fresh, path), path).toBe('number');
    }
  });

  it('includes the width, the width depths, LFO 2 and the filter LFO 2 amount', () => {
    const paths = new Set(allPatchKnobs().map((k) => k.path));
    OP_NAMES.forEach((_, i) => {
      expect(paths.has(`ops.${i}.width`), `ops.${i}.width`).toBe(true);
      expect(paths.has(`lfo.toWidth.${i}`), `lfo.toWidth.${i}`).toBe(true);
      expect(paths.has(`lfo2.toWidth.${i}`), `lfo2.toWidth.${i}`).toBe(true);
      expect(paths.has(`lfo2.toOp.${i}`), `lfo2.toOp.${i}`).toBe(true);
    });
    for (const f of ['rate', 'amount', 'modWheelDepth', 'delay', 'toPitch']) {
      expect(paths.has(`lfo2.${f}`), `lfo2.${f}`).toBe(true);
    }
    expect(paths.has('filter.lfo2Amount')).toBe(true);
    // No knob is built twice over one path.
    expect(paths.size).toBe(allPatchKnobs().length);
  });
});

describe('the Width knob', () => {
  const width = OP_KNOBS.find((k) => k.f === 'width');

  it('sits after Fdbk and spans WIDTH_RANGE.min to 1, as a percentage', () => {
    const fields = OP_KNOBS.map((k) => k.f);
    expect(fields.indexOf('width')).toBe(fields.indexOf('feedback') + 1);
    expect(width?.label).toBe('Width');
    expect([width?.o.min, width?.o.max]).toEqual([WIDTH_RANGE.min, 1]);
    expect(width?.o.fmt?.(0.5)).toBe('50%');
  });

  it('reads back 100 % on a fresh operator', () => {
    const fresh = makePatch();
    OP_NAMES.forEach((_, i) => {
      const path = `ops.${i}.width`;
      const opts = width && patchKnobOpts(width, path);
      expect(opts?.def).toBe(1);
      expect(opts?.fmt?.(Number(getPath(fresh, path)))).toBe('100%');
    });
  });

  it('writes ops[i].width within WIDTH_RANGE and pushes the patch', () => {
    const pushed: number[] = [];
    const editor: PatchEditor = {
      patch: makePatch(),
      push: () => pushed.push((editor.patch as Patch).ops[2]?.width ?? NaN),
      refresh: () => undefined,
    };
    // What the knob's commit does: clamp to the entry's range, set the path, push.
    const clamp = (v: number): number =>
      Math.min(width?.o.max ?? 1, Math.max(width?.o.min ?? 0, v));
    for (const raw of [0.3, 0, 2]) {
      setPath(editor.patch, 'ops.2.width', clamp(raw));
      editor.push();
    }
    expect(pushed).toEqual([0.3, WIDTH_RANGE.min, WIDTH_RANGE.max]);
    expect(editor.patch.ops[1]?.width).toBe(1);
  });
});

describe('the LFO tables', () => {
  const tables = (key: LfoKey) => [...lfoKnobs(key), ...lfoToOpKnobs(key), ...lfoToWidthKnobs(key)];

  it('edit their own LFO: lfo.* for LFO 1 and lfo2.* for LFO 2', () => {
    for (const k of tables('lfo')) expect(k.f.startsWith('lfo.'), k.f).toBe(true);
    for (const k of tables('lfo2')) expect(k.f.startsWith('lfo2.'), k.f).toBe(true);
  });

  it('draw the second panel from the first: same labels and ranges', () => {
    const strip = (key: LfoKey) =>
      tables(key).map((k) => ({ f: k.f.slice(key.length), label: k.label, o: k.o }));
    expect(strip('lfo2')).toEqual(strip('lfo'));
  });

  it('put Width A-D (the To Width depths) after To A-D, signed -1..1', () => {
    const labels = tables('lfo').map((k) => k.label);
    expect(labels.slice(-(OP_NAMES.length * 2))).toEqual([
      ...OP_NAMES.map((n) => `To ${n}`),
      ...OP_NAMES.map((n) => `Width ${n}`),
    ]);
    for (const k of lfoToWidthKnobs('lfo2')) {
      expect([k.o.min, k.o.max]).toEqual([-1, 1]);
      expect(k.o.fmt?.(0.25)).toBe('+0.25');
    }
  });

  it('start LFO 2 inert: no depth anywhere and deaf to the wheel', () => {
    for (const k of [...lfoToOpKnobs('lfo2'), ...lfoToWidthKnobs('lfo2')]) {
      expect(patchKnobOpts(k).def, k.f).toBe(0);
    }
    const wheel = lfoKnobs('lfo2').find((k) => k.f === 'lfo2.modWheelDepth');
    expect(wheel && patchKnobOpts(wheel).def).toBe(0);
  });
});

describe('the filter LFO 2 amount', () => {
  it('sits after LFO Amt with the same range', () => {
    const fields = FILTER_KNOBS.map((k) => k.f);
    const at = fields.indexOf('filter.lfo2Amount');
    expect(at).toBe(fields.indexOf('filter.lfoAmount') + 1);
    expect(FILTER_KNOBS[at]?.label).toBe('LFO 2 Amt');
    expect(FILTER_KNOBS[at]?.o).toEqual(FILTER_KNOBS[at - 1]?.o);
  });
});

describe('the Drive section (windsor#309)', () => {
  const byLabel = new Map(DRIVE_KNOBS.map((k) => [k.label, k]));

  it("owns the voice's drive: Drive, Bias and Tone over drive.*, and Filter has no Drive", () => {
    expect(DRIVE_KNOBS.map((k) => [k.label, k.f])).toEqual([
      ['Drive', 'drive.gain'],
      ['Bias', 'drive.bias'],
      ['Tone', 'drive.tone'],
    ]);
    for (const k of FILTER_KNOBS) {
      expect(k.f.startsWith('drive.'), k.f).toBe(false);
      expect(k.label, k.f).not.toBe('Drive');
    }
    const paths = allPatchKnobs().map((k) => k.path);
    for (const k of DRIVE_KNOBS)
      expect(
        paths.filter((p) => p === k.f),
        k.f,
      ).toHaveLength(1);
  });

  it('dials Drive 1-16 on a log curve as ×n, Bias -1..1 signed, Tone 0..1 as a percentage', () => {
    const drive = byLabel.get('Drive');
    expect([drive?.o.min, drive?.o.max, drive?.o.curve]).toEqual([1, 16, 'log']);
    expect(drive?.o.fmt?.(1.5)).toBe('×1.50');
    const bias = byLabel.get('Bias');
    expect([bias?.o.min, bias?.o.max]).toEqual([-1, 1]);
    expect(bias?.o.fmt?.(0)).toBe('+0.00');
    expect(bias?.o.fmt?.(-0.25)).toBe('-0.25');
    const tone = byLabel.get('Tone');
    expect([tone?.o.min, tone?.o.max]).toEqual([0, 1]);
    expect(tone?.o.fmt?.(1)).toBe('100%');
  });

  it("starts each knob at the engine's bypass: unity drive, no bias, the tone open", () => {
    expect(DRIVE_KNOBS.map((k) => patchKnobOpts(k).def)).toEqual([1, 0, 1]);
  });

  it('reads the 808 kick as Drive ×1.50, Bias +0.00, Tone 100%', () => {
    const kick = PRESETS['tr808-kick'];
    expect(kick).toBeDefined();
    const shown = DRIVE_KNOBS.map((k) => k.o.fmt?.(Number(getPath(kick, k.f))));
    expect(shown).toEqual(['×1.50', '+0.00', '100%']);
  });

  it('writes each field and pushes it into the patch the JSON dialog shows', () => {
    const pushed: string[] = [];
    const editor: PatchEditor = {
      patch: makePatch(),
      push: () => pushed.push(JSON.stringify(editor.patch.drive)),
      refresh: () => undefined,
    };
    for (const [k, v] of DRIVE_KNOBS.map((k, i) => [k, [4, -0.3, 0.4][i]] as const)) {
      setPath(editor.patch, k.f, v);
      editor.push();
    }
    expect(JSON.parse(pushed.at(-1) ?? '{}')).toEqual({ gain: 4, shape: 0, bias: -0.3, tone: 0.4 });
    const shown = JSON.parse(JSON.stringify(editor.patch, null, 2)) as Patch;
    expect(makePatch(shown).drive).toEqual({ gain: 4, shape: 0, bias: -0.3, tone: 0.4 });
  });
});
