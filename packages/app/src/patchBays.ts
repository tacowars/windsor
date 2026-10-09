/**
 * The four operator rows of the Parts tab (#70, ported; laid out as rows by
 * windsor#523, record `2026-10-03-parts-tab-layout` decisions 6, 7 and 9).
 * Each row is an identity column (letter, badge, Adv, Wave, Sync, Ratio/Fixed) and
 * a body that wraps: the core (the main knobs, Attack to Release, then the
 * envelope, which takes the leftover width) and, while Adv is on, the Adv
 * group, which the flex wrap alone puts beside the core or under it. The
 * knob specs are `patchKnobTables.ts`; the column sizes are `console.css`'s
 * "operator rows" block. The Sync face on the wave line is
 * `operatorSyncPicker.ts` (windsor#649).
 */
import type { Patch } from '@windsor/engine';
import { ALGORITHMS, OP_NAMES, WAVE, WAVE_NAMES, WIDTH_RANGE } from '@windsor/engine';
import { CARRIER_COLOR, MOD_COLOR } from './consoleColors';
import { $, el, html, seg } from './dom';
import { drawEnv } from './envCanvas';
import { attachEnvelopeDrag } from './envelopeDrag';
import { envAdvKnobs, envKnobs, envLoopPicker } from './envelopeKnobs';
import { opEnvelopeSlot } from './envelopeTransfer';
import { ensureUserPartials, harmonicEditor } from './harmonicEditor';
import type { KnobElement } from './knob';
import {
  FIXED_HZ_KNOB,
  OP_FILTER_KNOBS,
  OP_KNOBS,
  OP_PHASE_KNOB,
  patchKnobOpts,
} from './patchKnobTables';
import { OP_START_NAMES, opStartIndex, opStartLocked, writeOpStart } from './operatorStart';
import { closeSyncMenu, syncPickers } from './operatorSyncPicker';
import { BAY_SILENT_LEVEL, PULSE_START_WIDTH } from './patchPanelConstants';
import type { PatchEditor } from './partsSession';
import { pathKnob } from './patchPath';
import { ratioControls, showPitchControls } from './ratioKnobs';

/**
 * Seed a Pulse operator's duty, the way `ensureUserPartials` seeds a User
 * wave: an operator switched to Pulse at full width gets a square, and one
 * whose width was already moved keeps it. Switching away leaves width alone.
 * `startWidth` is the seeded duty, `PULSE_START_WIDTH` unless a caller says otherwise.
 */
export function ensurePulseWidth(patch: Patch, i: number, startWidth = PULSE_START_WIDTH): void {
  const target = patch.ops[i];
  if (target?.wave === WAVE.PULSE && target.width >= WIDTH_RANGE.max) {
    target.width = startWidth;
  }
}

function op(editor: PatchEditor, i: number): { level: number; wave: number; fixed: boolean } {
  return editor.patch.ops[i] ?? { level: 0, wave: 0, fixed: false };
}

/**
 * The identity column's top line: the letter, the Carrier/Mod badge and the
 * Adv toggle, which hands its new state to `onAdv`.
 */
function identityHead(i: number, isCar: boolean, onAdv: (open: boolean) => void): HTMLElement {
  const head = html(
    'div',
    'op-id-head',
    `<span class="op-letter">${OP_NAMES[i]}</span>` +
      `<span class="op-role">${isCar ? 'Carrier' : 'Mod'}</span>`,
  );
  const advBtn = el('button', 'btn op-adv-btn', 'Adv') as HTMLButtonElement;
  advBtn.type = 'button';
  advBtn.setAttribute('aria-pressed', 'false');
  advBtn.setAttribute('aria-label', `Operator ${OP_NAMES[i]} advanced envelope`);
  advBtn.onclick = (): void => {
    const open = advBtn.getAttribute('aria-pressed') !== 'true';
    advBtn.setAttribute('aria-pressed', String(open));
    onAdv(open);
  };
  head.appendChild(advBtn);
  return head;
}

