/** The four operator bays of the Parts tab (#70, ported); the knob specs are `patchKnobTables.ts`. */
import {
  ALGORITHMS,
  LOOP_MODE_NAMES,
  OP_NAMES,
  WAVE_NAMES,
} from '../../../packages/client/src/audio/index-for-editor';
import { CARRIER_COLOR, MOD_COLOR } from './consoleColors';
import { $, el, html, seg } from './dom';
import { drawEnv, envAdvKnobs, envKnobs } from './envCanvas';
import { attachEnvelopeDrag } from './envelopeDrag';
import { opEnvelopeSlot } from './envelopeTransfer';
import { ensureUserPartials, harmonicEditor } from './harmonicEditor';
import { FIXED_HZ_KNOB, OP_KNOBS, patchKnobOpts } from './patchKnobTables';
import { BAY_SILENT_LEVEL } from './patchPanelConstants';
import { partsState, pathKnob, pushPatch } from './patchState';
import { ratioControls, showPitchControls } from './ratioKnobs';

function op(i: number): { level: number; wave: number; fixed: boolean } {
  return partsState.patch.ops[i] ?? { level: 0, wave: 0, fixed: false };
}

function bayHead(i: number, isCar: boolean, adv: HTMLElement): HTMLElement {
  const head = html(
    'div',
    'bay-head',
    `<span class="bay-id">${OP_NAMES[i]}</span>` +
      `<span class="bay-role">${isCar ? 'Carrier' : 'Modulator'}</span>` +
      `<span style="flex:1"></span>`,
  );
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
  const waveWrap = el('div', 'grow');
  waveWrap.appendChild(el('span', 'field-label', 'Wave'));
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

  const fixWrap = el('div');
  fixWrap.appendChild(el('span', 'field-label', 'Pitch'));
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
  wrap.appendChild(
    seg(
      LOOP_MODE_NAMES.map((label, li) => ({ value: String(li), label })),
      () => String(partsState.patch.ops[i]?.env.loopMode ?? 0),
      (value) => {
        const target = partsState.patch.ops[i];
        if (target) target.env.loopMode = Number(value);
        pushPatch();
      },
      color,
    ),
  );
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
  const fixedPath = `ops.${i}.${FIXED_HZ_KNOB.f}`;
  const fixedNode = pathKnob(fixedPath, FIXED_HZ_KNOB.label, {
    ...patchKnobOpts(FIXED_HZ_KNOB, fixedPath),
    color,
  });
  row.appendChild(fixedNode);
  for (const k of OP_KNOBS) {
    const path = `ops.${i}.${k.f}`;
    const fade = k.f === 'level' ? { onChange: syncActive } : {};
    row.appendChild(pathKnob(path, k.label, { ...patchKnobOpts(k, path), ...fade, color }));
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
  attachEnvelopeDrag(canvas, opEnvelopeSlot(i), color);
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
  OP_NAMES.forEach((_, i) => {
    const isCar = alg?.carriers.includes(i) ?? false;
    const color = isCar ? CARRIER_COLOR : MOD_COLOR;
    const bay = el('section', 'bay');
    bay.style.setProperty('--op-color', color);
    const syncActive = (): void => {
      bay.classList.toggle('bay-off', op(i).level <= BAY_SILENT_LEVEL);
    };
    syncActive();
    const body = bayBody(i, color, syncActive);
    const adv = body.querySelector('.adv') as HTMLElement;
    bay.appendChild(bayHead(i, isCar, adv));
    bay.appendChild(body);
    grid.appendChild(bay);
  });
}
