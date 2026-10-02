/**
 * The context's undo history (windsor#124) over fakes: a host that records
 * every live partial and can be told to refuse, and panels that are nothing
 * but a `hidden` flag. What the tests pin is one step per `change`, one per
 * gesture, the redo stack emptied by a new edit, the depth, refusals that
 * change nothing, `importDoc` clearing the history, the tab each step shows,
 * and that an undo reaches the engine as an ordinary live partial.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { ApplyResult, ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { RETURNS, TICKS_PER_BAR, makePatch, partAt, removePartChange } from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { withFilledInsertIds } from '@windsor/engine/__fixtures__/insertIds';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import type { BuildOptions, EngineHost } from './host';
import { library, loadPageLibrary } from './libraryModel';
import { addPartLive } from './partEdits';
import { newSong } from './songParts';
import { bpmChange } from './transportModel';
import { UNDO_DEPTH } from './undoConstants';

beforeAll(() => loadPageLibrary(library));

const TAB_IDS = ['parts', 'mixer', 'song', 'arrangement'] as const;

interface Console {
  ctx: AppContext<TabPanel>;
  model: DocumentModel;
  applied: DocumentPartial[];
  status: string[];
  builds: number;
  /** The options each build was handed, in order. */
  buildOptions: BuildOptions[];
  /** The tick the fake transport reads. */
  position: number;
  /** Set to make the host refuse every live partial from then on. */
  refusing: boolean;
  /** Set to make the host report a path it ignored in every live partial from then on. */
  ignoring: boolean;
  panels: Record<string, TabPanel>;
}

