/**
 * The Parts tab's rail and mod panels (#70, ported): algorithm picker,
 * global knobs, filter, LFO and pitch envelope. All of it edits the working
 * patch (`patchState`) and pushes it to the live part. The knob specs are
 * `patchKnobTables.ts`; the thumbnail geometry `patchPanelConstants.ts`.
 */
import type { Algorithm } from '../../../packages/client/src/audio/index-for-editor';
import {
  ALGORITHMS,
  FILTER_MODE_NAMES,
  LFO_SHAPE_NAMES,
  OP_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import { ALG_LINK_COLOR, CARRIER_COLOR, INK_ON_ACCENT, MOD_COLOR } from './consoleColors';
import { $, el, seg } from './dom';
import { drawEnv, envAdvKnobs, envKnobs } from './envCanvas';
import { attachEnvelopeDrag } from './envelopeDrag';
import {
  FILTER_KNOBS,
  GLOBAL_KNOBS,
  LFO_KNOBS,
  LFO_TO_OP_KNOBS,
  PITCH_ENV_AMOUNT_KNOB,
  patchKnobOpts,
} from './patchKnobTables';
import { ALG_THUMB } from './patchPanelConstants';
import { getPath, hooks, partsState, pathKnob, pushPatch, setPath } from './patchState';

/**
 * Boolean globals, drawn as a two-button segment after the knobs — the shape
 * Slope and Phase use. `off`/`on` are the button faces; the field is a boolean
 * path in the working patch, so the table is what the test reads (#453).
 */
export const GLOBAL_TOGGLES: ReadonlyArray<{
  f: string;
  label: string;
  off: string;
  on: string;
}> = [{ f: 'mono', label: 'Voicing', off: 'Poly', on: 'Mono' }];

/** The segment index a toggle shows for the working patch. */
export const toggleIndex = (field: string): number =>
  getPath(partsState.patch, field) === true ? 1 : 0;

/** What pressing one of a toggle's two buttons writes. `pushPatch` commits it. */
export const writeToggle = (field: string, index: number): void =>
  setPath(partsState.patch, field, index === 1);

function algDepths(alg: Algorithm): number[] {
  const depth = OP_NAMES.map(() => -1);
  const queue: number[] = [];
  for (const c of alg.carriers) {
    depth[c] = 0;
    queue.push(c);
  }
  while (queue.length) {
    const i = queue.shift() ?? 0;
    for (const m of alg.mods[i] ?? []) {
      if (m === i) continue;
      if ((depth[m] ?? 0) < (depth[i] ?? 0) + 1) {
        depth[m] = (depth[i] ?? 0) + 1;
        queue.push(m);
      }
    }
  }
  return depth.map((d) => (d < 0 ? 0 : d));
}

function algSvg(alg: Algorithm): string {
  const { width: w, cell, pad, linkInset } = ALG_THUMB;
  const depth = algDepths(alg);
  const maxD = Math.max(...depth);
  const h = (maxD + 1) * cell + pad;
  const rows: number[][] = Array.from({ length: maxD + 1 }, () => []);
  OP_NAMES.forEach((_, i) => rows[depth[i] ?? 0]?.push(i));
  const pos: [number, number][] = [];
  rows.forEach((row, d) => {
    const y = h - pad - d * cell - cell / 2 + pad / 2;
    row.forEach((i, k) => {
      // Box centres in equal columns: (k + ½) / count, without the literal.
      pos[i] = [((2 * k + 1) / (2 * row.length)) * w, y];
    });
  });
  let svg = '';
  OP_NAMES.forEach((_, i) => {
    for (const m of alg.mods[i] ?? []) {
      if (m === i) continue;
      const [x1, y1] = pos[m] ?? [0, 0];
      const [x2, y2] = pos[i] ?? [0, 0];
      svg += `<line x1="${x1.toFixed(1)}" y1="${(y1 + linkInset).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2 - linkInset).toFixed(1)}" stroke="${ALG_LINK_COLOR}" stroke-width="1"></line>`;
    }
  });
  OP_NAMES.forEach((name, i) => {
    const isCar = alg.carriers.includes(i);
    const col = isCar ? CARRIER_COLOR : MOD_COLOR;
    const [x, y] = pos[i] ?? [0, 0];
    const opacity = isCar ? ALG_THUMB.carrierOpacity : ALG_THUMB.modulatorOpacity;
    svg +=
      `<rect x="${(x - ALG_THUMB.boxWidth / 2).toFixed(1)}" y="${(y - ALG_THUMB.boxHeight / 2).toFixed(1)}" width="${ALG_THUMB.boxWidth}" height="${ALG_THUMB.boxHeight}" rx="${ALG_THUMB.boxRadius}" fill="${col}" opacity="${opacity}"></rect>` +
      `<text x="${x.toFixed(1)}" y="${(y + ALG_THUMB.textDy).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="${ALG_THUMB.fontSize}" font-weight="500" fill="${isCar ? INK_ON_ACCENT : col}">${name}</text>`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${svg}</svg>`;
}

export function buildAlgPicker(): void {
  const grid = $('algGrid');
  grid.innerHTML = '';
  ALGORITHMS.forEach((alg, i) => {
    const b = el('button', 'alg') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === partsState.patch.algorithm));
    b.setAttribute('aria-label', `Algorithm ${i + 1}: ${alg.name}, ${alg.label}`);
    b.innerHTML = algSvg(alg) + `<span class="alg-no">${String(i + 1).padStart(2, '0')}</span>`;
    b.onclick = (): void => {
      partsState.patch.algorithm = i;
      pushPatch();
      hooks.refresh();
    };
    grid.appendChild(b);
  });
  const a = ALGORITHMS[partsState.patch.algorithm];
  if (a) {
    $('algName').innerHTML =
      `<strong style="color:var(--ink)">${a.name}</strong> &middot; <span style="font-family:var(--f-num)">${a.label}</span>` +
      `<br><span style="color:${CARRIER_COLOR}">&#9632;</span> carrier &nbsp; <span style="color:${MOD_COLOR}">&#9632;</span> modulator`;
  }
}

/**
 * A segmented control writing an index or boolean into the working patch:
 * `seg` over the index as a string, with `pushPatch` in the pick (#618).
 */
function indexSeg(
  names: readonly string[],
  current: () => number,
  write: (i: number) => void,
): HTMLElement {
  return seg(
    names.map((label, i) => ({ value: String(i), label })),
    () => String(current()),
    (value) => {
      write(Number(value));
      pushPatch();
    },
    MOD_COLOR,
  );
}

function labelledSeg(label: string, segment: HTMLElement): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'width:100%;margin-top:6px';
  wrap.appendChild(el('span', 'field-label', label));
  wrap.appendChild(segment);
  return wrap;
}

export function buildGlobal(): void {
  const row = $('globalKnobs');
  row.innerHTML = '';
  for (const k of GLOBAL_KNOBS) row.appendChild(pathKnob(k.f, k.label, patchKnobOpts(k)));
  for (const t of GLOBAL_TOGGLES) {
    const segment = indexSeg(
      [t.off, t.on],
      () => toggleIndex(t.f),
      (i) => writeToggle(t.f, i),
    );
    row.appendChild(labelledSeg(t.label, segment));
  }
}

export function buildFilter(): void {
  const segBox = $('filterMode');
  segBox.innerHTML = '';
  const filter = (): { mode: number; slope24: boolean } => partsState.patch.filter;
  segBox.appendChild(
    indexSeg(
      FILTER_MODE_NAMES,
      () => filter().mode,
      (i) => {
        filter().mode = i;
      },
    ),
  );
  const canvas = $('filtEnvCanvas') as HTMLCanvasElement;
  attachEnvelopeDrag(canvas, 'filter.env', MOD_COLOR);
  const redraw = (): void => drawEnv(canvas, partsState.patch.filter.env, MOD_COLOR);
  const row = $('filterKnobs');
  row.innerHTML = '';
  for (const k of FILTER_KNOBS)
    row.appendChild(pathKnob(k.f, k.label, { ...patchKnobOpts(k), color: MOD_COLOR }));
  const slopeSeg = indexSeg(
    ['12 dB', '24 dB'],
    () => (filter().slope24 ? 1 : 0),
    (i) => {
      filter().slope24 = i === 1;
    },
  );
  row.appendChild(labelledSeg('Slope', slopeSeg));
  const envRow = $('filterEnvKnobs');
  envRow.innerHTML = '';
  envRow.appendChild(envKnobs('filter.env', MOD_COLOR, redraw));
  envRow.appendChild(envAdvKnobs('filter.env', MOD_COLOR, redraw));
  requestAnimationFrame(redraw);
}

export function buildLfo(): void {
  const segBox = $('lfoShape');
  segBox.innerHTML = '';
  const lfo = (): { shape: number; retrigger: boolean } => partsState.patch.lfo;
  segBox.appendChild(
    indexSeg(
      LFO_SHAPE_NAMES,
      () => lfo().shape,
      (i) => {
        lfo().shape = i;
      },
    ),
  );
  const row = $('lfoKnobs');
  row.innerHTML = '';
  for (const k of [...LFO_KNOBS, ...LFO_TO_OP_KNOBS]) {
    row.appendChild(pathKnob(k.f, k.label, { ...patchKnobOpts(k), color: MOD_COLOR }));
  }
  const retrigSeg = indexSeg(
    ['Free', 'Retrigger'],
    () => (lfo().retrigger ? 1 : 0),
    (i) => {
      lfo().retrigger = i === 1;
    },
  );
  row.appendChild(labelledSeg('Phase', retrigSeg));
}

export function buildPitch(): void {
  const canvas = $('pitchEnvCanvas') as HTMLCanvasElement;
  attachEnvelopeDrag(canvas, 'pitchEnv', CARRIER_COLOR);
  const redraw = (): void => drawEnv(canvas, partsState.patch.pitchEnv, CARRIER_COLOR);
  const row = $('pitchKnobs');
  row.innerHTML = '';
  const amount = PITCH_ENV_AMOUNT_KNOB;
  row.appendChild(
    pathKnob(amount.f, amount.label, { ...patchKnobOpts(amount), color: CARRIER_COLOR }),
  );
  row.appendChild(envKnobs('pitchEnv', CARRIER_COLOR, redraw));
  requestAnimationFrame(redraw);
}
