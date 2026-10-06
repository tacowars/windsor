/**
 * A switch lane in the song format (windsor#628, record
 * `2026-10-06-insert-switch-lanes` decisions 2 and 7): a lane on an insert's
 * `enabled` is kept and round-trips; its values snap to 0 or 1 and its bends
 * to 0, each reported; it goes with its insert; and it changes nothing else
 * about a document, which keeps its version.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_LANES,
  AUTOMATION_TAPE_ID,
} from '../__fixtures__/automationSong';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import type { AutomationLane } from '../automation/automationLane';
import { formatTargetId } from '../automation/automationTargets';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { makeArrangement, type ArrangementDocument } from './arrangementDocument';

const { hat } = FULL_SLOT;
const SWITCH = formatTargetId({ kind: 'insert', insertId: AUTOMATION_TAPE_ID, field: 'enabled' });
const point = (tick: number, value: number, bend = 0) => ({ tick, value, bend });
/** On from the start, off over bar 2, on again from bar 3. */
const TOGGLE: AutomationLane = {
  target: SWITCH,
  on: true,
  points: [point(0, 1), point(TICKS_PER_BAR, 0), point(2 * TICKS_PER_BAR, 1)],
};

/** `AUTOMATION_DOCUMENT` with the hat's lanes and inserts edited. */
function withHat(edit: { automation?: unknown; inserts?: unknown }): ArrangementDocument {
  return {
    ...AUTOMATION_DOCUMENT,
    parts: AUTOMATION_DOCUMENT.parts.map((part) =>
      part.slot === hat
        ? {
            ...part,
            ...('automation' in edit ? { automation: edit.automation } : {}),
            strip: { ...part.strip, ...('inserts' in edit ? { inserts: edit.inserts } : {}) },
          }
        : part,
    ),
  } as ArrangementDocument;
}

const hatLanes = (document: ArrangementDocument) =>
  document.parts.find((part) => part.slot === hat)!.automation;

describe('a switch lane in the song', () => {
  it('is kept unchanged, and round-trips through export and import', () => {
    const result = makeArrangement(withHat({ automation: [...AUTOMATION_LANES, TOGGLE] }));
    expect(result.corrections).toEqual([]);
    expect(hatLanes(result.document)).toEqual([...AUTOMATION_LANES, TOGGLE]);
    const again = makeArrangement(JSON.parse(JSON.stringify(result.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(result.document);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
  });

  it('adds nothing else: without it, the document serialises as one that never had it', () => {
    const plain = makeArrangement(AUTOMATION_DOCUMENT).document;
    const switched = makeArrangement(withHat({ automation: [...AUTOMATION_LANES, TOGGLE] }));
    const dropped = withHat({ automation: hatLanes(switched.document)!.slice(0, -1) });
    expect(JSON.stringify(makeArrangement(dropped).document)).toBe(JSON.stringify(plain));
  });

  it('snaps 0.3 to 0 and 0.7 to 1, and a bend to 0, each with a correction', () => {
    const raw = { ...TOGGLE, points: [point(0, 0.7, 0.4), point(96, 0.3), point(192, 1, -1)] };
    const result = makeArrangement(withHat({ automation: [raw] }));
    expect(hatLanes(result.document)).toEqual([
      { ...TOGGLE, points: [point(0, 1), point(96, 0), point(192, 1)] },
    ]);
    const mine = result.corrections.filter((c) => c.includes('switch lane'));
    expect(mine).toHaveLength(4);
    expect(mine.filter((c) => c.includes('.value:'))).toHaveLength(2);
    expect(mine.filter((c) => c.includes('.bend:'))).toHaveLength(2);
  });

  it('keeps a lane with one point', () => {
    const one = { ...TOGGLE, points: [point(0, 0)] };
    const result = makeArrangement(withHat({ automation: [one] }));
    expect(result.corrections).toEqual([]);
    expect(hatLanes(result.document)).toEqual([one]);
  });

  it('fits a lane past the song’s end with the value it holds on the last tick', () => {
    const end = AUTOMATION_DOCUMENT.transport.bars * TICKS_PER_BAR;
    const long = { ...TOGGLE, points: [point(0, 1), point(end - 1, 0), point(end + 96, 1)] };
    const result = makeArrangement(withHat({ automation: [long] }));
    expect(hatLanes(result.document)).toEqual([
      { ...TOGGLE, points: [point(0, 1), point(end - 1, 0), point(end, 0)] },
    ]);
  });

  it('goes with its insert', () => {
    const inserts = AUTOMATION_DOCUMENT.parts
      .find((part) => part.slot === hat)!
      .strip.inserts!.filter((spec) => spec.id !== AUTOMATION_TAPE_ID);
    const result = makeArrangement(withHat({ automation: [TOGGLE], inserts }));
    expect(hatLanes(result.document)).toBeUndefined();
    expect(result.corrections.some((c) => c.includes(`no insert "${AUTOMATION_TAPE_ID}"`))).toBe(
      true,
    );
  });
});