/** The identity column's second line: the Wave select, the Sync face and the Ratio/Fixed toggle. */
function waveAndPitchLine(
  editor: PatchEditor,
  i: number,
  onWave: () => void,
  onPitchMode: () => void,
  syncFace: HTMLElement,
): HTMLElement {
  const line = el('div', 'op-id-line');
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
    ensurePulseWidth(editor.patch, i);
    editor.push();
    onWave();
  };
  line.append(waveSel, syncFace);

  const fixBtn = el('button', 'btn') as HTMLButtonElement;
  fixBtn.type = 'button';
  fixBtn.setAttribute('aria-label', `Operator ${OP_NAMES[i]} pitch mode`);
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
  line.appendChild(fixBtn);
  return line;
}

/**
 * The Start segment (Free | Locked) and the Phase knob it locks to, which
 * shows only while the operator is Locked (`operatorStart.ts`).
 */
function startControls(editor: PatchEditor, i: number, color: string): HTMLElement {
  const wrap = el('div', 'op-adv-start');
  const path = `ops.${i}.${OP_PHASE_KNOB.f}`;
  const phase = pathKnob(editor, path, OP_PHASE_KNOB.label, {
    ...patchKnobOpts(OP_PHASE_KNOB, path),
    color,
  });
  const syncPhase = (): void => {
    phase.style.display = opStartLocked(editor.patch, i) ? '' : 'none';
  };
  const segWrap = el('div');
  segWrap.appendChild(el('span', 'field-label', 'Start'));
  segWrap.appendChild(
    seg(
      OP_START_NAMES.map((label, si) => ({ value: String(si), label })),
      () => String(opStartIndex(editor.patch, i)),
      (value) => {
        writeOpStart(editor.patch, i, Number(value));
        editor.push();
        syncPhase();
      },
      color,
    ),
  );
  wrap.appendChild(segWrap);
  wrap.appendChild(phase);
  syncPhase();
  return wrap;
}

/**
 * The main knobs: the pitch controls first — Coarse, Fine and their readout,
 * or the Fixed knob in the same width, whichever the operator's Pitch toggle
 * selects — then the rest of `OP_KNOBS`, then the operator's own filters,
 * LP, HP and Key Trk (windsor#590), on every wave. `syncPitch` is what the
 * toggle calls to swap them.
 */
function mainKnobs(
  editor: PatchEditor,
  i: number,
  color: string,
  syncActive: () => void,
): { root: HTMLElement; syncPitch: () => void; syncKnobs: () => void } {
  const group = el('div', 'op-group op-main');
  const ratioNodes = ratioControls(editor, i, color);
  for (const node of ratioNodes) group.appendChild(node);
  const fixedPath = `ops.${i}.${FIXED_HZ_KNOB.f}`;
  const fixedNode = pathKnob(editor, fixedPath, FIXED_HZ_KNOB.label, {
    ...patchKnobOpts(FIXED_HZ_KNOB, fixedPath),
    color,
  });
  fixedNode.classList.add('op-fixed');
  group.appendChild(fixedNode);
  for (const k of [...OP_KNOBS, ...OP_FILTER_KNOBS]) {
    const path = `ops.${i}.${k.f}`;
    const fade = k.f === 'level' ? { onChange: syncActive } : {};
    group.appendChild(
      pathKnob(editor, path, k.label, { ...patchKnobOpts(k, path), ...fade, color }),
    );
  }
  const syncPitch = (): void => showPitchControls(op(editor, i).fixed, ratioNodes, fixedNode);
  syncPitch();
  // A wave switch can seed Width (`ensurePulseWidth`), so the group re-reads the patch.
  const syncKnobs = (): void => {
    for (const knob of group.querySelectorAll<KnobElement>('.knob')) knob.refresh();
  };
  return { root: group, syncPitch, syncKnobs };
}

/**
 * Redraw the envelope whenever its box changes size: a wrap, a window resize
 * or a zoom changes its width with no patch change. It stops watching once
 * the rows are rebuilt and the canvas has left the document (#620's pattern).
 */
function redrawOnResize(canvas: HTMLCanvasElement, redraw: () => void): void {
  const resized = new ResizeObserver(() => {
    if (!canvas.isConnected) return resized.disconnect();
    if (canvas.clientWidth > 0) redraw();
  });
  resized.observe(canvas);
}

