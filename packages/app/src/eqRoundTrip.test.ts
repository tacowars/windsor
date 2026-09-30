/**
 * An EQ edit is a song edit (windsor#199 decision 5): the card's whole spec
 * goes through `ctx.change`, so it survives an export and an import, and a
 * drag of many moves is one undo step that brings the previous curve back.
 * Driven over the context with a fake host, as `appContextUndo.test.ts` does.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { EqSpec, InsertSpec } from '@windsor/engine';
import { eqResponseDb, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import { dragBand, eqPlot, withBand } from './eqCurveModel';
import type { EngineHost } from './host';
import { addInsert } from './insertEdits';
import { insertChange, insertsOf } from './insertTarget';
import { library, loadPageLibrary } from './libraryModel';
import { newSong } from './songParts';

beforeAll(() => loadPageLibrary(library));

function openConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
  const model = new DocumentModel(newSong());
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
    model,
    notify: () => {},
  });
  ctx.addTab('mixer', { hidden: false }, () => {});
  return { ctx, model };
}

const eqAt = (ctx: AppContext<TabPanel>): EqSpec => {
  const spec = insertsOf(ctx, 0)[0];
  if (spec?.kind !== 'eq') throw new Error('no EQ at slot 0');
  return spec;
};

/** Send `spec` as the chain's EQ, the way the card does. */
const commit = (ctx: AppContext<TabPanel>, spec: EqSpec): boolean => {
  const list: InsertSpec[] = insertsOf(ctx, 0).map((held, i) =>
    i === 0 ? { ...held, ...spec } : held,
  );
  return ctx.change(insertChange(0, list)).ok;
};

const curve = (spec: EqSpec): number[] => [
  ...eqResponseDb(spec, [50, 250, 1000, 4000, 12000], 48000, new Float64Array(5)),
];

describe('an EQ edit', () => {
  it('survives an export and an import', () => {
    const { ctx, model } = openConsole();
    expect(ctx.change(insertChange(0, addInsert([], 'eq', 0))).ok).toBe(true);
    const spec = eqAt(ctx);
    const edited = withBand({ ...spec, scale: 1.5, output: -2 }, 3, {
      ...spec.bands[3]!,
      type: 'notch',
      freq: 1240,
      q: 8,
    });
    expect(commit(ctx, withBand(edited, 0, { ...edited.bands[0]!, on: true, slope: 24 }))).toBe(
      true,
    );
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(partAt(reopened.doc, 0)?.strip.inserts).toEqual(partAt(model.doc, 0)?.strip.inserts);
    const back = partAt(reopened.doc, 0)?.strip.inserts[0] as EqSpec;
    expect(back.bands[3]).toMatchObject({ type: 'notch', freq: 1240, q: 8 });
    expect(back.bands[0]).toMatchObject({ on: true, slope: 24 });
    expect([back.scale, back.output]).toEqual([1.5, -2]);
  });

  it('is one undo step for a whole drag, and undo restores the previous curve', () => {
    const { ctx } = openConsole();
    ctx.change(insertChange(0, addInsert([], 'eq', 0)));
    const before = eqAt(ctx);
    const plot = eqPlot(12);
    const start = { band: before.bands[4]!, scale: before.scale, x: 200, y: 80 };
    ctx.beginGesture('EQ band 5');
    for (const [x, y] of [
      [210, 70],
      [230, 50],
      [240, 30],
    ] as const) {
      const band = dragBand(start, { x, y, fine: false, alt: false }, plot);
      commit(ctx, withBand(eqAt(ctx), 4, band));
    }
    ctx.endGesture();
    expect(curve(eqAt(ctx))).not.toEqual(curve(before));
    expect(ctx.undo()).toBe(true);
    expect(eqAt(ctx)).toEqual(before);
    expect(curve(eqAt(ctx))).toEqual(curve(before));
    expect(ctx.undo()).toBe(true);
    expect(insertsOf(ctx, 0)).toEqual([]);
  });
});
