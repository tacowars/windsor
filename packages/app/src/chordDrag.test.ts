/**
 * Pressing and dragging a chip (#607): a press auditions, a release under the
 * threshold is only that, a drag past it stops the audition and paints a
 * ghost, a release over a step applies and a release elsewhere applies
 * nothing, and cancel clears the ghost. All through fakes; no browser.
 */
import { describe, expect, it } from 'vitest';

import { CHORD_DRAG_THRESHOLD_PX } from './chordConstants';
import { type ChordDragHost, type ChordDragPaint, createChordDrag } from './chordDrag';
import type { ChordPayload } from './chordStepModel';

/** A picker at x < 50 with steps 0 and 1 at x 100 and 200 and the append zone at 300. */
class FakeCard implements ChordDragHost {
  readonly frames: (ChordDragPaint | null)[] = [];
  readonly applied: { payload: ChordPayload; index: number }[] = [];
  readonly sounds: string[] = [];

  targetAt(x: number): number | null {
    return ({ 100: 0, 200: 1, 300: 2 } as Record<number, number>)[x] ?? null;
  }
  paint(state: ChordDragPaint | null): void {
    this.frames.push(state);
  }
  apply(payload: ChordPayload, index: number): void {
    this.applied.push({ payload, index });
  }
  audition(payload: ChordPayload): void {
    this.sounds.push(`on:${payload.kind === 'chord' ? payload.degree : 'rest'}`);
  }
  silence(): void {
    this.sounds.push('off');
  }
}

const CHIP: ChordPayload = { kind: 'chord', degree: 3, size: 3 };
const PAST = CHORD_DRAG_THRESHOLD_PX + 1;

describe('chordDrag', () => {
  it('a press then a release under the threshold is an audition and nothing else', () => {
    const card = new FakeCard();
    const drag = createChordDrag(card);
    drag.down(CHIP, 10, 10);
    expect(card.sounds).toEqual(['on:3']);
    drag.move(12, 11);
    expect(drag.dragging).toBe(false);
    drag.up(12, 11);
    expect(card.sounds).toEqual(['on:3', 'off']);
    expect(card.frames).toEqual([]);
    expect(card.applied).toEqual([]);
  });

  it('past the threshold the audition stops and a ghost follows the pointer', () => {
    const card = new FakeCard();
    const drag = createChordDrag(card);
    drag.down(CHIP, 10, 10);
    drag.move(10 + PAST, 10);
    expect(drag.dragging).toBe(true);
    expect(card.sounds).toEqual(['on:3', 'off']);
    expect(card.frames).toEqual([{ payload: CHIP, over: null, x: 10 + PAST, y: 10 }]);
    drag.move(100, 40);
    expect(card.frames.at(-1)).toEqual({ payload: CHIP, over: 0, x: 100, y: 40 });
  });

  it('a release over a step applies it; over nothing applies nothing; both clear the ghost', () => {
    const card = new FakeCard();
    const drag = createChordDrag(card);
    drag.down(CHIP, 10, 10);
    drag.move(200, 10);
    drag.up(200, 10);
    expect(card.applied).toEqual([{ payload: CHIP, index: 1 }]);
    expect(card.frames.at(-1)).toBeNull();
    expect(drag.dragging).toBe(false);

    drag.down({ kind: 'rest' }, 10, 10);
    drag.move(300, 10);
    drag.up(50, 10);
    expect(card.applied).toHaveLength(1);
    expect(card.frames.at(-1)).toBeNull();
    // The rest tile auditions nothing audible but is balanced all the same.
    expect(card.sounds).toEqual(['on:3', 'off', 'on:rest', 'off']);
  });

  it('a release on the append zone applies with the list’s length as the index', () => {
    const card = new FakeCard();
    const drag = createChordDrag(card);
    drag.down(CHIP, 10, 10);
    drag.move(300, 10);
    drag.up(300, 10);
    expect(card.applied).toEqual([{ payload: CHIP, index: 2 }]);
  });

  it('cancel clears the ghost and the sound; a second press ends the first', () => {
    const card = new FakeCard();
    const drag = createChordDrag(card);
    drag.down(CHIP, 10, 10);
    drag.move(100, 10);
    drag.cancel();
    expect(card.frames.at(-1)).toBeNull();
    expect(drag.dragging).toBe(false);
    drag.up(100, 10);
    expect(card.applied).toEqual([]);

    drag.down(CHIP, 10, 10);
    drag.down({ kind: 'chord', degree: 5, size: 4 }, 10, 10);
    expect(card.sounds.slice(-3)).toEqual(['on:3', 'off', 'on:5']);
    drag.cancel();
    expect(card.sounds.at(-1)).toBe('off');
    drag.cancel();
    expect(card.sounds.filter((s) => s === 'off')).toHaveLength(3);
  });
});
