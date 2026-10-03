/**
 * The insert rack's view state (windsor#173 decision 4): the page shown and
 * the fold, per chain and insert id (windsor#186), kept across renders and
 * following each insert wherever an edit, an undo or a redo puts it.
 */
import { describe, expect, it } from 'vitest';

import type { InsertSpec } from '@windsor/engine';
import {
  DEFAULT_ADVANCED_DRIVE,
  RETURNS,
  RETURN_NAMES,
  createInsertIdSource,
} from '@windsor/engine';
import { FieldNormaliser } from '@windsor/engine/song/arrangementFields';
import { normaliseInserts } from '@windsor/engine/inserts/insertRegistry';
import { addInsert, addInsertAtFront, moveInsert, removeInsert } from './insertEdits';
import type { RackView } from './insertRackModel';
import { OPEN_VIEW, emptyRack, insertIdAt, showPage, toggleFold, viewAt } from './insertRackModel';

/** A card's three pages, by name. */
const P = ['One', 'Two', 'Three'] as const;

describe('viewAt', () => {
  it('starts every insert on page 1, open', () => {
    expect(viewAt(emptyRack(), 3, 'x', P)).toEqual(OPEN_VIEW);
    expect(viewAt(emptyRack(), 'master', 'y', ['Only'])).toEqual(OPEN_VIEW);
  });

  it('shows the first page once the card no longer has the page kept', () => {
    const state = showPage(emptyRack(), 1, 'x', P, 2);
    expect(viewAt(state, 1, 'x', P).page).toBe(2);
    expect(viewAt(state, 1, 'x', ['One']).page).toBe(0);
    expect(viewAt(state, 1, 'x', []).page).toBe(0);
  });

  it('keeps a page by name when the pages around it change (windsor#174 decision 3)', () => {
    const multiband = ['Main', 'Stage 1', 'Stage 2', 'Stage 3', 'Mod'];
    const single = ['Main', 'Stage 1', 'Mod'];
    const onMod = showPage(emptyRack(), 1, 'x', multiband, 4);
    expect(viewAt(onMod, 1, 'x', single).page).toBe(2);
    const onStage3 = showPage(emptyRack(), 1, 'x', multiband, 3);
    expect(viewAt(onStage3, 1, 'x', single).page).toBe(0);
    expect(viewAt(onStage3, 1, 'x', multiband).page).toBe(3);
  });
});

describe('showPage and toggleFold', () => {
  it('set one insert and leave the others, and the argument, alone', () => {
    const start = emptyRack();
    const paged = showPage(start, 1, 'c', P, 1);
    const folded = toggleFold(paged, 1, 'a');
    expect(viewAt(folded, 1, 'c', P)).toEqual({ page: 1, folded: false });
    expect(viewAt(folded, 1, 'a', P)).toEqual({ page: 0, folded: true });
    expect(viewAt(folded, 1, 'b', P)).toEqual(OPEN_VIEW);
    expect(start.size).toBe(0);
    expect(viewAt(paged, 1, 'a', P)).toEqual(OPEN_VIEW);
  });

  it('keys by chain, so the same id on another chain is its own', () => {
    const state = toggleFold(emptyRack(), 'master', 'a');
    expect(viewAt(state, 'master', 'a', P).folded).toBe(true);
    expect(viewAt(state, 0, 'a', P).folded).toBe(false);
    expect(viewAt(state, 'b', 'a', P).folded).toBe(false);
  });

  it('opens a folded insert again, keeping its page', () => {
    const state = toggleFold(toggleFold(showPage(emptyRack(), 2, 'b', P, 2), 2, 'b'), 2, 'b');
    expect(viewAt(state, 2, 'b', P)).toEqual({ page: 2, folded: false });
  });

  it('forgets an insert that is back on page 1 and open', () => {
    expect(toggleFold(toggleFold(emptyRack(), 1, 'a'), 1, 'a').size).toBe(0);
    expect(showPage(showPage(emptyRack(), 1, 'a', P, 2), 1, 'a', P, 0).size).toBe(0);
  });
});

