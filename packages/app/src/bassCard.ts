/**
 * The Basslead device (#707; a rack device with a step strip since
 * windsor#371, record `2026-10-01-sequencer-rack-devices` decisions 1–6 and
 * 9, look `docs/research/2026-09-30-sequencer-rack/bass.html`): the body
 * the Song pane's frame (`sequencerDevice.ts`) puts beside the shared rail,
 * at the device's one height, laid out as the Arp's. Two sections:
 *
 * - **Play**, the controls in columns: Pitch mode as a stack of three, then
 *   Fixed degree; Rate, Seed with Reseed as an icon, and Randomize; then,
 *   behind a rule, Octave, Length and Rotate, Vel, Acc vel and Acc mod, and
 *   Gate, Density and Root bias. Root bias is greyed and inert unless
 *   Follow Chord is on, and Fixed degree unless Fixed is on.
 * - **Steps**, the strip (`bassGrid.ts`): the rhythm the pitch mode plays.
 *
 * Every control writes the document through `ctx.change`, a pattern field
 * into the pane's selected region's pattern and the seed into the part's
 * (windsor#75); the pure rules are `bassModel.ts` and `bassGridModel.ts`.
 * The sizes are the Arp's `--arp-*` entries of `SEQUENCER_DEVICE_PX`.
 */
import type { BassPitchMode, BassSpec } from '@windsor/engine';
import { DEFAULT_BASS_CONFIG } from '@windsor/engine';
import { ICON_RESEED } from './arpCard';
import { BASS_DISABLED_OPACITY } from './bassConstants';
import { bassGrid } from './bassGrid';
import { BASS_KNOB_COLUMNS } from './bassGridConstants';
import {
  BASS_MODE_OPTIONS,
  bassControlsEnabled,
  fixedDegreeOptions,
  isBassPitchMode,
  reseedChange,
  seedFromText,
} from './bassModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { changePattern, patternOf } from './partEdits';
import { tableKnob } from './seqFields';
import type { DeviceBody } from './sequencerDevice';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { BASS_KNOBS, BASS_ROOT_BIAS_KNOB } from './sequencerKnobTables';
import { railIcon, railSvg } from './sequencerRail';

/** The part on `slot`, and the region whose pattern the card edits (windsor#75). */
interface BassTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

/** The region's bass spec, or the engine's defaults while the document is mid-change. */
function specOf({ ctx, slot, region }: BassTarget): BassSpec {
  const sequencer = patternOf(ctx.model.doc, slot, region);
  return sequencer?.kind === 'bass' ? sequencer : { kind: 'bass', ...DEFAULT_BASS_CONFIG };
}

/** A pattern field into the region's pattern; a `seed` goes to the part (`changePattern`). */
const send = (target: BassTarget, fields: Record<string, unknown>): boolean =>
  changePattern(target.ctx, target.slot, target.region, fields);

