/**
 * The Parts tab's rail and its Shape & modulation deck (#70, ported): algorithm picker,
 * global knobs, drive (windsor#309), filter, LFO and pitch envelope. All of it edits the working
 * patch (`partsSession`) and pushes it to the live part. The knob specs are
 * `patchKnobTables.ts`; the thumbnail geometry `patchPanelConstants.ts`.
 */
import type { Algorithm } from '@windsor/engine';
import {
  ALGORITHMS,
  DRIVE_SHAPE_NAMES,
  FILTER_MODE,
  FILTER_MODE_NAMES,
  LFO_SHAPE_NAMES,
  OP_NAMES,
} from '@windsor/engine';
import { ALG_LINK_COLOR, CARRIER_COLOR, INK_ON_ACCENT, MOD_COLOR } from './consoleColors';
import { $, el, seg } from './dom';
import { knobTitle } from './knob';
import { drawEnv } from './envCanvas';
import { attachEnvelopeDrag } from './envelopeDrag';
import { envAdvKnobs, envKnobs, envLoopPicker } from './envelopeKnobs';
import {
  DRIVE_KNOBS,
  FILTER_KNOBS,
  GLOBAL_KNOBS,
  PITCH_ENV_ADV_KNOBS,
  PITCH_ENV_AMOUNT_KNOB,
  lfoKnobs,
  lfoToOpKnobs,
  lfoToRatioKnobs,
  lfoToWidthKnobs,
  patchKnobOpts,
  type LfoKey,
} from './patchKnobTables';
import { ALG_THUMB } from './patchPanelConstants';
import type { LfoSettings, Patch } from '@windsor/engine';
import type { PatchEditor } from './partsSession';
import { getPath, pathKnob, setPath } from './patchPath';

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
export const toggleIndex = (patch: Patch, field: string): number =>
  getPath(patch, field) === true ? 1 : 0;

/** What pressing one of a toggle's two buttons writes. The editor's push commits it. */
export const writeToggle = (patch: Patch, field: string, index: number): void =>
  setPath(patch, field, index === 1);

/** The LFO's Phase segment: a free-running phase, a reset at note-on, or one pass that holds. */
export const LFO_PHASE_NAMES = ['Free', 'Retrigger', 'One-shot'] as const;
const PHASE_RETRIGGER = 1;
const PHASE_ONE_SHOT = 2;

/** The Phase segment index an LFO shows: One-shot wins, since it implies the reset. */
export const lfoPhaseIndex = (lfo: LfoSettings): number => {
  if (lfo.oneShot) return PHASE_ONE_SHOT;
  return lfo.retrigger ? PHASE_RETRIGGER : 0;
};

/** What one Phase button writes: One-shot sets both flags, Free clears both, Retrigger clears `oneShot`. */
export function writeLfoPhase(lfo: LfoSettings, index: number): void {
  lfo.oneShot = index === PHASE_ONE_SHOT;
  lfo.retrigger = index !== 0;
}

/** The LFO's Range segment, over `unipolar`. */
export const LFO_RANGE_NAMES = ['Bipolar', 'Unipolar'] as const;

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

export function buildAlgPicker(editor: PatchEditor): void {
  const grid = $('algGrid');
  grid.innerHTML = '';
  ALGORITHMS.forEach((alg, i) => {
    const b = el('button', 'alg') as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === editor.patch.algorithm));
    b.setAttribute('aria-label', `Algorithm ${i + 1}: ${alg.name}, ${alg.label}`);
    b.innerHTML = algSvg(alg) + `<span class="alg-no">${String(i + 1).padStart(2, '0')}</span>`;
    b.onclick = (): void => {
      editor.patch.algorithm = i;
      editor.push();
      editor.refresh();
    };
    grid.appendChild(b);
  });
  const a = ALGORITHMS[editor.patch.algorithm];
  if (a) {
    $('algName').innerHTML =
      `<strong style="color:var(--ink)">${a.name}</strong> &middot; <span style="font-family:var(--f-num)">${a.label}</span>` +
      `<br><span style="color:${CARRIER_COLOR}">&#9632;</span> carrier &nbsp; <span style="color:${MOD_COLOR}">&#9632;</span> modulator`;
  }
}

/**
 * A segmented control writing an index or boolean into the working patch:
 * `seg` over the index as a string, with the editor's push in the pick (#618).
 */
