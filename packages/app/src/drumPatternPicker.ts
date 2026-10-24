/**
 * The Drum's Pattern picker (windsor#951; record `2026-10-24-drum-device`
 * decision 2): at the head of Play, the insert cards' preset picker
 * (`presetInsertCard.ts`), Custom first, then the engine's bank
 * (`DRUM_PATTERNS`) grouped as `DRUM_PATTERN_GROUPS` orders it. It shows
 * the pattern the steps and the length still are (`drumPatternOf`), or
 * Custom, and re-reads on every repaint of the strip, so an edit turns it
 * to Custom and an undo names the pattern again. A pick writes the
 * pattern's steps and length in one `ctx.change`, one undo step; Custom
 * writes nothing.
 */
import { DRUM_PATTERNS, DRUM_PATTERN_GROUPS } from '@windsor/engine';
import { type SelectGroup, groupedSelect } from './dom';
import { DRUM_TEXT } from './drumTables';
import type { KnobElement } from './knob';

/** What the picker reads and writes. */
export interface PatternPickerTarget {
  /** The bank id the line still is, or '' for Custom (`shownPattern`). */
  shown(): string;
  /** Write pattern `id` into the line. */
  pick(id: string): void;
}

/** The bank's groups as the select's `<optgroup>`s, in the picker's order. */
const GROUPS: readonly SelectGroup[] = DRUM_PATTERN_GROUPS.map((group) => ({
  group,
  options: DRUM_PATTERNS.filter((p) => p.group === group).map((p) => ({
    value: p.id,
    label: p.name,
  })),
}));

/** The Pattern field: its label over the select; `refresh` shows what the line is now. */
export function drumPatternPicker(target: PatternPickerTarget): KnobElement {
  const wrap = groupedSelect(
    DRUM_TEXT.pattern,
    [{ value: '', label: DRUM_TEXT.custom }, ...GROUPS],
    target.shown(),
    (id) => target.pick(id),
  ) as KnobElement;
  const select = wrap.querySelector('select');
  if (select) select.title = DRUM_TEXT.patternTitle;
  wrap.refresh = (): void => {
    if (select) select.value = target.shown();
  };
  return wrap;
}
