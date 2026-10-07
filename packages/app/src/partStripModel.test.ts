import { MUSIC_PARTS_MAX } from '@windsor/engine';
import type { DocumentPart, SequencerKind } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  addPartTitle,
  canAddPart,
  canRemovePart,
  chipLabel,
  chipsOverflow,
  pageScrollTarget,
  removePartTitle,
  revealScrollLeft,
} from './partStripModel';

type ChipPart = Pick<DocumentPart, 'name' | 'sequencer' | 'colour'>;

const part = (name: string, kind: SequencerKind, colour = 0): ChipPart =>
  ({ name, sequencer: { kind }, colour }) as ChipPart;

describe('chipLabel', () => {
  it('names the part, numbers it from 1 with its kind, and takes the part’s own colour', () => {
    expect(chipLabel(part('Organ', 'chord', 1), 0)).toEqual({
      name: 'Organ',
      meta: '1 · Chord',
      tone: '#EDE36E',
    });
    expect(chipLabel(part('Machine', 'euclidean', 2), 7)).toEqual({
      name: 'Machine',
      meta: '8 · Euclid',
      tone: '#BC3D6D',
    });
    expect(chipLabel(part('Pad', 'none'), 15).meta).toBe('16 · None');
  });
});

describe('+ and −', () => {
  it.each([
    [1, true, false],
    [8, true, true],
    [16, false, true],
  ])('at %i parts: + %s, − %s', (count, add, remove) => {
    expect(MUSIC_PARTS_MAX).toBe(16);
    expect(canAddPart(count)).toBe(add);
    expect(canRemovePart(count)).toBe(remove);
  });

  it('titles them as the issue words them', () => {
    expect(addPartTitle(8)).toBe('Add a part (8 of 16)');
    expect(removePartTitle('Organ')).toBe('Remove Organ…');
  });
});

describe('the chip row’s scroll', () => {
  const fade = 22;
  const box = { scrollLeft: 0, clientWidth: 500, scrollWidth: 1200 };

  it('overflows when the chips at 70 px outgrow the strip, and fits again when they no longer do', () => {
    const fit = { count: 12, chipMinPx: 70, gapPx: 3, availablePx: 1000 };
    expect(chipsOverflow(fit)).toBe(false); // 12 × 70 + 11 × 3 = 873
    expect(chipsOverflow({ ...fit, count: 14 })).toBe(true); // 1019
    expect(chipsOverflow(fit)).toBe(false); // a part removed again
    expect(chipsOverflow({ ...fit, availablePx: 800 })).toBe(true); // the window narrowed
    expect(chipsOverflow(fit)).toBe(false); // and widened back
    expect(chipsOverflow({ ...fit, availablePx: 873 })).toBe(false);
  });

  it('pages by the box less both fades, clamped to the ends', () => {
    expect(pageScrollTarget(box, 1, fade)).toBe(456);
    expect(pageScrollTarget({ ...box, scrollLeft: 456 }, 1, fade)).toBe(700);
    expect(pageScrollTarget({ ...box, scrollLeft: 700 }, -1, fade)).toBe(244);
    expect(pageScrollTarget({ ...box, scrollLeft: 100 }, -1, fade)).toBe(0);
  });

  it('brings the selected chip clear of the fades, and leaves one in view alone', () => {
    expect(revealScrollLeft(box, { left: 100, width: 80 }, fade)).toBe(0);
    expect(revealScrollLeft(box, { left: 600, width: 80 }, fade)).toBe(202);
    expect(revealScrollLeft({ ...box, scrollLeft: 400 }, { left: 300, width: 80 }, fade)).toBe(278);
    expect(revealScrollLeft(box, { left: 1120, width: 80 }, fade)).toBe(700);
  });
});
