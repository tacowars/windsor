/**
 * Lanes follow their macro (windsor#561 fix round 2): removing a macro drops
 * the lanes on it and moves the later macros' lanes down a row, on every part
 * playing the patch, song lanes and step lanes alike, and leaves every other
 * part and lane as it was. Every macro edit the card commits, a rename or a
 * removal, puts the Song tab out of date (fix round 3): its lane titles and
 * lane picker are drawn from the patch's macros.
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  FULL_SONG_TICKS,
} from '@windsor/engine/__fixtures__/fullArrangement';
import {
  makeMacro,
  makePatch,
  voiceTargetId,
  type ArrangementDocument,
  type DocumentPart,
  type RegionPattern,
  type StepModLane,
  type VoiceTargetPath,
} from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import {
  commitMacros,
  macroRemovalParts,
  removeMacroAndItsLanes,
  shiftedMacroPath,
} from './macroLaneShift';
import { macroValuePath, renameMacro } from './macroModel';
import type { PatchEditor } from './partsSession';
import { newLane } from './songAutomationModel';

const SHARED = 'shared-lead';
const STEPS = FULL_PARTS.arp.sequencer.steps.length;

/** A song lane on macro `j`, flat at `value`, which names the macro it was drawn on. */
const songLane = (j: number, value: number) =>
  newLane(voiceTargetId(macroValuePath(j)), value, FULL_SONG_TICKS);
const CUTOFF_LANE = newLane('voice.filter.cutoff', 1000, FULL_SONG_TICKS);

/** A step lane on macro `j`, every cell at `value`. */
const stepLane = (j: number, value: number, steps: number): StepModLane => ({
  param: macroValuePath(j) as VoiceTargetPath,
  values: new Array<number>(steps).fill(value),
});

/** A lane on each of three macros, macro `j`'s at `(j + 1) / 10`, so a moved lane shows where it came from. */
const songLanes = [0, 1, 2].map((j) => songLane(j, (j + 1) / 10));
const stepLanes = (steps: number) => [0, 1, 2].map((j) => stepLane(j, (j + 1) / 10, steps));

const part = (slot: number, preset: string, edit: Partial<DocumentPart>): DocumentPart => {
  const base = FULL_DOCUMENT.parts.find((p) => p.slot === slot)!;
  return { ...base, preset, ...edit } as DocumentPart;
};

/**
 * Kick (a Euclid) and arp (a grid) play the shared patch with a song lane and
 * a step lane on each of its three macros, and a cutoff lane on the kick; the
 * hat plays another patch with the same lanes; the drone plays the shared
 * patch with no lanes.
 */
const DOC: ArrangementDocument = {
  ...FULL_DOCUMENT,
  parts: [
    part(FULL_SLOT.kick, SHARED, {
      automation: [...songLanes, CUTOFF_LANE],
      sequencer: { ...FULL_PARTS.kick.sequencer, modLanes: stepLanes(1) },
    }),
    part(FULL_SLOT.hat, 'hat', {
      automation: songLanes,
      sequencer: { ...FULL_PARTS.hat.sequencer, modLanes: stepLanes(1) },
    }),
    part(FULL_SLOT.arp, SHARED, {
      automation: songLanes,
      sequencer: { ...FULL_PARTS.arp.sequencer, lanes: stepLanes(STEPS) },
    }),
    part(FULL_SLOT.drone, SHARED, {}),
  ],
  patches: {
    ...FULL_DOCUMENT.patches,
    [SHARED]: makePatch({
      macros: ['A', 'B', 'C'].map((name) => makeMacro({ name })),
    }),
  },
};

/** The document after removing macro `removed` from the shared patch, through the document model. */
function afterRemoving(removed: number): ArrangementDocument {
  const model = new DocumentModel(DOC);
  model.merge({ parts: macroRemovalParts(DOC, SHARED, removed) });
  return model.doc;
}

const at = (doc: ArrangementDocument, slot: number): DocumentPart =>
  doc.parts.find((p) => p.slot === slot)!;
const targets = (p: DocumentPart) =>
  (p.automation ?? []).map((l) => [l.target, l.points[0]?.value]);
const params = (lanes: readonly StepModLane[] | undefined) =>
  (lanes ?? []).map((l) => [l.param, l.values[0]]);

