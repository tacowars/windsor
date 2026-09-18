/**
 * Parts tab (#70, record §2; #435): the FM patch editor, driving the *real*
 * `AudioPart` of the selected slot — the console builds no synthesis graph
 * of its own. Every knob edit commits the working patch to the document's
 * `patches` section under the part's preset name (`patchLibrary.ts`), and
 * `ctx.change` pushes it to the live part through `AudioSystem.apply`, so the
 * export carries the sound itself.
 */
import type { PartialPatch } from '../../../packages/client/src/audio/index-for-editor';
import { clonePatch, makePatch, partAt } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { $, el, seg } from './dom';
import type { Keyboard } from './keyboard';
import { confirmUnsaved, libraryActions } from './libraryActions';
import { library, libraryPatch } from './libraryModel';
import type { MidiAccessor } from './midiAccess';
import { midiPanel } from './midiPanel';
import { partListControls } from './partListControls';
import { dropInit } from './patchActions';
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
    <div id="midiSlot"></div>
  </div>`;

/** Reload the working patch: the document's patch, else the built-in the part plays. */
export function loadWorkingPatch(ctx: AppCtx): void {
  const part = partAt(ctx.model.doc, partsState.selected);
  partsState.part = part ? ctx.host.part(part.slot) : null;
  const patch = part
    ? (ctx.model.doc.patches?.[part.preset] ?? libraryPatch(library, part.preset))
    : undefined;
  partsState.patch = patch ? clonePatch(patch) : makePatch();
}

/** The working patch into the document under the part's preset name (a built-in forks). */
function commitPatch(ctx: AppCtx): void {
  const part = partAt(ctx.model.doc, partsState.selected);
  if (!part) return;
  const wasDocument = ctx.model.doc.patches?.[part.preset] !== undefined;
  const result = ctx.change({ patches: { [part.preset]: partsState.patch } });
  if (result.ok && !wasDocument) syncPresetAndBadge(ctx);
  if (result.ok) hooks.afterCommit();
}

function refreshPatchUi(): void {
  buildAlgPicker();
  buildGlobal();
  buildBays();
  buildFilter();
  buildLfo();
  buildPitch();
}

function partPicker(ctx: AppCtx, onSwitch: () => void): HTMLElement {
  const box = el('div');
  const head = el('div', 'section-title');
  head.appendChild(el('span', '', 'Part'));
  box.appendChild(head);
  box.appendChild(
    seg(
      ctx.model.doc.parts.map((part) => ({
        value: String(part.slot),
        label: part.name,
      })),
      () => String(partsState.selected),
      (slot) => {
        partsState.selected = Number(slot);
        loadWorkingPatch(ctx);
        onSwitch();
        refreshPatchUi();
        syncPresetAndBadge(ctx);
      },
    ),
  );
  const listSlot = el('div');
  listSlot.id = 'partListSlot';
  box.appendChild(listSlot);
  const presetSlot = el('div');
  presetSlot.id = 'presetSlot';
  presetSlot.style.marginTop = '8px';
  box.appendChild(presetSlot);
  const badge = el('p', 'hint');
  badge.id = 'patchBadge';
  box.appendChild(badge);
  return box;
}

/** Reload the working patch and rebuild the rail: after a load, a library action or a part switch. */
function reloadRail(ctx: AppCtx): void {
  loadWorkingPatch(ctx);
  refreshPatchUi();
  syncPresetAndBadge(ctx);
}

function syncPresetAndBadge(ctx: AppCtx): void {
  // The part list controls follow the selection: name and sequencer are the selected part's.
  $('partListSlot').replaceChildren(partListControls(ctx));
  const presetSlot = $('presetSlot');
  presetSlot.innerHTML = '';
  presetSlot.appendChild(
    presetPicker(
      ctx,
      partsState.selected,
      () => {
        reloadRail(ctx);
        // An Init no part plays any more is discarded, never exported (#563).
        dropInit(ctx);
      },
      (proceed) => {
        confirmUnsaved(ctx).then(
          (ok) => ok && proceed(),
          (error: unknown) => ctx.status(String(error)),
        );
      },
    ),
  );
  presetSlot.appendChild(libraryControls(ctx, partsState.selected));
  presetSlot.appendChild(libraryActions(ctx, () => reloadRail(ctx)));
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

export function renderPartsTab(
  body: HTMLElement,
  ctx: AppCtx,
  keyboard: Keyboard,
  midi: MidiAccessor,
): void {
  body.innerHTML = GRID_HTML;
  hooks.refresh = refreshPatchUi;
  hooks.commit = (): void => commitPatch(ctx);
  if (!partAt(ctx.model.doc, partsState.selected)) {
    partsState.selected = ctx.model.doc.parts[0]?.slot ?? 0;
  }
  loadWorkingPatch(ctx);
  keyboard.followPart();
  $('partPick').appendChild(partPicker(ctx, () => keyboard.followPart()));
  $('midiSlot').appendChild(midiPanel(midi));
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
