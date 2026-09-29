/**
 * The undo history's memory (windsor#124 decision 7): the heap growth for
 * 100 recorded knob-sized steps, measured in Node. Not part of the suite
 * (the root config includes only `packages/` and `scripts/lib/`); run it
 * with this folder's config, which exposes `gc`:
 *
 *   npx vitest run --config docs/research/2026-09-29-undo-history-memory/vitest.config.ts
 *
 * It writes `results.json` beside itself and prints the same.
 */
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import type { ApplyResult, DocumentPartial } from '@windsor/engine';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { AppContext, type ContextHost, type TabPanel } from '../../../packages/app/src/appContext';
import { partChange } from '../../../packages/app/src/context';
import { DocumentModel } from '../../../packages/app/src/documentModel';
import type { EngineHost } from '../../../packages/app/src/host';
import { addPartChange } from '../../../packages/app/src/partEdits';

const STEPS = 100;
const RUNS = 7;

declare const gc: () => void;

function openContext(song: unknown): AppContext<TabPanel> {
  const host: ContextHost = {
    apply: (): ApplyResult => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(song),
    notify: () => {},
  });
  ctx.addTab('mixer', { hidden: false }, () => {});
  return ctx;
}

/** FULL_DOCUMENT grown to all eight parts, each with its own Init patch. */
function eightParts(): unknown {
  const model = new DocumentModel(FULL_DOCUMENT);
  for (let i = 0; i < 4; i++) {
    const change = addPartChange(model.doc, (raw) => model.preview(raw));
    if (!change) throw new Error('a free slot');
    model.merge(change.partial);
  }
  return JSON.parse(model.toJson());
}

const heap = (): number => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};

type Knob = (ctx: AppContext<TabPanel>, i: number) => DocumentPartial;
const stripLevel: Knob = (_ctx, i) => partChange(0, { strip: { level: 0.2 + i / 1000 } });
const patchVolume: Knob = (ctx, i) => {
  const preset = ctx.model.doc.parts[0]!.preset;
  return { patches: { [preset]: { volume: 0.2 + i / 1000 } } };
};

/** One run: the heap held by 100 recorded steps, read as what clearing them frees. */
function run(song: unknown, knob: Knob): number {
  const ctx = openContext(song);
  for (let i = 1; i <= STEPS; i++) ctx.change(knob(ctx, i));
  const held = heap();
  expect(ctx.canUndo).toBe(true);
  ctx.importDoc(JSON.parse(ctx.model.toJson()));
  const cleared = heap();
  expect(ctx.canUndo).toBe(false);
  return held - cleared;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

it('measures the heap 100 knob-sized steps hold', () => {
  const songs = { 'FULL_DOCUMENT (4 parts)': FULL_DOCUMENT, 'eight parts': eightParts() };
  const knobs = { 'strip level': stripLevel, 'patch volume': patchVolume };
  const rows = [];
  for (const [name, song] of Object.entries(songs)) {
    const json = new DocumentModel(song).toJson();
    for (const [knobName, knob] of Object.entries(knobs)) {
      run(song, knob); // warm-up
      const runs = Array.from({ length: RUNS }, () => run(song, knob));
      const held = median(runs);
      rows.push({
        song: name,
        knob: knobName,
        documentJsonBytes: json.length,
        heldBytesMedian: held,
        heldBytesPerStep: Math.round(held / STEPS),
        runs,
      });
    }
  }
  const result = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    steps: STEPS,
    rows,
  };
  writeFileSync(new URL('./results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
});