describe('removing a macro moves its lanes with it', () => {
  it('maps a row to the one before past the removed macro, and drops its own', () => {
    expect(shiftedMacroPath('macros.0.value', 1)).toBe('macros.0.value');
    expect(shiftedMacroPath('macros.1.value', 1)).toBeNull();
    expect(shiftedMacroPath('macros.2.value', 1)).toBe('macros.1.value');
    expect(shiftedMacroPath('filter.cutoff', 1)).toBe('filter.cutoff');
  });

  it('removing the middle of three: its lanes go, the third’s move to the second, on each part sharing the patch', () => {
    const doc = afterRemoving(1);
    const moved = [
      [voiceTargetId('macros.0.value'), 0.1],
      [voiceTargetId('macros.1.value'), 0.3],
    ];
    expect(targets(at(doc, FULL_SLOT.kick))).toEqual([...moved, ['voice.filter.cutoff', 1000]]);
    expect(targets(at(doc, FULL_SLOT.arp))).toEqual(moved);
    const steps = [
      ['macros.0.value', 0.1],
      ['macros.1.value', 0.3],
    ];
    const kick = at(doc, FULL_SLOT.kick).sequencer;
    const arp = at(doc, FULL_SLOT.arp).sequencer;
    expect(kick.kind === 'euclidean' && params(kick.modLanes)).toEqual(steps);
    expect(arp.kind === 'grid' && params(arp.lanes)).toEqual(steps);
    // The hat plays another patch: its lanes stay on the rows they named.
    expect(at(doc, FULL_SLOT.hat)).toEqual(at(new DocumentModel(DOC).doc, FULL_SLOT.hat));
  });

  it('removing the last macro takes only its own lanes', () => {
    const doc = afterRemoving(2);
    expect(targets(at(doc, FULL_SLOT.arp))).toEqual([
      [voiceTargetId('macros.0.value'), 0.1],
      [voiceTargetId('macros.1.value'), 0.2],
    ]);
    const arp = at(doc, FULL_SLOT.arp).sequencer;
    expect(arp.kind === 'grid' && params(arp.lanes)).toEqual([
      ['macros.0.value', 0.1],
      ['macros.1.value', 0.2],
    ]);
  });

  it('leaves a part with no lane on a moved macro out of the change', () => {
    const parts = macroRemovalParts(DOC, SHARED, 1);
    expect(Object.keys(parts).map(Number).sort()).toEqual([FULL_SLOT.kick, FULL_SLOT.arp].sort());
    expect(macroRemovalParts(DOC, SHARED, 2)[FULL_SLOT.drone]).toBeUndefined();
  });

  it('moves the step lanes of a region’s own pattern too', () => {
    const pattern = { ...FULL_PARTS.arp.sequencer, lanes: stepLanes(STEPS) } as RegionPattern;
    const region = { start: 0, duration: FULL_SONG_TICKS, pattern };
    const doc = { ...DOC, parts: [part(FULL_SLOT.arp, SHARED, { regions: [region] })] };
    const moved = macroRemovalParts(doc, SHARED, 0)[FULL_SLOT.arp]?.regions?.[0]?.pattern;
    expect(moved && 'lanes' in moved && params(moved.lanes)).toEqual([
      ['macros.0.value', 0.2],
      ['macros.1.value', 0.3],
    ]);
  });
});

/**
 * The console over `DOC` with the shared patch's arp selected: the Song tab
 * drawn once, then the Parts tab shown, and the editor the Parts tab hands
 * its cards, over the context's session.
 */
function partsOverDrawnSong() {
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(DOC),
    notify: () => undefined,
  });
  const renders = { parts: 0, song: 0 };
  ctx.addTab('parts', { hidden: false }, () => renders.parts++);
  ctx.addTab('song', { hidden: true }, () => renders.song++);
  ctx.parts.pick(FULL_SLOT.arp);
  ctx.activate('song');
  ctx.activate('parts');
  const editor: PatchEditor = {
    get patch() {
      return ctx.parts.patch;
    },
    push: () => void ctx.parts.push(),
    pushShared: (parts) => void ctx.parts.pushShared(parts),
    refresh: () => undefined,
  };
  return { ctx, editor, renders };
}

describe('a macro edit from the Parts tab puts the Song tab out of date', () => {
  it('a rename: the Song tab draws again when shown, its lanes titled by the new name', () => {
    const { ctx, editor, renders } = partsOverDrawnSong();
    expect(renders.song).toBe(1);
    commitMacros(editor, renameMacro(editor.patch.macros, 0, 'Accent'));
    expect(ctx.model.doc.patches?.[SHARED]?.macros[0]?.name).toBe('Accent');
    ctx.activate('song');
    expect(renders.song).toBe(2);
  });

  it('a removal: the patch and the moved lanes land as one change, and the Song tab draws again', () => {
    const { ctx, editor, renders } = partsOverDrawnSong();
    removeMacroAndItsLanes(editor, 1);
    expect(ctx.model.doc.patches?.[SHARED]?.macros.map((m) => m.name)).toEqual(['A', 'C']);
    expect(targets(at(ctx.model.doc, FULL_SLOT.arp))).toEqual([
      [voiceTargetId('macros.0.value'), 0.1],
      [voiceTargetId('macros.1.value'), 0.3],
    ]);
    ctx.activate('song');
    expect(renders.song).toBe(2);
  });

  it('a plain knob push leaves the Song tab as drawn', () => {
    const { ctx, renders } = partsOverDrawnSong();
    ctx.parts.patch.filter.cutoff = 1234;
    expect(ctx.parts.push()).toBe(true);
    ctx.activate('song');
    expect(renders.song).toBe(1);
  });
});