describe('insertIdAt', () => {
  it("reads an insert's own id", () => {
    const list = [
      { ...DEFAULT_ADVANCED_DRIVE, id: 'one' },
      { ...DEFAULT_ADVANCED_DRIVE, id: 'two' },
    ];
    expect([insertIdAt(list, 0), insertIdAt(list, 1)]).toEqual(['one', 'two']);
  });

  it('gives a send bus default chain the ids normalising gives it, so a save keeps its state', () => {
    for (const bus of RETURN_NAMES) {
      const code = RETURNS[bus].inserts;
      const saved = normaliseInserts(code, `returns.${bus}.inserts`, new FieldNormaliser());
      expect(insertIdAt(code, 0), bus).toBe(saved[0]!.id);
      // Adding to the code's chain keeps that id on the insert already there.
      expect(addInsert(code, 'drive', bus)[0]!.id, bus).toBe(saved[0]!.id);
    }
  });
});

/**
 * The acceptance case (windsor#186): two Advanced Drives in one chain, the
 * first folded and the second on Stage 1, through the rack's edits and an
 * undo and a redo of each. The chain is what the document holds after each
 * step, normalised as the console's model does; the undo stack is the
 * snapshots. The view state is never touched by the edits.
 */
describe('the view follows each insert through edits, undo and redo', () => {
  const STAGES = ['Main', 'Stage 1', 'Mod'];
  const ids = createInsertIdSource(186);
  const normalise = (list: readonly InsertSpec[]): InsertSpec[] =>
    normaliseInserts(list, 'master.inserts', new FieldNormaliser());
  const first = { ...DEFAULT_ADVANCED_DRIVE, drive: 3 };
  const second = { ...DEFAULT_ADVANCED_DRIVE, drive: 9 };

  /** The chain `chain` of `before`, set up: the first folded, the second on Stage 1. */
  function setUp(chain: string): { list: InsertSpec[]; view: RackView } {
    const list = normalise([first, second]);
    let view = toggleFold(emptyRack(), chain, insertIdAt(list, 0));
    view = showPage(view, chain, insertIdAt(list, 1), STAGES, 1);
    return { list, view };
  }

  /** Each insert's drive and view, in chain order. */
  const shown = (chain: string, list: readonly InsertSpec[], view: RackView): unknown[] =>
    list.map((spec, i) => [
      spec.kind === 'advanced-drive' ? spec.drive : spec.kind,
      viewAt(view, chain, insertIdAt(list, i), STAGES),
    ]);
  const FIRST = [3, { page: 0, folded: true }];
  const SECOND = [9, { page: 1, folded: false }];
  const FRESH = ['drive', OPEN_VIEW];

  const edits: Record<string, (list: readonly InsertSpec[]) => InsertSpec[]> = {
    swap: (list) => moveInsert(list, 0, 1),
    'add at the front': (list) => addInsertAtFront(list, 'drive', 'master', ids),
    'add at the back': (list) => addInsert(list, 'drive', 'master', ids),
    'remove the first': (list) => removeInsert(list, 0),
    'remove the second': (list) => removeInsert(list, 1),
  };
  const after: Record<string, unknown[]> = {
    swap: [SECOND, FIRST],
    'add at the front': [FRESH, FIRST, SECOND],
    'add at the back': [FIRST, SECOND, FRESH],
    'remove the first': [SECOND],
    'remove the second': [FIRST],
  };

  for (const chain of ['1', 'master', ...RETURN_NAMES]) {
    for (const [name, edit] of Object.entries(edits)) {
      it(`${name}, then undo, then redo, on chain ${chain}`, () => {
        const { list: before, view } = setUp(chain);
        const edited = normalise(edit(before));
        expect(shown(chain, edited, view)).toEqual(after[name]);
        // Undo and redo adopt the snapshots, ids and all.
        const undone = normalise(structuredClone(before));
        expect(shown(chain, undone, view)).toEqual([FIRST, SECOND]);
        const redone = normalise(structuredClone(edited));
        expect(shown(chain, redone, view)).toEqual(after[name]);
      });
    }
  }

  it('brings a removed insert back with its fold on undo, and shows it on no other insert', () => {
    const { list, view } = setUp('master');
    const removed = normalise(removeInsert(list, 0));
    const readded = normalise(addInsert(removed, 'advanced-drive', 'master', ids));
    expect(shown('master', readded, view)).toEqual([SECOND, [0, OPEN_VIEW]]);
    expect(shown('master', normalise(list), view)).toEqual([FIRST, SECOND]);
  });
});
