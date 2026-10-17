/**
 * Spectre's card (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells` decision 11), four pages:
 *
 * - **Curves:** the three lanes in miniature (a press opens the workbench),
 *   the Starting point picker, Expand, and each curve's Shift (slide in
 *   octaves) and Offset (move in value). The drawing is the workbench's.
 * - **Time:** the delay curve's full scale (a division while synced, Time
 *   while free), the grid its bands snap to, Scatter, Spread, Freeze and its
 *   mode, Mix at the big dial and Output.
 * - **Spectrum:** the analysis (bands, overlap, window), what the selection
 *   follows, and the input modulation with its three amounts, named under
 *   the picker.
 * - **LFO:** shape and rate (a division while synced), and its three slots,
 *   each a destination and a depth.
 *
 * Every control commits the whole insert through `ctx.change`; the on/off
 * switch is the rack's rail.
 */
import {
  DEFAULT_SPECTRE,
  SPECTRE_BANDS,
  SPECTRE_DIVISIONS,
  SPECTRE_FOLLOWS,
  SPECTRE_FREEZE_MODES,
  SPECTRE_GRIDS,
  SPECTRE_LFO_DESTS,
  SPECTRE_LFO_SHAPES,
  SPECTRE_MOD_LABELS,
  SPECTRE_MODS,
  SPECTRE_OVERLAPS,
  SPECTRE_WINDOWS,
} from '@windsor/engine';
import type { SpectreSpec } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg } from './dom';
import type { InsertCard } from './insertCards';
import {
  bigInsertKnobs,
  insertFieldLock,
  insertKnob,
  insertKnobs,
  insertsOf,
  pickKnobs,
} from './insertKnobs';
import { insertNote, insertPage, insertRule, insertSelect, wideColumn } from './insertLayout';
import { targetChange } from './insertTarget';
import type { InsertTarget } from './insertTarget';
import { lockNotice } from './knobAutomation';
import type { KnobAutomation } from './knobAutomation';
import { followAutomation, paintLock, switchShowsOn } from './knobLock';
import { openSpectreBench } from './spectreBench';
import { SPECTRE_LFO_SLOT_NUMBERS } from './spectreBenchTables';
import { spectrePresetPicker } from './spectrePresetPicker';
import { spectreThumb } from './spectreThumb';
import {
  SPECTRE_KNOBS,
  SPECTRE_LABELS,
  SPECTRE_LFO_DEST_LABELS,
  SPECTRE_PAGES,
} from './spectreTables';

const SYNC_OPTIONS = [
  { value: 'on', label: 'Sync' },
  { value: 'off', label: 'Free' },
];

interface SpectreView {
  readonly ctx: AppCtx;
  current(): SpectreSpec;
  commit(next: SpectreSpec): void;
  readonly slot: InsertTarget;
  readonly index: number;
}

function spectreView(ctx: AppCtx, slot: InsertTarget, index: number): SpectreView {
  const current = (): SpectreSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'spectre' ? spec : DEFAULT_SPECTRE;
  };
  const commit = (next: SpectreSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'spectre') return;
    inserts[index] = next;
    ctx.change(targetChange(ctx, slot, inserts));
  };
  return { ctx, slot, index, current, commit };
}

const knobs = (
  view: SpectreView,
  fields: Parameters<typeof pickKnobs<SpectreSpec>>[1],
  draw?: () => void,
) => insertKnobs(view.ctx, view.slot, view.index, pickKnobs(SPECTRE_KNOBS, fields), draw);
const knob = (view: SpectreView, field: Parameters<typeof pickKnobs<SpectreSpec>>[1][number]) =>
  insertKnob(view.ctx, view.slot, view.index, pickKnobs(SPECTRE_KNOBS, [field])[0]!);

/** A picker over one of the spec's choices, each shown as `more.names` calls it (by default itself). */
function choice<K extends keyof SpectreSpec>(
  view: SpectreView,
  field: K,
  label: string,
  options: readonly string[],
  more: { readonly after?: () => void; readonly names?: Readonly<Record<string, string>> } = {},
): HTMLElement {
  const { after, names = {} } = more;
  return insertSelect({
    label,
    options: options.map((o) => [o, names[o] ?? o] as const),
    value: String(view.current()[field]),
    change: (value) => {
      view.commit({ ...view.current(), [field]: value });
      after?.();
    },
  });
}

/** Sync or Free, showing the synced picker or the free knob to match. */
function syncPair(
  view: SpectreView,
  field: 'sync' | 'lfoSync',
  synced: HTMLElement,
  free: HTMLElement,
): HTMLElement {
  const shows = (): void => {
    synced.hidden = !view.current()[field];
    free.hidden = view.current()[field];
  };
  const toggle = seg(
    SYNC_OPTIONS,
    () => (view.current()[field] ? 'on' : 'off'),
    (value) => {
      view.commit({ ...view.current(), [field]: value === 'on' });
      shows();
    },
    STRIP_COLOR,
  );
  shows();
  return wideColumn(toggle, synced, free);
}