function indexSeg(
  editor: PatchEditor,
  names: readonly string[],
  current: () => number,
  write: (i: number) => void,
): HTMLElement {
  return seg(
    names.map((label, i) => ({ value: String(i), label })),
    () => String(current()),
    (value) => {
      write(Number(value));
      editor.push();
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

export function buildGlobal(editor: PatchEditor): void {
  const row = $('globalKnobs');
  row.innerHTML = '';
  for (const k of GLOBAL_KNOBS) {
    row.appendChild(pathKnob(editor, k.f, k.label, patchKnobOpts(k)));
  }
  for (const t of GLOBAL_TOGGLES) {
    const segment = indexSeg(
      editor,
      [t.off, t.on],
      () => toggleIndex(editor.patch, t.f),
      (i) => writeToggle(editor.patch, t.f, i),
    );
    row.appendChild(labelledSeg(t.label, segment));
  }
}

/**
 * The Drive section's switch (windsor#309): `drive.on`, a boolean path drawn
 * as Off | On at the section's head, the way Filter's mode starts at Off.
 * Off, the engine runs no drive at all, and the controls stay editable.
 */
export const DRIVE_SWITCH = { f: 'drive.on', off: 'Off', on: 'On' } as const;

/** Whether the Drive section's controls show inactive: its switch is off. */
export const driveInactive = (patch: Patch): boolean => toggleIndex(patch, DRIVE_SWITCH.f) === 0;

/** The Drive section's Shape picker: the engine's labels, each at its `DRIVE_SHAPE` id. */
export const driveShapeOptions = (): { value: number; label: string }[] =>
  DRIVE_SHAPE_NAMES.map((label, value) => ({ value, label }));

/** The Shape picker, a select the way an operator's Wave is (`patchBays.ts`). */
function driveShapePicker(editor: PatchEditor): HTMLElement {
  const wrap = el('div', 'grow');
  wrap.appendChild(el('span', 'field-label', 'Shape'));
  const select = document.createElement('select');
  select.className = 'field';
  select.name = 'drive-shape';
  select.setAttribute('aria-label', 'Drive shape');
  for (const { value, label } of driveShapeOptions()) select.add(new Option(label, String(value)));
  select.value = String(editor.patch.drive.shape);
  select.onchange = (): void => {
    editor.patch.drive.shape = Number(select.value);
    editor.push();
  };
  wrap.appendChild(select);
  return wrap;
}

/**
 * The voice's drive stage (windsor#300): after the carriers and before the
 * filter, heard with the filter on or off, so its section stands before
 * Filter's. The Off | On switch, then Shape and the Drive, Bias and Tone
 * knobs, dimmed while the switch is off (windsor#309).
 */
export function buildDrive(editor: PatchEditor): void {
  const body = $('driveBody');
  const dim = (): void => {
    body.classList.toggle('off', driveInactive(editor.patch));
  };
  $('driveSwitch').replaceChildren(
    indexSeg(
      editor,
      [DRIVE_SWITCH.off, DRIVE_SWITCH.on],
      () => toggleIndex(editor.patch, DRIVE_SWITCH.f),
      (i) => {
        writeToggle(editor.patch, DRIVE_SWITCH.f, i);
        dim();
      },
    ),
  );
  dim();
  $('driveShape').replaceChildren(driveShapePicker(editor));
  const row = $('driveKnobs');
  row.innerHTML = '';
  for (const k of DRIVE_KNOBS) {
    row.appendChild(pathKnob(editor, k.f, k.label, { ...patchKnobOpts(k), color: MOD_COLOR }));
  }
}

/**
 * What the filter section shows in a mode (windsor#334): Formant tunes its
 * peaks from the vowel, so Cutoff and Slope do nothing there and give way to
 * Vowel; Acid, the diode ladder (windsor#573), has one slope of its own and
 * no vowel, so it shows Cutoff alone; every other mode is the reverse of
 * Formant. The modulation amounts stay in all.
 */
export const filterModeShows = (
  mode: number,
): { cutoff: boolean; slope: boolean; vowel: boolean } => {
  if (mode === FILTER_MODE.LADDER) return { cutoff: true, slope: false, vowel: false };
  const formant = mode === FILTER_MODE.FORMANT;
  return { cutoff: !formant, slope: !formant, vowel: formant };
};

/** The latest redraw of each deck envelope canvas, read by its one observer. */
const deckRedraws = new WeakMap<HTMLCanvasElement, () => void>();

/**
 * Redraw a deck envelope whenever its box changes size: the deck's wrap, a
 * window resize or a zoom changes its width with no patch change (record
 * `2026-10-03-parts-tab-layout` decision 9). The canvas outlives a rebuild,
 * so it gets one observer, which calls the newest redraw; it stops once the
 * tab is re-rendered and the canvas has left the document.
 */
function redrawOnResize(canvas: HTMLCanvasElement, redraw: () => void): void {
  const watched = deckRedraws.has(canvas);
  deckRedraws.set(canvas, redraw);
  if (watched) return;
  const resized = new ResizeObserver(() => {
    if (!canvas.isConnected) return resized.disconnect();
    if (canvas.clientWidth > 0) deckRedraws.get(canvas)?.();
  });
  resized.observe(canvas);
}

export function buildFilter(editor: PatchEditor): void {
  const segBox = $('filterMode');
  segBox.innerHTML = '';
  const filter = (): { mode: number; slope24: boolean } => editor.patch.filter;
  const shown: Partial<Record<'cutoff' | 'slope' | 'vowel', HTMLElement>> = {};
  const showMode = (): void => {
    const shows = filterModeShows(filter().mode);
    for (const [key, node] of Object.entries(shown))
      node.hidden = !shows[key as keyof typeof shows];
  };
  segBox.appendChild(
    indexSeg(
      editor,
      FILTER_MODE_NAMES,
      () => filter().mode,
      (i) => {
        filter().mode = i;
        showMode();
      },
    ),
  );
  const canvas = $('filtEnvCanvas') as HTMLCanvasElement;
  attachEnvelopeDrag(editor, canvas, 'filter.env', MOD_COLOR);
  const redraw = (): void => drawEnv(canvas, editor.patch.filter.env, MOD_COLOR);
  redrawOnResize(canvas, redraw);
  const row = $('filterKnobs');
  row.innerHTML = '';
  for (const k of FILTER_KNOBS) {
    const knob = pathKnob(editor, k.f, k.label, { ...patchKnobOpts(k), color: MOD_COLOR });
    if (k.f === 'filter.cutoff') shown.cutoff = knob;
    if (k.f === 'filter.vowel') shown.vowel = knob;
    row.appendChild(knob);
  }
  const slopeSeg = indexSeg(
    editor,
    ['12 dB', '24 dB'],
    () => (filter().slope24 ? 1 : 0),
    (i) => {
      filter().slope24 = i === 1;
    },
  );
  shown.slope = row.appendChild(labelledSeg('Slope', slopeSeg));
  showMode();
  const envRow = $('filterEnvKnobs');
  envRow.innerHTML = '';
  envRow.appendChild(envKnobs(editor, 'filter.env', MOD_COLOR, redraw));
  envRow.appendChild(envAdvKnobs(editor, 'filter.env', MOD_COLOR, redraw));
  requestAnimationFrame(redraw);
}

/** One LFO panel, `lfo` or `lfo2`: its shape, its knobs and the Phase and Range segments. */
export function buildLfo(editor: PatchEditor, key: LfoKey): void {
  const segBox = $(`${key}Shape`);
  segBox.innerHTML = '';
  const lfo = (): LfoSettings => editor.patch[key];
  segBox.appendChild(
    indexSeg(
      editor,
      LFO_SHAPE_NAMES,
      () => lfo().shape,
      (i) => {
        lfo().shape = i;
      },
    ),
  );
  const row = $(`${key}Knobs`);
  row.innerHTML = '';
  const knobs = [
    ...lfoKnobs(key),
    ...lfoToOpKnobs(key),
    ...lfoToWidthKnobs(key),
    ...lfoToRatioKnobs(key),
  ];
  for (const k of knobs) {
    const node = pathKnob(editor, k.f, k.label, { ...patchKnobOpts(k), color: MOD_COLOR });
    if (k.hint) node.title = knobTitle(k.hint);
    row.appendChild(node);
  }
  const phaseSeg = indexSeg(
    editor,
    LFO_PHASE_NAMES,
    () => lfoPhaseIndex(lfo()),
    (i) => writeLfoPhase(lfo(), i),
  );
  row.appendChild(labelledSeg('Phase', phaseSeg));
  const rangeSeg = indexSeg(
    editor,
    LFO_RANGE_NAMES,
    () => toggleIndex(editor.patch, `${key}.unipolar`),
    (i) => writeToggle(editor.patch, `${key}.unipolar`, i),
  );
  row.appendChild(labelledSeg('Range', rangeSeg));
}

export function buildPitch(editor: PatchEditor): void {
  const canvas = $('pitchEnvCanvas') as HTMLCanvasElement;
  attachEnvelopeDrag(editor, canvas, 'pitchEnv', CARRIER_COLOR);
  const redraw = (): void => drawEnv(canvas, editor.patch.pitchEnv, CARRIER_COLOR);
  redrawOnResize(canvas, redraw);
  const row = $('pitchKnobs');
  row.innerHTML = '';
  const amount = PITCH_ENV_AMOUNT_KNOB;
  row.appendChild(
    pathKnob(editor, amount.f, amount.label, { ...patchKnobOpts(amount), color: CARRIER_COLOR }),
  );
  row.appendChild(envKnobs(editor, 'pitchEnv', CARRIER_COLOR, redraw));
  row.appendChild(envAdvKnobs(editor, 'pitchEnv', CARRIER_COLOR, redraw, PITCH_ENV_ADV_KNOBS));
  row.appendChild(envLoopPicker(editor, 'pitchEnv', CARRIER_COLOR));
  requestAnimationFrame(redraw);
}
