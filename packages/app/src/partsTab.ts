/**
 * Parts tab (#70, record §2; #435): the FM patch editor, driving the *real*
 * `AudioPart` of the selected slot — the console builds no synthesis graph
 * of its own. Every knob edit commits the working patch to the document's
 * `patches` section under the part's preset name (`patchLibrary.ts`), and
 * `ctx.change` pushes it to the live part through `AudioSystem.apply`, so the
 * export carries the sound itself.
 */
import type {
  MusicPartId,
  PartialPatch,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  PRESETS,
  clonePatch,
  makePatch,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { SLOT_IDS } from './context';
import { $, el, seg } from './dom';
import type { Keyboard } from './keyboard';
import { badgeText, libraryControls, presetPicker } from './patchLibrary';
import { buildAlgPicker, buildFilter, buildGlobal, buildLfo, buildPitch } from './patchPanels';
import { buildBays } from './patchBays';
import { hooks, partsState, pushPatch } from './patchState';
import { startScope } from './scope';

const GRID_HTML = `
  <div class="parts-grid">
    <aside class="rail">
      <div class="section" id="partPick"></div>
      <div class="section">
        <div class="section-title"><span>Algorithm</span></div>
        <div class="alg-grid" id="algGrid"></div>
        <p class="hint" style="margin: 9px 0 0" id="algName"></p>
      </div>
      <div class="section">
        <div class="section-title"><span>Global</span></div>
        <div class="knob-row" id="globalKnobs"></div>
      </div>
      <div class="section">
        <div class="section-title"><span>Output</span></div>
        <canvas class="scope" id="scope" width="420" height="124"></canvas>
      </div>
    </aside>
    <main class="bays"><div class="bay-grid" id="bayGrid"></div></main>
    <aside class="mod">
      <div class="section">
        <div class="section-title"><span>Filter</span></div>
        <div class="seg-slot" id="filterMode" style="margin-bottom: 8px"></div>
        <div class="knob-row" id="filterKnobs"></div>
        <div class="section-title" style="margin-top: 11px"><span>Filter Env</span></div>
        <canvas class="env-canvas" id="filtEnvCanvas" width="500" height="92"></canvas>
        <div class="knob-row" id="filterEnvKnobs" style="margin-top: 6px"></div>
      </div>
      <div class="section">
        <div class="section-title"><span>LFO</span></div>
        <div class="seg-slot" id="lfoShape" style="margin-bottom: 8px"></div>
        <div class="knob-row" id="lfoKnobs"></div>
      </div>
      <div class="section">
        <div class="section-title"><span>Pitch Env</span></div>
        <canvas class="env-canvas" id="pitchEnvCanvas" width="500" height="92"></canvas>
        <div class="knob-row" id="pitchKnobs" style="margin-top: 6px"></div>
      </div>
    </aside>
  </div>
  <div class="section keys-row">
    <div class="keys" id="keys"></div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <button class="btn" id="octDown" type="button">Oct &minus;</button>
      <span class="status" id="octLabel">C4</span>
      <button class="btn" id="octUp" type="button">Oct +</button>
      <button class="btn" id="holdBtn" type="button" aria-pressed="false">Hold</button>
      <button class="btn" id="panicBtn" type="button">Panic</button>
      <button class="btn" id="jsonBtn" type="button">Patch JSON</button>
    </div>
  </div>`;

/** Reload the working patch: the document's patch, else the built-in the part plays. */
export function loadWorkingPatch(ctx: AppCtx): void {
  const slot = ctx.model.doc[partsState.selected];
  partsState.part = slot ? ctx.host.part(slot.part) : null;
  const patch = slot ? (ctx.model.doc.patches?.[slot.preset] ?? PRESETS[slot.preset]) : undefined;
  partsState.patch = patch ? clonePatch(patch) : makePatch();
}

/** The working patch into the document under the part's preset name (a built-in forks). */
function commitPatch(ctx: AppCtx): void {
  const slot = ctx.model.doc[partsState.selected];
  if (!slot) return;
  const wasDocument = ctx.model.doc.patches?.[slot.preset] !== undefined;
  const result = ctx.change({ patches: { [slot.preset]: partsState.patch } });
  if (result.ok && !wasDocument) syncPresetAndBadge(ctx);
}

function refreshPatchUi(): void {
  buildAlgPicker();
  buildGlobal();
  buildBays();
  buildFilter();
  buildLfo();
  buildPitch();
}

function partPicker(ctx: AppCtx): HTMLElement {
  const box = el('div');
  box.appendChild(el('div', 'section-title', '<span>Part</span>'));
  const present = SLOT_IDS.filter((id) => ctx.model.doc[id] !== undefined);
  box.appendChild(
    seg(
      present.map((id) => ({ value: id, label: id })),
      () => partsState.selected,
      (id) => {
        partsState.selected = id as MusicPartId;
        loadWorkingPatch(ctx);
        refreshPatchUi();
        syncPresetAndBadge(ctx);
      },
    ),
  );
  const presetSlot = el('div');
  presetSlot.id = 'presetSlot';
  presetSlot.style.marginTop = '8px';
  box.appendChild(presetSlot);
  const badge = el('p', 'hint');
  badge.id = 'patchBadge';
  box.appendChild(badge);
  return box;
}

function syncPresetAndBadge(ctx: AppCtx): void {
  const presetSlot = $('presetSlot');
  presetSlot.innerHTML = '';
  presetSlot.appendChild(
    presetPicker(ctx, partsState.selected, () => {
      loadWorkingPatch(ctx);
      refreshPatchUi();
      syncPresetAndBadge(ctx);
    }),
  );
  presetSlot.appendChild(libraryControls(ctx, partsState.selected));
  $('patchBadge').textContent = badgeText(ctx, partsState.selected);
}

function wireJsonDialog(ctx: AppCtx): void {
  const dlg = $('jsonDlg') as HTMLDialogElement;
  const text = $('jsonText') as HTMLTextAreaElement;
  const status = $('jsonStatus');
  $('jsonBtn').onclick = (): void => {
    text.value = JSON.stringify(partsState.patch, null, 2);
    status.textContent = '';
    dlg.showModal();
  };
  $('jsonClose').onclick = (): void => dlg.close();
  $('jsonCopy').onclick = (): void => {
    navigator.clipboard
      .writeText(text.value)
      .then(() => (status.textContent = 'Copied to clipboard'))
      .catch(() => (status.textContent = 'Select-all and copy manually'));
  };
  $('jsonLoad').onclick = (): void => {
    try {
      partsState.patch = makePatch(JSON.parse(text.value) as PartialPatch);
      pushPatch();
      refreshPatchUi();
      syncPresetAndBadge(ctx);
      status.textContent = 'Patch loaded into the document';
    } catch (error) {
      status.textContent = `Could not parse: ${String(error)}`;
    }
  };
}

export function renderPartsTab(body: HTMLElement, ctx: AppCtx, keyboard: Keyboard): void {
  body.innerHTML = GRID_HTML;
  hooks.refresh = refreshPatchUi;
  hooks.commit = (): void => commitPatch(ctx);
  if (!ctx.model.doc[partsState.selected]) {
    partsState.selected = SLOT_IDS.find((id) => ctx.model.doc[id] !== undefined) ?? 'kick';
  }
  loadWorkingPatch(ctx);
  $('partPick').appendChild(partPicker(ctx));
  syncPresetAndBadge(ctx);
  refreshPatchUi();
  startScope($('scope') as HTMLCanvasElement, () => ctx.host.analyser);
  keyboard.render($('keys'));
  $('octDown').onclick = (): void => keyboard.shiftOctave(-1);
  $('octUp').onclick = (): void => keyboard.shiftOctave(1);
  $('panicBtn').onclick = (): void => keyboard.panic();
  const hold = $('holdBtn');
  hold.onclick = (): void => {
    keyboard.hold = !keyboard.hold;
    hold.setAttribute('aria-pressed', String(keyboard.hold));
    if (!keyboard.hold) keyboard.panic();
  };
  wireJsonDialog(ctx);
}