/** The envelope canvas, a drag source and drop target (#588), and its redraw. */
function envelopeCanvas(
  editor: PatchEditor,
  i: number,
  color: string,
): { canvas: HTMLCanvasElement; redraw: () => void } {
  const canvas = el('canvas', 'env-canvas') as HTMLCanvasElement;
  canvas.setAttribute('aria-label', `Operator ${OP_NAMES[i]} envelope shape`);
  attachEnvelopeDrag(editor, canvas, opEnvelopeSlot(i), color);
  const redraw = (): void => {
    const env = editor.patch.ops[i]?.env;
    if (env) drawEnv(canvas, env, color);
  };
  redrawOnResize(canvas, redraw);
  return { canvas, redraw };
}

/**
 * The Adv group, built only while Adv is on: the advanced envelope knobs,
 * then the envelope loop picker over Start and its Phase knob.
 */
function advGroup(editor: PatchEditor, i: number, color: string, redraw: () => void): HTMLElement {
  const group = el('div', 'op-adv');
  group.appendChild(el('span', 'op-adv-label', 'Adv Env'));
  const knobs = el('div', 'op-group');
  knobs.appendChild(envAdvKnobs(editor, `ops.${i}.env`, color, redraw));
  const extra = el('div', 'op-adv-extra');
  const loop = envLoopPicker(editor, `ops.${i}.env`, color);
  // The column's gap spaces the picker; its own top margin is for a card.
  loop.style.marginTop = '0';
  extra.append(loop, startControls(editor, i, color));
  group.append(knobs, extra);
  return group;
}

/** One operator's row: the identity column, the body and, for a User wave, the harmonic editor. */
function operatorRow(
  editor: PatchEditor,
  i: number,
  isCar: boolean,
  syncFace: HTMLElement,
): HTMLElement {
  const color = isCar ? CARRIER_COLOR : MOD_COLOR;
  const row = el('section', 'op-row');
  row.style.setProperty('--op-color', color);
  const syncActive = (): void => {
    row.classList.toggle('bay-off', op(editor, i).level <= BAY_SILENT_LEVEL);
  };
  syncActive();

  const harmonics = harmonicEditor(editor, i, color);
  harmonics.root.classList.add('op-harmonics');
  const knobs = mainKnobs(editor, i, color, syncActive);
  const { canvas, redraw } = envelopeCanvas(editor, i, color);
  const adsr = el('div', 'op-group');
  adsr.appendChild(envKnobs(editor, `ops.${i}.env`, color, redraw));
  // Coarse through Release are one unit that never wraps apart.
  const knobLine = el('div', 'op-knobs');
  knobLine.append(knobs.root, adsr);
  const core = el('div', 'op-core');
  core.append(knobLine, canvas);
  const body = el('div', 'op-body');
  body.appendChild(core);

  let adv: HTMLElement | null = null;
  const onAdv = (open: boolean): void => {
    adv?.remove();
    adv = open ? advGroup(editor, i, color, redraw) : null;
    if (adv) body.appendChild(adv);
  };
  const onWave = (): void => {
    harmonics.sync();
    knobs.syncKnobs();
  };
  const id = el('div', 'op-id');
  id.append(
    identityHead(i, isCar, onAdv),
    waveAndPitchLine(editor, i, onWave, knobs.syncPitch, syncFace),
  );
  row.append(id, body, harmonics.root);
  requestAnimationFrame(redraw);
  return row;
}

export function buildBays(editor: PatchEditor): void {
  closeSyncMenu();
  const grid = $('bayGrid');
  grid.innerHTML = '';
  const carriers = ALGORITHMS[editor.patch.algorithm]?.carriers ?? [];
  const isCar = (i: number): boolean => carriers.includes(i);
  const faces = syncPickers(
    editor,
    OP_NAMES.map((_, i) => (isCar(i) ? CARRIER_COLOR : MOD_COLOR)),
  );
  OP_NAMES.forEach((_, i) => {
    grid.appendChild(operatorRow(editor, i, isCar(i), faces[i]!));
  });
}