/** Dim and disable a mode-bound control the current mode ignores. */
function setEnabled(node: HTMLElement, enabled: boolean): void {
  node.inert = !enabled;
  node.setAttribute('aria-disabled', String(!enabled));
  node.style.opacity = enabled ? '' : BASS_DISABLED_OPACITY;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** The pattern's register octave: where the pitch mode's notes sound. */
function octave(target: BassTarget): HTMLElement {
  return makeKnob({
    ...octaveKnob('bass'),
    label: 'Octave',
    color: PITCH_COLOR,
    get: () => specOf(target).register.octave,
    // The Harmony tab's Octave knob writes the same field: it re-reads it when shown.
    set: (v) => {
      if (send(target, { register: { octave: v } })) target.ctx.invalidate();
    },
  });
}

function fixedDegreePicker(target: BassTarget): HTMLElement {
  const { fixedDegree } = specOf(target);
  const options = fixedDegreeOptions(target.ctx.model.doc.harmony, fixedDegree);
  return select('Fixed degree', options, String(fixedDegree), (v) => {
    send(target, { fixedDegree: Number(v) });
  });
}

function ratePicker(target: BassTarget): HTMLElement {
  return select('Rate', DIVISOR_OPTIONS, String(specOf(target).divisor), (v) => {
    if (send(target, { divisor: Number(v) })) target.ctx.render();
  });
}

/** The seed field, and Reseed as an icon beside it; either rebuilds the part, restarting its stream at once. */
function seedField(target: BassTarget): HTMLElement {
  const input = document.createElement('input');
  input.className = 'field';
  input.name = `bass-seed-${target.slot}`;
  input.inputMode = 'numeric';
  input.setAttribute('aria-label', 'Seed');
  const show = (): void => {
    input.value = String(specOf(target).seed);
  };
  input.onchange = (): void => {
    const seed = seedFromText(input.value);
    if (seed !== null && seed !== specOf(target).seed) send(target, { seed });
    show();
  };
  const reseed = railIcon(
    'A new seed: the part restarts its random stream now',
    'seq-icon bass-reseed',
  );
  reseed.setAttribute('aria-label', 'Reseed');
  reseed.appendChild(railSvg(ICON_RESEED, 'seq-icon-svg seq-line-icon'));
  reseed.onclick = (): void => {
    send(target, reseedChange());
    show();
  };
  show();
  const row = el('div', 'bass-seed');
  row.append(input, reseed);
  const wrap = el('div');
  wrap.append(el('span', 'field-label', 'Seed'), row);
  return wrap;
}

/** Pitch mode as a stack of three; `sync` greys the controls the new mode ignores. */
function pitchMode(target: BassTarget, sync: (mode: BassPitchMode) => void): HTMLElement {
  const modes = seg(
    BASS_MODE_OPTIONS,
    () => specOf(target).pitchMode,
    (mode) => {
      if (isBassPitchMode(mode) && send(target, { pitchMode: mode })) sync(mode);
    },
    PITCH_COLOR,
  );
  modes.classList.add('bass-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Pitch mode');
  const wrap = el('div');
  wrap.append(el('span', 'field-label', 'Pitch mode'), modes);
  return wrap;
}

/** The knob strip: Octave, Length and Rotate, then the table knobs in their columns. */
function knobStrip(
  target: BassTarget,
  grid: ReturnType<typeof bassGrid>,
  rootBias: HTMLElement,
): HTMLElement {
  const { ctx, slot, region } = target;
  const knob = (field: string): HTMLElement[] => {
    if (field === BASS_ROOT_BIAS_KNOB.f) return [rootBias];
    const entry = BASS_KNOBS.find((e) => e.f === field);
    return entry ? [tableKnob(ctx, slot, entry, PITCH_COLOR, region)] : [];
  };
  const strip = el('div', 'bass-knobs');
  strip.append(
    column('k3', [octave(target), grid.length, grid.rotate]),
    ...BASS_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
  );
  return strip;
}

/** The Play section: the pitch column, the rate and seed column, then the knob strip behind its rule. */
function controls(target: BassTarget, grid: ReturnType<typeof bassGrid>): HTMLElement {
  const { ctx, slot, region } = target;
  const rootBias = tableKnob(ctx, slot, BASS_ROOT_BIAS_KNOB, PITCH_COLOR, region);
  const fixedDegree = fixedDegreePicker(target);
  const sync = (mode: BassPitchMode): void => {
    const enabled = bassControlsEnabled(mode);
    setEnabled(rootBias, enabled.rootBias);
    setEnabled(fixedDegree, enabled.fixedDegree);
  };
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide bass-fields', [pitchMode(target, sync), fixedDegree]),
    column('wide bass-fields', [ratePicker(target), seedField(target), grid.randomize]),
    knobStrip(target, grid, rootBias),
  );
  sync(specOf(target).pitchMode);
  const section = el('div', 'seq-section play');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}

/** The device body for a `bass` part's region `region`: the controls and the strip. */
export function bassCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const target: BassTarget = { ctx, slot, region };
  const grid = bassGrid(ctx, slot, region);
  const body = el('div', 'seq-device-body bass-device');
  body.append(controls(target, grid), grid.section);
  return { body, fit: 'fixed' };
}