/** Freeze: a latching button with a lamp; while a lane holds it, a press only says so. */
function freezeButton(view: SpectreView): HTMLElement {
  const lock = insertFieldLock(view.ctx, view.slot, view.index, 'freeze').automation;
  const lockNow = (): KnobAutomation | null => lock?.() ?? null;
  const button = document.createElement('button');
  button.className = 'bloom-freeze';
  button.type = 'button';
  button.append(el('i'), document.createTextNode('Freeze'));
  const render = (): void => {
    const held = lockNow();
    const on = switchShowsOn(view.current().freeze, held);
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? SPECTRE_LABELS.freezeOn : SPECTRE_LABELS.freezeOff;
    paintLock(button, held);
  };
  button.onclick = (): void => {
    const held = lockNow();
    if (held) {
      view.ctx.notify(lockNotice('Spectre Freeze', held));
      return;
    }
    view.commit({ ...view.current(), freeze: !view.current().freeze });
    render();
  };
  render();
  if (lock) followAutomation(button, lockNow, render);
  return button;
}

/** The workbench over this insert; the card redraws when it closes. */
function openBench(view: SpectreView, from: HTMLElement, closed: () => void): void {
  openSpectreBench({
    ...view,
    accent: getComputedStyle(from).getPropertyValue('--kc').trim(),
    closed: () => {
      closed();
      view.ctx.render();
    },
  });
}

function curvesPage(view: SpectreView): HTMLElement {
  const picker = spectrePresetPicker(view.current, view.commit);
  const thumb = spectreThumb(view.current, () => openBench(view, thumb.element, thumb.draw));
  const expand = seg(
    [{ value: 'wide', label: '⤢ Expand' }],
    () => '',
    () => openBench(view, thumb.element, thumb.draw),
    STRIP_COLOR,
  );
  expand.classList.add('spectre-expand');
  expand.title = SPECTRE_LABELS.expand;
  const result = insertPage(
    thumb.element,
    wideColumn(picker.root, expand),
    ...knobs(
      view,
      ['gainShift', 'gainOffset', 'delayShift', 'delayOffset', 'feedbackShift', 'feedbackOffset'],
      () => {
        thumb.draw();
        picker.refresh();
      },
    ),
  );
  result.classList.add('spectre-page');
  return result;
}

function timePage(view: SpectreView): HTMLElement {
  const division = choice(view, 'division', SPECTRE_LABELS.division, SPECTRE_DIVISIONS);
  return insertPage(
    syncPair(view, 'sync', division, knob(view, 'timeMs')),
    wideColumn(choice(view, 'grid', SPECTRE_LABELS.grid, SPECTRE_GRIDS)),
    insertRule(),
    ...knobs(view, ['scatter', 'spread']),
    wideColumn(
      freezeButton(view),
      choice(view, 'freezeMode', SPECTRE_LABELS.freezeMode, SPECTRE_FREEZE_MODES, {
        names: { hold: 'Hold', carve: 'Carve' },
      }),
    ),
    insertRule(),
    ...bigInsertKnobs(view.ctx, view.slot, view.index, pickKnobs(SPECTRE_KNOBS, ['mix'])),
    ...knobs(view, ['outputDb']),
  );
}

function spectrumPage(view: SpectreView): HTMLElement {
  const names = insertNote('');
  const label = (): void => {
    const [a, b, c] = SPECTRE_MOD_LABELS[view.current().mod];
    names.textContent = [a, b, c].map((n, i) => `${'ABC'[i]} ${n || '—'}`).join(' · ');
  };
  label();
  return insertPage(
    wideColumn(
      choice(view, 'bands', SPECTRE_LABELS.bands, SPECTRE_BANDS),
      choice(view, 'overlap', SPECTRE_LABELS.overlap, SPECTRE_OVERLAPS),
      choice(view, 'window', SPECTRE_LABELS.window, SPECTRE_WINDOWS),
    ),
    wideColumn(
      choice(view, 'follow', SPECTRE_LABELS.follow, SPECTRE_FOLLOWS, {
        names: { off: 'Off', key: 'Key', chord: 'Chord' },
      }),
    ),
    insertRule(),
    wideColumn(choice(view, 'mod', SPECTRE_LABELS.mod, SPECTRE_MODS, { after: label }), names),
    ...knobs(view, ['modA', 'modB', 'modC']),
  );
}

type LfoSlot = (typeof SPECTRE_LFO_SLOT_NUMBERS)[number];

/** One LFO slot: its destination over its depth. */
function lfoSlot(view: SpectreView, slot: LfoSlot): HTMLElement {
  const dest = choice(
    view,
    `lfoDest${slot}`,
    `${SPECTRE_LABELS.lfoDest} ${slot}`,
    SPECTRE_LFO_DESTS,
    {
      names: SPECTRE_LFO_DEST_LABELS,
    },
  );
  return wideColumn(dest, ...knobs(view, [`lfoDepth${slot}`]));
}

function lfoPage(view: SpectreView): HTMLElement {
  const division = choice(view, 'lfoDivision', SPECTRE_LABELS.lfoDivision, SPECTRE_DIVISIONS);
  return insertPage(
    wideColumn(choice(view, 'lfoShape', SPECTRE_LABELS.lfoShape, SPECTRE_LFO_SHAPES)),
    syncPair(view, 'lfoSync', division, knob(view, 'lfoHz')),
    insertRule(),
    ...SPECTRE_LFO_SLOT_NUMBERS.map((slot) => lfoSlot(view, slot)),
  );
}

const PAGES = [curvesPage, timePage, spectrumPage, lfoPage];

export const spectreCard: InsertCard = (ctx, slot, index) => {
  const view = spectreView(ctx, slot, index);
  return SPECTRE_PAGES.map((name, i) => ({ name, build: () => PAGES[i]!(view) }));
};
