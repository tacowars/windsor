/** The four operator bays of the Parts tab (#70, ported); the knob specs are `patchKnobTables.ts`. */
import { ALGORITHMS, LOOP_MODE_NAMES, OP_NAMES, WAVE_NAMES } from '@windsor/engine';
import { CARRIER_COLOR, MOD_COLOR } from './consoleColors';
import { $, el, html, seg } from './dom';
import { drawEnv } from './envCanvas';
import { attachEnvelopeDrag } from './envelopeDrag';
import { envAdvKnobs, envKnobs } from './envelopeKnobs';
import { opEnvelopeSlot } from './envelopeTransfer';
import { ensureUserPartials, harmonicEditor } from './harmonicEditor';
import { FIXED_HZ_KNOB, OP_KNOBS, patchKnobOpts } from './patchKnobTables';
import { BAY_SILENT_LEVEL } from './patchPanelConstants';
import type { PatchEditor } from './partsSession';
import { pathKnob } from './patchPath';
import { ratioControls, showPitchControls } from './ratioKnobs';

function op(editor: PatchEditor, i: number): { level: number; wave: number; fixed: boolean } {
  return editor.patch.ops[i] ?? { level: 0, wave: 0, fixed: false };
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

function waveAndPitchLine(
  editor: PatchEditor,
  i: number,
  onWave: () => void,
  onPitchMode: () => void,
): HTMLElement {
  const line = el('div', 'bay-line');
  const waveWrap = el('div', 'grow');
  waveWrap.appendChild(el('span', 'field-label', 'Wave'));
  const waveSel = document.createElement('select');
  waveSel.className = 'field';
  waveSel.name = `wave-op-${i}`;
  waveSel.setAttribute('aria-label', `Operator ${OP_NAMES[i]} waveform`);
  WAVE_NAMES.forEach((n, wi) => waveSel.add(new Option(n, String(wi))));
  waveSel.value = String(op(editor, i).wave);
  waveSel.onchange = (): void => {
    const target = editor.patch.ops[i];
    if (target) target.wave = Number(waveSel.value);
    ensureUserPartials(editor.patch, i);
    editor.push();
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
    fixBtn.textContent = op(editor, i).fixed ? 'Fixed Hz' : 'Ratio';
    fixBtn.setAttribute('aria-pressed', String(op(editor, i).fixed));
  };
  fixBtn.onclick = (): void => {
    const target = editor.patch.ops[i];
    if (target) target.fixed = !target.fixed;
    syncFix();
    onPitchMode();
    editor.push();
  };
  syncFix();
  fixWrap.appendChild(fixBtn);
  line.appendChild(fixWrap);
  return line;
}

function loopModePicker(editor: PatchEditor, i: number, color: string): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'width:100%;margin-top:5px';
  wrap.appendChild(el('span', 'field-label', 'Envelope Loop'));
  wrap.appendChild(
    seg(
      LOOP_MODE_NAMES.map((label, li) => ({ value: String(li), label })),
      () => String(editor.patch.ops[i]?.env.loopMode ?? 0),
      (value) => {
        const target = editor.patch.ops[i];
        if (target) target.env.loopMode = Number(value);
        editor.push();
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
  editor: PatchEditor,
  i: number,
  color: string,
  syncActive: () => void,
): { root: HTMLElement; syncPitch: () => void } {
  const row = el('div', 'knob-row');
  const ratioNodes = ratioControls(editor, i, color);
  for (const node of ratioNodes) row.appendChild(node);
  const fixedPath = `ops.${i}.${FIXED_HZ_KNOB.f}`;
  const fixedNode = pathKnob(editor, fixedPath, FIXED_HZ_KNOB.label, {
    ...patchKnobOpts(FIXED_HZ_KNOB, fixedPath),
    color,
  });
  row.appendChild(fixedNode);
  for (const k of OP_KNOBS) {
    const path = `ops.${i}.${k.f}`;
    const fade = k.f === 'level' ? { onChange: syncActive } : {};
    row.appendChild(pathKnob(editor, path, k.label, { ...patchKnobOpts(k, path), ...fade, color }));
  }
  const syncPitch = (): void => showPitchControls(op(editor, i).fixed, ratioNodes, fixedNode);
  syncPitch();
  return { root: row, syncPitch };
}

/** The bay's body and its Adv row, which the head's button toggles. */
function bayBody(
  editor: PatchEditor,
  i: number,
  color: string,
  syncActive: () => void,
): { body: HTMLElement; adv: HTMLElement } {
  const body = el('div', 'bay-body');
  const harmonics = harmonicEditor(editor, i, color);
  const knobs = mainKnobRow(editor, i, color, syncActive);
  body.appendChild(waveAndPitchLine(editor, i, harmonics.sync, knobs.syncPitch));
  body.appendChild(harmonics.root);
  body.appendChild(knobs.root);

  const canvas = el('canvas', 'env-canvas') as HTMLCanvasElement;
  canvas.setAttribute('aria-label', `Operator ${OP_NAMES[i]} envelope shape`);
  attachEnvelopeDrag(editor, canvas, opEnvelopeSlot(i), color);
  body.appendChild(canvas);
  const redraw = (): void => {
    const env = editor.patch.ops[i]?.env;
    if (env) drawEnv(canvas, env, color);
  };
  const row2 = el('div', 'knob-row');
  row2.appendChild(envKnobs(editor, `ops.${i}.env`, color, redraw));
  body.appendChild(row2);

  const adv = el('div', 'knob-row adv');
  adv.appendChild(envAdvKnobs(editor, `ops.${i}.env`, color, redraw));
  adv.appendChild(loopModePicker(editor, i, color));
  body.appendChild(adv);
  requestAnimationFrame(redraw);
  return { body, adv };
}

export function buildBays(editor: PatchEditor): void {
  const grid = $('bayGrid');
  grid.innerHTML = '';
  const alg = ALGORITHMS[editor.patch.algorithm];
  OP_NAMES.forEach((_, i) => {
    const isCar = alg?.carriers.includes(i) ?? false;
    const color = isCar ? CARRIER_COLOR : MOD_COLOR;
    const bay = el('section', 'bay');
    bay.style.setProperty('--op-color', color);
    const syncActive = (): void => {
      bay.classList.toggle('bay-off', op(editor, i).level <= BAY_SILENT_LEVEL);
    };
    syncActive();
    const { body, adv } = bayBody(editor, i, color, syncActive);
    bay.appendChild(bayHead(i, isCar, adv));
    bay.appendChild(body);
    grid.appendChild(bay);
  });
}
