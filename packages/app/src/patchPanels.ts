/**
 * The Parts tab's rail and mod panels (#70, ported): algorithm picker,
 * global knobs, filter, LFO and pitch envelope. All of it edits the working
 * patch (`patchState`) and pushes it to the live part.
 */
import type { Algorithm } from '../../../packages/client/src/audio/index-for-editor';
import {
  ALGORITHMS,
  FILTER_MODE_NAMES,
  LFO_SHAPE_NAMES,
  OP_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import { $, el, fmt2, fmtHz, fmtMs, fmtSigned } from './dom';
import { drawEnv, envAdvKnobs, envKnobs } from './envCanvas';
import { getPath, hooks, partsState, pathKnob, pushPatch, setPath } from './patchState';

export const CARRIER_COLOR = '#E0A44E';
export const MOD_COLOR = '#5FA8A0';

type KnobOpts = Parameters<typeof pathKnob>[2];
type KnobTable = ReadonlyArray<{ f: string; label: string; o: KnobOpts }>;

const GLOBAL_KNOBS: KnobTable = [
  { f: 'volume', label: 'Volume', o: { min: 0, max: 1.5, def: 0.8, fmt: fmt2 } },
  { f: 'tone', label: 'Tone', o: { min: 0.02, max: 1, def: 1, fmt: fmt2 } },
  { f: 'glide', label: 'Glide', o: { min: 0, max: 2, def: 0, curve: 'log', fmt: fmtMs } },
  {
    f: 'spread',
    label: 'Spread',
    o: { min: 0, max: 50, def: 0, step: 1, fmt: (v) => `${v.toFixed(0)}c` },
  },
  { f: 'pan', label: 'Pan', o: { min: -1, max: 1, def: 0, fmt: fmtSigned } },
  { f: 'panRandom', label: 'Pan Rnd', o: { min: 0, max: 1, def: 0, fmt: fmt2 } },
];

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

const FILTER_KNOBS: KnobTable = [
  {
    f: 'filter.cutoff',
    label: 'Cutoff',
    o: { min: 30, max: 18000, def: 8000, curve: 'log', fmt: fmtHz },
  },
  {
    f: 'filter.resonance',
    label: 'Reso',
    o: { min: 0.5, max: 12, def: 0.707, curve: 'log', fmt: fmt2 },
  },
  { f: 'filter.drive', label: 'Drive', o: { min: 1, max: 6, def: 1, fmt: fmt2 } },
  { f: 'filter.envAmount', label: 'Env Amt', o: { min: -6, max: 6, def: 0, fmt: fmtSigned } },
  { f: 'filter.lfoAmount', label: 'LFO Amt', o: { min: -4, max: 4, def: 0, fmt: fmtSigned } },
  { f: 'filter.keyTrack', label: 'Key Trk', o: { min: -1, max: 2, def: 0, fmt: fmtSigned } },
];

const LFO_KNOBS: KnobTable = [
  {
    f: 'lfo.rate',
    label: 'Rate',
    o: { min: 0.02, max: 40, def: 5, curve: 'log', fmt: (v) => `${v.toFixed(2)}H` },
  },
  { f: 'lfo.amount', label: 'Amount', o: { min: 0, max: 1, def: 0, fmt: fmt2 } },
  { f: 'lfo.delay', label: 'Fade In', o: { min: 0, max: 6, def: 0, curve: 'log', fmt: fmtMs } },
  {
    f: 'lfo.toPitch',
    label: 'To Pitch',
    o: { min: 0, max: 12, def: 0, fmt: (v) => `${v.toFixed(2)}st` },
  },
];

function algDepths(alg: Algorithm): number[] {
  const depth = [-1, -1, -1, -1];
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

function algSvg(alg: Algorithm, w = 58, cell = 15): string {
  const depth = algDepths(alg);
  const maxD = Math.max(...depth);
  const h = (maxD + 1) * cell + 4;
  const rows: number[][] = Array.from({ length: maxD + 1 }, () => []);
  for (let i = 0; i < 4; i++) rows[depth[i] ?? 0]?.push(i);
  const pos: [number, number][] = [];
  rows.forEach((row, d) => {
    const y = h - 4 - d * cell - cell / 2 + 2;
    row.forEach((i, k) => {
      pos[i] = [((k + 0.5) / row.length) * w, y];
    });
  });
  let svg = '';
  for (let i = 0; i < 4; i++) {
    for (const m of alg.mods[i] ?? []) {
      if (m === i) continue;
      const [x1, y1] = pos[m] ?? [0, 0];
      const [x2, y2] = pos[i] ?? [0, 0];
      svg += `<line x1="${x1.toFixed(1)}" y1="${(y1 + 4).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2 - 4).toFixed(1)}" stroke="#4A565C" stroke-width="1"></line>`;
    }
  }
  for (let i = 0; i < 4; i++) {
    const isCar = alg.carriers.includes(i);
    const col = isCar ? CARRIER_COLOR : MOD_COLOR;
    const [x, y] = pos[i] ?? [0, 0];
    svg +=
      `<rect x="${(x - 7).toFixed(1)}" y="${(y - 4.5).toFixed(1)}" width="14" height="9" rx="1.5" fill="${col}" opacity="${isCar ? 0.9 : 0.32}"></rect>` +
      `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="7" font-weight="500" fill="${isCar ? '#14181A' : col}">${OP_NAMES[i]}</text>`;
  }
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

export function buildGlobal(): void {
  const row = $('globalKnobs');
  row.innerHTML = '';
  for (const k of GLOBAL_KNOBS) row.appendChild(pathKnob(k.f, k.label, k.o));
  for (const t of GLOBAL_TOGGLES) {
    const seg = patchSeg(
      [t.off, t.on],
      () => toggleIndex(t.f),
      (i) => writeToggle(t.f, i),
    );
    row.appendChild(labelledSeg(t.label, seg));
  }
}

/** A segmented control writing an index or boolean into the working patch. */
function patchSeg(
  names: readonly string[],
  current: () => number,
  write: (i: number) => void,
): HTMLElement {
  const box = el('div', 'seg');
  box.style.setProperty('--seg-color', MOD_COLOR);
  names.forEach((name, i) => {
    const b = el('button', '', name) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(current() === i));
    b.onclick = (): void => {
      write(i);
      [...box.children].forEach((c, ci) => c.setAttribute('aria-pressed', String(ci === i)));
      pushPatch();
    };
    box.appendChild(b);
  });
  return box;
}

function labelledSeg(label: string, seg: HTMLElement): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'width:100%;margin-top:6px';
  wrap.appendChild(el('span', 'field-label', label));
  wrap.appendChild(seg);
  return wrap;
}

export function buildFilter(): void {
  const segBox = $('filterMode');
  segBox.innerHTML = '';
  const filter = (): { mode: number; slope24: boolean } => partsState.patch.filter;
  segBox.appendChild(
    patchSeg(
      FILTER_MODE_NAMES,
      () => filter().mode,
      (i) => {
        filter().mode = i;
      },
    ),
  );
  const canvas = $('filtEnvCanvas') as HTMLCanvasElement;
  const redraw = (): void => drawEnv(canvas, partsState.patch.filter.env, MOD_COLOR);
  const row = $('filterKnobs');
  row.innerHTML = '';
  for (const k of FILTER_KNOBS)
    row.appendChild(pathKnob(k.f, k.label, { ...k.o, color: MOD_COLOR }));
  const slopeSeg = patchSeg(
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
    patchSeg(
      LFO_SHAPE_NAMES,
      () => lfo().shape,
      (i) => {
        lfo().shape = i;
      },
    ),
  );
  const row = $('lfoKnobs');
  row.innerHTML = '';
  for (const k of LFO_KNOBS) row.appendChild(pathKnob(k.f, k.label, { ...k.o, color: MOD_COLOR }));
  for (let i = 0; i < 4; i++) {
    row.appendChild(
      pathKnob(`lfo.toOp.${i}`, `To ${OP_NAMES[i]}`, {
        min: -1,
        max: 1,
        def: 0,
        color: MOD_COLOR,
        fmt: fmtSigned,
      }),
    );
  }
  const retrigSeg = patchSeg(
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
  const redraw = (): void => drawEnv(canvas, partsState.patch.pitchEnv, CARRIER_COLOR);
  const row = $('pitchKnobs');
  row.innerHTML = '';
  row.appendChild(
    pathKnob('pitchEnvAmount', 'Amount', {
      min: -48,
      max: 48,
      def: 0,
      step: 0.5,
      color: CARRIER_COLOR,
      fmt: (v) => `${fmtSigned(v)}st`,
    }),
  );
  row.appendChild(envKnobs('pitchEnv', CARRIER_COLOR, redraw));
  requestAnimationFrame(redraw);
}
