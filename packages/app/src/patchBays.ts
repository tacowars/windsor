/** The four operator bays of the Parts tab (#70, ported). */
import {
  ALGORITHMS,
  LOOP_MODE_NAMES,
  OP_NAMES,
  WAVE_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import { $, el, fmtSigned } from './dom';
import { drawEnv, envAdvKnobs, envKnobs } from './envCanvas';
import { ensureUserPartials, harmonicEditor } from './harmonicEditor';
import { CARRIER_COLOR, MOD_COLOR } from './patchPanels';
import { partsState, pathKnob, pushPatch } from './patchState';
import { ratioControls, showPitchControls } from './ratioKnobs';

const fmt2 = (v: number): string => v.toFixed(2);
const fmtHz = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(2)}k` : v.toFixed(0));

type KnobOpts = Parameters<typeof pathKnob>[2];

/**
 * The fixed-frequency half of the pitch controls. It is not in `OP_KNOBS`
 * because the Pitch toggle swaps it against the Coarse / Fine pair (#587),
 * which is bound through `ratioSplit` rather than to a path of its own.
 */
const FIXED_KNOB = {
  label: 'Fixed',
  o: { min: 20, max: 8000, def: 100, curve: 'log', fmt: fmtHz } as KnobOpts,
};

/** Per-operator knobs; `level` gets its per-op default and the bay-fade hook. */
const OP_KNOBS: ReadonlyArray<{ f: string; label: string; o: KnobOpts }> = [
  {
    f: 'detune',
    label: 'Detune',
    o: { min: -100, max: 100, def: 0, step: 1, fmt: (v) => `${v.toFixed(0)}c` },
  },
  { f: 'level', label: 'Level', o: { min: 0, max: 1, def: 0, fmt: fmt2 } },
  { f: 'feedback', label: 'Fdbk', o: { min: -1, max: 1, def: 0, fmt: fmtSigned } },
  { f: 'velSens', label: 'Vel', o: { min: 0, max: 1, def: 0.4, fmt: fmt2 } },
];

function op(i: number): { level: number; wave: number; fixed: boolean } {
  return partsState.patch.ops[i] ?? { level: 0, wave: 0, fixed: false };
}

function bayHead(i: number, isCar: boolean, adv: HTMLElement): HTMLElement {
  const head = el('div', 'bay-head');
  head.innerHTML =
    `<span class="bay-id">${OP_NAMES[i]}</span>` +
    `<span class="bay-role">${isCar ? 'Carrier' : 'Modulator'}</span>` +
    `<span style="flex:1"></span>`;
  const advBtn = el('button', 'btn', 'Adv') as HTMLButtonElement;
  advBtn.type = 'button';
  advBtn.setAttribute('aria-pressed', 'false');
  advBtn.onclick = (): void => {
    const open = adv.classList.toggle('open');
    advBtn.setAttribute('aria-pressed', String(open));
  };
  head.appendChild(advBtn);
  return head;
}

function waveAndPitchLine(i: number, onWave: () => void, onPitchMode: () => void): HTMLElement {
  const line = el('div', 'bay-line');
  const waveWrap = el('div', 'grow', '<span class="field-label">Wave</span>');
  const waveSel = document.createElement('select');
  waveSel.className = 'field';
  waveSel.name = `wave-op-${i}`;
  waveSel.setAttribute('aria-label', `Operator ${OP_NAMES[i]} waveform`);
  WAVE_NAMES.forEach((n, wi) => waveSel.add(new Option(n, String(wi))));
  waveSel.value = String(op(i).wave);
  waveSel.onchange = (): void => {
    const target = partsState.patch.ops[i];
    if (target) target.wave = Number(waveSel.value);
    ensureUserPartials(i);
    pushPatch();
    onWave();
  };
  waveWrap.appendChild(waveSel);
  line.appendChild(waveWrap);

  const fixWrap = el('div', '', '<span class="field-label">Pitch</span>');
  const fixBtn = el('button', 'btn') as HTMLButtonElement;
  fixBtn.type = 'button';
  fixBtn.style.width = '76px';
  const syncFix = (): void => {
    fixBtn.textContent = op(i).fixed ? 'Fixed Hz' : 'Ratio';
    fixBtn.setAttribute('aria-pressed', String(op(i).fixed));
  };
  fixBtn.onclick = (): void => {
    const target = partsState.patch.ops[i];
    if (target) target.fixed = !target.fixed;
    syncFix();
    onPitchMode();
    pushPatch();
  };
  syncFix();
  fixWrap.appendChild(fixBtn);
  line.appendChild(fixWrap);
  return line;
}

function loopModePicker(i: number, color: string): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'width:100%;margin-top:5px';
  wrap.appendChild(el('span', 'field-label', 'Envelope Loop'));
  const seg = el('div', 'seg');
  seg.style.setProperty('--seg-color', color);
  LOOP_MODE_NAMES.forEach((n, li) => {
    const b = el('button', '', n) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(partsState.patch.ops[i]?.env.loopMode === li));
    b.onclick = (): void => {
      const target = partsState.patch.ops[i];
      if (target) target.env.loopMode = li;
      [...seg.children].forEach((c, ci) => c.setAttribute('aria-pressed', String(ci === li)));
      pushPatch();
    };
    seg.appendChild(b);
  });
  wrap.appendChild(seg);
  return wrap;
}

/**
 * The knob row: the pitch controls first — Coarse, Fine and their readout, or
 * the Fixed Hz knob, whichever the operator's Pitch toggle selects — then the
 * rest of `OP_KNOBS`. `syncPitch` is what the toggle calls to swap them.
 */
function mainKnobRow(
  i: number,
  color: string,
  syncActive: () => void,
): { root: HTMLElement; syncPitch: () => void } {
  const row = el('div', 'knob-row');
  const ratioNodes = ratioControls(i, color);
  for (const node of ratioNodes) row.appendChild(node);
  const fixedNode = pathKnob(`ops.${i}.fixedHz`, FIXED_KNOB.label, { ...FIXED_KNOB.o, color });
  row.appendChild(fixedNode);
  for (const k of OP_KNOBS) {
    const extra: KnobOpts = k.f === 'level' ? { onChange: syncActive, def: i === 0 ? 1 : 0 } : {};
    row.appendChild(pathKnob(`ops.${i}.${k.f}`, k.label, { ...k.o, ...extra, color }));
  }
  const syncPitch = (): void => showPitchControls(op(i).fixed, ratioNodes, fixedNode);
  syncPitch();
  return { root: row, syncPitch };
}

function bayBody(i: number, color: string, syncActive: () => void): HTMLElement {
  const body = el('div', 'bay-body');
  const harmonics = harmonicEditor(i, color);
  const knobs = mainKnobRow(i, color, syncActive);
  body.appendChild(waveAndPitchLine(i, harmonics.sync, knobs.syncPitch));
  body.appendChild(harmonics.root);
  body.appendChild(knobs.root);

  const canvas = el('canvas', 'env-canvas') as HTMLCanvasElement;
  canvas.setAttribute('aria-label', `Operator ${OP_NAMES[i]} envelope shape`);
  body.appendChild(canvas);
  const redraw = (): void => {
    const env = partsState.patch.ops[i]?.env;
    if (env) drawEnv(canvas, env, color);
  };
  const row2 = el('div', 'knob-row');
  row2.appendChild(envKnobs(`ops.${i}.env`, color, redraw));
  body.appendChild(row2);

  const adv = el('div', 'knob-row adv');
  adv.appendChild(envAdvKnobs(`ops.${i}.env`, color, redraw));
  adv.appendChild(loopModePicker(i, color));
  body.appendChild(adv);
  requestAnimationFrame(redraw);
  return body;
}

export function buildBays(): void {
  const grid = $('bayGrid');
  grid.innerHTML = '';
  const alg = ALGORITHMS[partsState.patch.algorithm];
  for (let i = 0; i < 4; i++) {
    const isCar = alg?.carriers.includes(i) ?? false;
    const color = isCar ? CARRIER_COLOR : MOD_COLOR;
    const bay = el('section', 'bay');
    bay.style.setProperty('--op-color', color);
    const syncActive = (): void => {
      bay.classList.toggle('bay-off', op(i).level <= 0.0001);
    };
    syncActive();
    const body = bayBody(i, color, syncActive);
    const adv = body.querySelector('.adv') as HTMLElement;
    bay.appendChild(bayHead(i, isCar, adv));
    bay.appendChild(body);
    grid.appendChild(bay);
  }
}
