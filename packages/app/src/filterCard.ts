/**
 * The Filter insert's card (windsor#622), on one page: the mode as the
 * Parts page names it (LP, HP, BP, Notch, Acid) with the slope below it,
 * hidden in Acid as the Parts page hides it (`filterModeShows`), then Cutoff
 * at the rack's big dial and Reso and Mix. The on/off switch is the rack's
 * rail. Each control commits the whole insert through `ctx.change`.
 */
import {
  DEFAULT_FILTER,
  FILTER_MODE_NAMES,
  FILTER_MODE_VOICE_IDS,
  FILTER_MODES,
} from '@windsor/engine';
import type { FilterSpec } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg } from './dom';
import type { InsertCard } from './insertCards';
import { FILTER_INSERT_KNOBS } from './insertKnobTables';
import { bigInsertKnobs, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { fitColumn, insertPage } from './insertLayout';
import { insertChange } from './insertTarget';
import type { InsertTarget } from './insertTarget';
import { filterModeShows } from './patchPanels';

/** Each mode's name on the Parts page, by the voice's id for it. */
const MODE_OPTIONS = FILTER_MODES.map((mode, i) => ({
  value: mode,
  label: FILTER_MODE_NAMES[FILTER_MODE_VOICE_IDS[i]!]!,
}));
const SLOPE_OPTIONS = [
  { value: '12', label: '12 dB' },
  { value: '24', label: '24 dB' },
];

/** Whether `mode` plays a slope: every SVF mode does, Acid has its own. */
const showsSlope = (mode: FilterSpec['mode']): boolean =>
  filterModeShows(FILTER_MODE_VOICE_IDS[FILTER_MODES.indexOf(mode)]!).slope;

/** A segment with its small label above it. */
function labelled(label: string, segment: HTMLElement): HTMLElement {
  // A plain box, not `.field-wrap`, whose `display: flex` would outrank `hidden`.
  const wrap = el('div');
  wrap.append(el('span', 'field-label', label), segment);
  return wrap;
}

function page(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement {
  const current = (): FilterSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'filter' ? spec : DEFAULT_FILTER;
  };
  const commit = (next: FilterSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'filter') return;
    inserts[index] = next;
    ctx.change(insertChange(slot, inserts));
  };
  const slope = labelled(
    'Slope',
    seg(
      SLOPE_OPTIONS,
      () => (current().slope24 ? '24' : '12'),
      (value) => commit({ ...current(), slope24: value === '24' }),
      STRIP_COLOR,
    ),
  );
  slope.hidden = !showsSlope(current().mode);
  const mode = labelled(
    'Mode',
    seg(
      MODE_OPTIONS,
      () => current().mode,
      (value) => {
        commit({ ...current(), mode: value as FilterSpec['mode'] });
        slope.hidden = !showsSlope(current().mode);
      },
      STRIP_COLOR,
    ),
  );
  return insertPage(
    fitColumn(mode, slope),
    ...bigInsertKnobs(ctx, slot, index, pickKnobs(FILTER_INSERT_KNOBS, ['cutoff'])),
    ...insertKnobs(ctx, slot, index, pickKnobs(FILTER_INSERT_KNOBS, ['resonance', 'mix'])),
  );
}

export const filterCard: InsertCard = (ctx, slot, index) => [
  { name: 'Filter', build: () => page(ctx, slot, index) },
];
