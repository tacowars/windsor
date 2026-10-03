/**
 * Parts tab (#70, record §2; #435): the FM patch editor, driving the *real*
 * `AudioPart` of the selected slot — the console builds no synthesis graph
 * of its own. Every knob edit commits the working patch to the document's
 * `patches` section under the part's preset name (`patchLibrary.ts`), and
 * `ctx.change` pushes it to the live part through `AudioSystem.apply`, so the
 * export carries the sound itself. The working patch is `ctx.parts` (#620
 * decision 3); every control here is handed a `PatchEditor` over it, built
 * once per render, whose push also keeps the rail's picker and marker honest.
 */
import type { PartialPatch } from '@windsor/engine';
import { makePatch, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { $, el } from './dom';
import { knobSongTick, voiceKnobAutomation } from './knobAutomation';
import type { Keyboard } from './keyboard';
import { confirmUnsaved, libraryActions, syncModifiedMarker } from './libraryActions';
import type { MidiAccessor } from './midiAccess';
import { midiPanel } from './midiPanel';
import { partListControls } from './partListControls';
import { dropInit } from './patchActions';
import { badgeText, libraryControls, presetPicker } from './patchLibrary';
import {
  buildAlgPicker,
  buildDrive,
  buildFilter,
  buildGlobal,
  buildLfo,
  buildPitch,
} from './patchPanels';
import { buildBays } from './patchBays';
import type { PatchEditor } from './partsSession';
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
        <div class="section-title"><span>Drive</span></div>
        <div class="seg-slot" id="driveSwitch" style="margin-bottom: 8px"></div>
        <div class="drive-body" id="driveBody">
          <div class="bay-line" id="driveShape" style="margin-bottom: 8px"></div>
          <div class="knob-row" id="driveKnobs"></div>
        </div>
      </div>
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
        <div class="section-title"><span>LFO 2</span></div>
        <div class="seg-slot" id="lfo2Shape" style="margin-bottom: 8px"></div>
        <div class="knob-row" id="lfo2Knobs"></div>
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

/**
 * The editor every control on this tab is handed: the session's working patch,
 * a push that commits it through the context and then keeps the rail honest —
 * a built-in that just forked into the document changes the picker and badge
 * (#563), and the library row re-reads its unsaved marker — and the rail rebuild.
 */
function patchEditor(ctx: AppCtx): PatchEditor {
  const editor: PatchEditor = {
    get patch() {
      return ctx.parts.patch;
    },
    push() {
      const preset = partAt(ctx.model.doc, ctx.parts.selected)?.preset;
      const wasDocument = preset !== undefined && ctx.model.doc.patches?.[preset] !== undefined;
      if (!ctx.parts.push()) return;
      if (!wasDocument) syncPresetAndBadge(ctx, editor);
      syncModifiedMarker(ctx);
    },
    refresh: () => refreshPatchUi(editor),
    automation: (path) =>
      voiceKnobAutomation(
        partAt(ctx.model.doc, ctx.parts.selected),
        path,
        knobSongTick(ctx.model.doc, ctx.transport.position()),
      ),
  };
  return editor;
}

function refreshPatchUi(editor: PatchEditor): void {
  buildAlgPicker(editor);
  buildGlobal(editor);
  buildBays(editor);
  buildDrive(editor);
  buildFilter(editor);
  buildLfo(editor, 'lfo');
  buildLfo(editor, 'lfo2');
  buildPitch(editor);
}

function partSection(): HTMLElement {
  const box = el('div');
  const head = el('div', 'section-title');
  head.appendChild(el('span', '', 'Part'));
  box.appendChild(head);
  // The part buttons and Add/Remove moved to the header's part strip (windsor#520, `partStrip.ts`).
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
function reloadRail(ctx: AppCtx, editor: PatchEditor): void {
  ctx.parts.reload();
  refreshPatchUi(editor);
  syncPresetAndBadge(ctx, editor);
}

function syncPresetAndBadge(ctx: AppCtx, editor: PatchEditor): void {
  // The part list controls follow the selection: name and sequencer are the selected part's.
  $('partListSlot').replaceChildren(partListControls(ctx));
  const presetSlot = $('presetSlot');
  presetSlot.innerHTML = '';
  presetSlot.appendChild(
    presetPicker(
      ctx,
      ctx.parts.selected,
      () => {
        reloadRail(ctx, editor);
        // An Init no part plays any more is discarded, never exported (#563).
        dropInit(ctx);
      },
      (proceed) => {
        confirmUnsaved(ctx).then(
          (ok) => ok && proceed(),
          (error: unknown) => ctx.notify(String(error), 'error'),
        );
      },
    ),
  );
  presetSlot.appendChild(libraryControls(ctx, ctx.parts.selected));
  presetSlot.appendChild(libraryActions(ctx, () => reloadRail(ctx, editor)));
  $('patchBadge').textContent = badgeText(ctx, ctx.parts.selected);
}

function wireJsonDialog(ctx: AppCtx, editor: PatchEditor): void {
  const dlg = $('jsonDlg') as HTMLDialogElement;
  const text = $('jsonText') as HTMLTextAreaElement;
  const status = $('jsonStatus');
  $('jsonBtn').onclick = (): void => {
    text.value = JSON.stringify(ctx.parts.patch, null, 2);
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
      ctx.parts.patch = makePatch(JSON.parse(text.value) as PartialPatch);
      editor.push();
      refreshPatchUi(editor);
      syncPresetAndBadge(ctx, editor);
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
  const editor = patchEditor(ctx);
  ctx.parts.reload();
  keyboard.followPart();
  $('partPick').appendChild(partSection());
  $('midiSlot').appendChild(midiPanel(midi));
  syncPresetAndBadge(ctx, editor);
  refreshPatchUi(editor);
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
  wireJsonDialog(ctx, editor);
}