function openConsole(): Console {
  const c: Console = {
    ctx: null as unknown as AppContext<TabPanel>,
    model: new DocumentModel(newSong()),
    applied: [],
    status: [],
    builds: 0,
    buildOptions: [],
    position: 0,
    refusing: false,
    ignoring: false,
    panels: {},
  };
  const host: ContextHost = {
    apply: (partial): ApplyResult => {
      if (c.refusing) return { ok: false, ignored: [], error: 'nope' };
      c.applied.push(partial);
      return { ok: true, ignored: c.ignoring ? ['somewhere'] : [] };
    },
    build: (_document, options = {}) => {
      c.builds++;
      c.buildOptions.push(options);
      return Promise.resolve();
    },
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  c.ctx = new AppContext<TabPanel>({
    host: { ...host, transport: { position: () => c.position } } as unknown as EngineHost,
    model: c.model,
    notify: (message) => c.status.push(message),
  });
  for (const id of TAB_IDS) {
    c.panels[id] = { hidden: false };
    c.ctx.addTab(id, c.panels[id], () => {});
  }
  return c;
}

const level = (value: number): DocumentPartial => partChange(0, { strip: { level: value } });

/** Three different edits, and the document after each: index 0 is where it started. */
function threeEdits(c: Console): ArrangementDocument[] {
  const docs = [c.model.doc];
  for (const edit of [bpmChange(133), level(0.4), { harmony: { root: 5 } }]) {
    expect(c.ctx.change(edit).ok).toBe(true);
    docs.push(c.model.doc);
  }
  return docs;
}

describe('one step per change', () => {
  it('undoes three changes one at a time and redoes them, every document as it was', () => {
    const c = openConsole();
    const docs = threeEdits(c);
    for (const i of [2, 1, 0]) {
      expect(c.ctx.undo()).toBe(true);
      expect(c.model.doc).toStrictEqual(docs[i]);
    }
    expect(c.ctx.canUndo).toBe(false);
    expect(c.ctx.undo()).toBe(false);
    for (const i of [1, 2, 3]) {
      expect(c.ctx.redo()).toBe(true);
      expect(c.model.doc).toStrictEqual(docs[i]);
    }
    expect(c.ctx.canRedo).toBe(false);
    expect(c.ctx.redo()).toBe(false);
  });

  it('keeps the old document itself as the snapshot, which later edits never reach', () => {
    const c = openConsole();
    const first = c.model.doc;
    const copy = structuredClone(first);
    c.ctx.change(level(0.4));
    // The working patch is a clone the knobs write into; pushing it must not
    // leave the document sharing its objects.
    c.ctx.parts.patch = makePatch({ name: 'Edited' });
    c.ctx.parts.push();
    c.ctx.parts.patch.ops[0]!.level = 0.123;
    c.ctx.parts.patch.filter.cutoff = 1234;
    expect(first).toStrictEqual(copy);
    const preset = partAt(c.model.doc, 0)!.preset;
    expect(c.model.doc.patches?.[preset]?.ops[0]?.level).not.toBe(0.123);
    c.ctx.undo();
    c.ctx.undo();
    expect(c.model.doc).toStrictEqual(copy);
  });

  it('records nothing for a change that leaves the document as it was', () => {
    const c = openConsole();
    c.ctx.change(bpmChange(c.model.doc.transport.bpm));
    expect(c.ctx.canUndo).toBe(false);
  });

  it('names a step by its label, or by its sections when it has none', () => {
    const c = openConsole();
    c.ctx.change(level(0.4), 'Level');
    expect(c.ctx.undoLabel).toBe('Level');
    c.ctx.change(bpmChange(99));
    expect(c.ctx.undoLabel).toBe('Transport');
    c.ctx.undo();
    expect([c.ctx.undoLabel, c.ctx.redoLabel]).toEqual(['Level', 'Transport']);
  });

  it('empties the redo stack on a new change after an undo', () => {
    const c = openConsole();
    threeEdits(c);
    c.ctx.undo();
    c.ctx.undo();
    expect(c.ctx.canRedo).toBe(true);
    c.ctx.change(level(0.9));
    expect(c.ctx.canRedo).toBe(false);
    expect(c.ctx.redo()).toBe(false);
  });

  it(`keeps ${UNDO_DEPTH} steps: the ${UNDO_DEPTH + 1}st drops the oldest`, () => {
    const c = openConsole();
    const docs = [c.model.doc];
    for (let i = 1; i <= UNDO_DEPTH + 1; i++) {
      c.ctx.change(bpmChange(60 + i));
      docs.push(c.model.doc);
    }
    let undos = 0;
    while (c.ctx.undo()) undos++;
    expect(undos).toBe(UNDO_DEPTH);
    expect(c.model.doc).toStrictEqual(docs[1]);
  });

  it('tells its listeners when the history moves', () => {
    const c = openConsole();
    let calls = 0;
    const off = c.ctx.onHistoryChange(() => calls++);
    c.ctx.change(level(0.4));
    c.ctx.undo();
    c.ctx.redo();
    expect(calls).toBe(3);
    off();
    c.ctx.change(level(0.5));
    expect(calls).toBe(3);
  });
});

describe('a gesture is one step', () => {
  it('makes one step of fifty changes', () => {
    const c = openConsole();
    const start = c.model.doc;
    c.ctx.beginGesture('Level');
    for (let i = 1; i <= 50; i++) c.ctx.change(level(i / 100));
    expect(c.ctx.canUndo).toBe(false);
    c.ctx.endGesture();
    expect(c.ctx.undoLabel).toBe('Level');
    expect(c.ctx.undo()).toBe(true);
    expect(c.model.doc).toStrictEqual(start);
    expect(c.ctx.canUndo).toBe(false);
  });

  it('records nothing for a gesture with no net change', () => {
    const c = openConsole();
    const bpm = c.model.doc.transport.bpm;
    c.ctx.beginGesture('BPM');
    c.ctx.change(bpmChange(bpm + 10));
    c.ctx.change(bpmChange(bpm));
    c.ctx.endGesture();
    c.ctx.beginGesture('Nothing');
    c.ctx.endGesture();
    expect(c.ctx.canUndo).toBe(false);
  });

  it('counts nested begins and records only at the outermost end', () => {
    const c = openConsole();
    c.ctx.beginGesture('Outer');
    c.ctx.beginGesture('Inner');
    c.ctx.change(level(0.3));
    c.ctx.endGesture();
    expect(c.ctx.canUndo).toBe(false);
    c.ctx.change(level(0.2));
    c.ctx.endGesture();
    expect(c.ctx.undoLabel).toBe('Outer');
    c.ctx.undo();
    expect(c.ctx.canUndo).toBe(false);
    // An unmatched end is ignored.
    c.ctx.endGesture();
    expect(c.ctx.canRedo).toBe(true);
  });

  it('refuses to undo while a gesture is open', () => {
    const c = openConsole();
    c.ctx.change(level(0.4));
    c.ctx.beginGesture('Level');
    expect(c.ctx.undo()).toBe(false);
    c.ctx.endGesture();
    expect(c.ctx.undo()).toBe(true);
  });
});

describe('refusals and imports', () => {
  it('records nothing for a refused change', () => {
    const c = openConsole();
    c.refusing = true;
    expect(c.ctx.change(level(0.4)).ok).toBe(false);
    expect(c.ctx.canUndo).toBe(false);
  });

  it('leaves both stacks and the document as they were when an undo or a redo is refused', () => {
    const c = openConsole();
    threeEdits(c);
    c.ctx.undo();
    const doc = c.model.doc;
    c.refusing = true;
    expect(c.ctx.undo()).toBe(false);
    expect(c.ctx.redo()).toBe(false);
    expect(c.model.doc).toBe(doc);
    expect(c.status.at(-1)).toBe('refused: nope');
    c.refusing = false;
    expect(c.ctx.undo()).toBe(true);
    expect(c.ctx.redo()).toBe(true);
    expect(c.ctx.redo()).toBe(true);
    expect(c.ctx.canRedo).toBe(false);
  });

  it('clears both stacks on an import, and a gesture open across it records nothing', async () => {
    const c = openConsole();
    threeEdits(c);
    c.ctx.undo();
    c.ctx.beginGesture('Level');
    c.ctx.change(level(0.1));
    await c.ctx.importDoc(newSong());
    expect([c.ctx.canUndo, c.ctx.canRedo]).toEqual([false, false]);
    c.ctx.endGesture();
    expect(c.ctx.canUndo).toBe(false);
  });
});

describe('an undo is an ordinary live edit', () => {
  it('shows the tab each step was made on', () => {
    const c = openConsole();
    c.ctx.activate('mixer');
    c.ctx.change(level(0.4));
    c.ctx.activate('song');
    c.ctx.change(bpmChange(99));
    c.ctx.activate('arrangement');
    c.ctx.undo();
    expect(c.ctx.activeTab).toBe('song');
    c.ctx.undo();
    expect(c.ctx.activeTab).toBe('mixer');
    expect(TAB_IDS.filter((id) => !c.panels[id]?.hidden)).toEqual(['mixer']);
    c.ctx.activate('parts');
    c.ctx.redo();
    expect(c.ctx.activeTab).toBe('mixer');
    c.ctx.redo();
    expect(c.ctx.activeTab).toBe('song');
  });

  it('removes an added part through host.apply, never a rebuild, and brings it back', () => {
    const c = openConsole();
    const start = c.model.doc;
    expect(addPartLive(c.ctx)).toBe(1);
    const added = c.model.doc;
    const preset = partAt(added, 1)!.preset;
    c.ctx.undo();
    expect(c.applied.at(-1)).toEqual({ parts: { 1: null }, patches: { [preset]: null } });
    expect(c.model.doc).toStrictEqual(start);
    c.ctx.redo();
    expect(c.applied.at(-1)).toEqual({
      parts: { 1: partAt(added, 1) },
      patches: { [preset]: added.patches?.[preset] },
    });
    expect(c.model.doc).toStrictEqual(added);
    expect(c.builds).toBe(0);
  });

  it("undoes a send bus chain edit in one step, and a removed bus's defaults go live (windsor#172)", () => {
    const c = openConsole();
    c.ctx.change({ returns: { a: { inserts: [] } } });
    c.ctx.change({ returns: { a: { inserts: RETURNS.b.inserts } } });
    expect(c.ctx.undo()).toBe(true);
    expect(c.model.doc.returns?.a?.inserts).toEqual([]);
    expect(c.applied.at(-1)).toEqual({ returns: { a: { inserts: [] } } });
    expect(c.ctx.undo()).toBe(true);
    // The document loses the bus; the engine is sent what a system built without it plays.
    expect(c.model.doc.returns).toBeUndefined();
    expect(c.applied.at(-1)).toEqual(withFilledInsertIds({ returns: { a: RETURNS.a } }));
  });
});

describe('an undo restores the document exactly', () => {
  it('brings a removed middle part back in its place, rebuilding the live system', async () => {
    const c = openConsole();
    await c.ctx.importDoc(FULL_DOCUMENT);
    const start = c.model.doc;
    const slots = start.parts.map((part) => part.slot);
    expect(slots.indexOf(FULL_SLOT.hat)).toBeLessThan(slots.length - 1);
    expect(c.ctx.change(removePartChange(start, FULL_SLOT.hat)!).ok).toBe(true);
    const removed = c.model.doc;
    const [applied, builds] = [c.applied.length, c.builds];
    expect(c.ctx.undo()).toBe(true);
    expect(c.model.doc).toStrictEqual(start);
    expect(c.model.doc.parts.map((part) => part.slot)).toEqual(slots);
    // The slot merge would append the part, so the live system is rebuilt
    // from the snapshot instead of being sent a partial.
    expect([c.applied.length, c.builds]).toEqual([applied, builds + 1]);
    // Removing it again is an ordinary live partial.
    expect(c.ctx.redo()).toBe(true);
    expect(c.model.doc).toStrictEqual(removed);
    expect([c.applied.length, c.builds]).toEqual([applied + 1, builds + 1]);
  });

  it('takes a second return added beside another out of the document again', () => {
    const c = openConsole();
    c.ctx.change({ returns: { a: { level: 0.2 } } });
    const one = c.model.doc;
    expect(Object.keys(one.returns ?? {})).toEqual(['a']);
    c.ctx.change({ returns: { b: { level: 0.3 } } });
    const two = c.model.doc;
    expect(c.ctx.undo()).toBe(true);
    expect(c.model.doc).toStrictEqual(one);
    // The engine has no absent return: it is sent the one a system built without it plays.
    expect(c.applied.at(-1)).toEqual(withFilledInsertIds({ returns: { b: RETURNS.b } }));
    expect(c.ctx.redo()).toBe(true);
    expect(c.model.doc).toStrictEqual(two);
    expect(c.builds).toBe(0);
  });

  it('rebuilds the live system from the snapshot when the engine ignores part of an undo', () => {
    const c = openConsole();
    c.ctx.change(level(0.4));
    c.ignoring = true;
    expect(c.ctx.undo()).toBe(true);
    expect(c.builds).toBe(1);
    expect(c.status).toEqual([]);
  });
});

describe('an undo rebuild resumes from the bar (windsor#132)', () => {
  const BAR = TICKS_PER_BAR;
  const MID_BAR_3 = 2 * BAR + BAR / 2;

  it('hands an undo or redo rebuild the song tick the transport was at, looped or not', async () => {
    const c = openConsole();
    await c.ctx.importDoc(FULL_DOCUMENT);
    expect(c.buildOptions).toEqual([{}]);
    expect(c.ctx.change(removePartChange(c.model.doc, FULL_SLOT.hat)!).ok).toBe(true);
    c.position = MID_BAR_3;
    expect(c.ctx.undo()).toBe(true);
    expect(c.buildOptions.at(-1)).toEqual({ resumeAt: MID_BAR_3 });
    // A redo rebuilds only where the engine ignores some of it; the tick is
    // read in the song that was playing, however often it has looped.
    c.ignoring = true;
    c.position = 2 * c.model.doc.transport.bars * BAR + MID_BAR_3;
    expect(c.ctx.redo()).toBe(true);
    expect(c.buildOptions.at(-1)).toEqual({ resumeAt: MID_BAR_3 });
    // New song, like Import and the restore on reload, builds from the top.
    await c.ctx.importDoc(newSong());
    expect(c.buildOptions.at(-1)).toEqual({});
  });
});
