/**
 * Parts tab (#70, record §2; #435): the FM patch editor, driving the *real*
 * `AudioPart` of the selected slot — the console builds no synthesis graph
 * of its own. Every knob edit commits the working patch to the document's
 * `patches` section under the part's preset name (`patchLibrary.ts`), and
 * `ctx.change` pushes it to the live part through `AudioSystem.apply`, so the
 * export carries the sound itself. The working patch is `ctx.parts` (#620
 * decision 3); every control here is handed a `PatchEditor` over it, built
 * once per render, whose push also keeps the patch bar (`patchBar.ts`) honest.
 * The deck's last card is the patch's macros (`macroCard.ts`, windsor#561),
 * and a knob a macro mapping covers locks under the macro's name.
 */
import type { PartialPatch } from '@windsor/engine';
import { makePatch, partAt, songTicksOf } from '@windsor/engine';
import type { AppCtx } from './context';
import { $ } from './dom';
import { knobSongTick, patchKnobAutomation } from './knobAutomation';
import { heldOnPath, knobCcScope } from './knobCc';
import { knobEnvelopeAt, type KnobEnvelopeQuery } from './knobEnvelope';
import type { Keyboard } from './keyboard';
import { keysExpandButton } from './keyboardExpand';
import { confirmUnsaved, syncModifiedMarker } from './libraryActions';
import type { MidiAccessor } from './midiAccess';
import { showTrapped } from './metadataModal';
import { buildMacroCard } from './macroCard';
import { midiPanel } from './midiPanel';
import { dropInit } from './patchActions';
import { keepBarFocus, patchBar, syncRackTag } from './patchBar';
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
import { getPath } from './patchPath';
import { startScope } from './scope';

const GRID_HTML = `
  <div class="patch-bar" id="patchBar"></div>
  <div class="parts-grid">
    <aside class="rail">
      <div class="section">
        <div class="section-title"><span>Output</span><span class="scope-view" data-scope-view>Scope</span></div>
        <canvas class="scope" id="scope" width="420" height="124"></canvas>
      </div>
      <div class="section">
        <div class="section-title"><span>Algorithm</span></div>
        <div class="alg-grid" id="algGrid"></div>
        <p class="hint" style="margin: 9px 0 0" id="algName"></p>
      </div>
      <div class="section">
        <div class="section-title"><span>Global</span></div>
        <div class="knob-row" id="globalKnobs"></div>
      </div>
    </aside>
    <main class="bays">
      <div class="section-title"><span>Operators</span></div>
      <div class="op-rows" id="bayGrid"></div>
      <div class="section-title deck-title"><span>Shape &amp; modulation</span></div>
      <div class="deck">
        <section class="deck-card deck-filter">
          <div class="section-title"><span>Filter</span></div>
          <div class="seg-slot" id="filterMode" style="margin-bottom: 8px"></div>
          <div class="knob-row" id="filterKnobs"></div>
          <div class="section-title" style="margin-top: 11px"><span>Filter Env</span></div>
          <canvas class="env-canvas" id="filtEnvCanvas" width="500" height="92"></canvas>
          <div class="knob-row" id="filterEnvKnobs" style="margin-top: 6px"></div>
        </section>
        <section class="deck-card deck-lfo">
          <div class="section-title"><span>LFO</span></div>
          <div class="seg-slot" id="lfoShape" style="margin-bottom: 8px"></div>
          <div class="knob-row" id="lfoKnobs"></div>
        </section>
        <section class="deck-card deck-lfo">
          <div class="section-title"><span>LFO 2</span></div>
          <div class="seg-slot" id="lfo2Shape" style="margin-bottom: 8px"></div>
          <div class="knob-row" id="lfo2Knobs"></div>
        </section>
        <section class="deck-card deck-lfo">
          <div class="section-title"><span>Pitch Env</span></div>
          <canvas class="env-canvas" id="pitchEnvCanvas" width="500" height="92"></canvas>
          <div class="knob-row" id="pitchKnobs" style="margin-top: 6px"></div>
        </section>
        <section class="deck-card deck-drive">
          <div class="section-title"><span>Drive</span></div>
          <div class="seg-slot" id="driveSwitch" style="margin-bottom: 8px"></div>
          <div class="drive-body" id="driveBody">
            <div class="bay-line" id="driveShape" style="margin-bottom: 8px"></div>
            <div class="knob-row" id="driveKnobs"></div>
          </div>
        </section>
        <section class="deck-card deck-macros" id="macroCard"></section>
      </div>
    </main>
  </div>
  <div class="section keys-row">
    <div class="keys" id="keys"></div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap" id="keyButtons">
      <button class="btn" id="octDown" type="button">Oct &minus;</button>
      <span class="status" id="octLabel" data-oct-label>C4</span>
      <button class="btn" id="octUp" type="button">Oct +</button>
      <button class="btn" id="holdBtn" type="button" aria-pressed="false" data-keys-hold>Hold</button>
      <button class="btn" id="panicBtn" type="button">Panic</button>
    </div>
    <div id="midiSlot"></div>
  </div>`;

/**
 * The editor every control on this tab is handed: the session's working patch,
 * a push that commits it through the context and then keeps the patch bar
 * honest — a built-in that just forked into the document changes the patch
 * box's source (#563), and the box re-reads its unsaved dot — and the rebuild.
 */
function patchEditor(ctx: AppCtx): PatchEditor {
  const envelope = knobEnvelopeReader(ctx);
  const commit = (push: () => boolean): void => {
    const preset = partAt(ctx.model.doc, ctx.parts.selected)?.preset;
    const wasDocument = preset !== undefined && ctx.model.doc.patches?.[preset] !== undefined;
    if (!push()) return;
    if (!wasDocument) syncPresetAndBadge(ctx, editor);
    syncModifiedMarker(ctx);
    syncRackTag(ctx);
  };
  const editor: PatchEditor = {
    get patch() {
      return ctx.parts.patch;
    },
    push: () => commit(() => ctx.parts.push()),
    pushShared: (parts) => commit(() => ctx.parts.pushShared(parts)),
    refresh: () => refreshPatchUi(editor),
    automation: (path) =>
      patchKnobAutomation(
        partAt(ctx.model.doc, ctx.parts.selected),
        ctx.parts.patch.macros,
        path,
        knobSongTick(ctx.model.doc, ctx.transport.position()),
      ),
    envelope,
    cc: { scope: knobCcScope(ctx), part: () => ctx.parts.selected },
  };
  return editor;
}

/**
 * The editor's env ring read (windsor#725): the selected part's clip
 * envelope on a knob's path at the audible tick, moving only on the targets
 * the engine holds a slot for, over the CC's value where one is held. One
 * query and one admitted list, refilled per read, so a knob's frame
 * allocates nothing of its own.
 */
function knobEnvelopeReader(ctx: AppCtx): NonNullable<PatchEditor['envelope']> {
  const admitted: string[] = [];
  const query: KnobEnvelopeQuery = {
    part: undefined,
    patch: ctx.parts.patch,
    path: '',
    base: 0,
    tick: 0,
    running: false,
    admitted,
    songTicks: 0,
  };
  return (path, out) => {
    const { doc } = ctx.model;
    query.part = partAt(doc, ctx.parts.selected);
    query.patch = ctx.parts.patch;
    query.path = path;
    query.base = Number(getPath(ctx.parts.patch, path) ?? 0);
    // A MIDI CC's value held on the target is what the envelope rides on (windsor#785).
    query.held = heldOnPath(ctx.parts.selected, path);
    query.tick = ctx.transport.position();
    query.running = ctx.transport.running;
    // The engine's own admitted set while it plays; stopped, nothing moves.
    if (query.running) ctx.host.envelopeTargets(ctx.parts.selected, admitted);
    else admitted.length = 0;
    query.songTicks = songTicksOf(doc);
    return knobEnvelopeAt(query, out);
  };
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
  buildMacroCard(editor);
}

/** Reload the working patch and rebuild the bar and the editor: after a load, a library action or a part switch. */
function reloadRail(ctx: AppCtx, editor: PatchEditor): void {
  ctx.parts.reload();
  refreshPatchUi(editor);
  syncPresetAndBadge(ctx, editor);
}

/** Open the Patch JSON dialog on the working patch (the bar's ⋯ menu). */
function openJsonDialog(ctx: AppCtx, opener: HTMLElement): void {
  ($('jsonText') as HTMLTextAreaElement).value = JSON.stringify(ctx.parts.patch, null, 2);
  $('jsonStatus').textContent = '';
  void showTrapped($('jsonDlg') as HTMLDialogElement, opener);
}

/** The part + patch bar (windsor#521) for the selected part, rebuilt whole. */
function syncPresetAndBadge(ctx: AppCtx, editor: PatchEditor): void {
  const bar = $('patchBar');
  keepBarFocus(bar, () => bar.replaceChildren(...barControls(ctx, editor)));
}

function barControls(ctx: AppCtx, editor: PatchEditor): HTMLElement[] {
  return patchBar(ctx, {
    onPick: () => {
      reloadRail(ctx, editor);
      // An Init no part plays any more is discarded, never exported (#563).
      dropInit(ctx);
    },
    guard: (proceed) => {
      confirmUnsaved(ctx).then(
        (ok) => ok && proceed(),
        (error: unknown) => ctx.notify(String(error), 'error'),
      );
    },
    refresh: () => reloadRail(ctx, editor),
    openJson: (opener) => openJsonDialog(ctx, opener),
  });
}

function wireJsonDialog(ctx: AppCtx, editor: PatchEditor): void {
  const dlg = $('jsonDlg') as HTMLDialogElement;
  const text = $('jsonText') as HTMLTextAreaElement;
  const status = $('jsonStatus');
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

/** The contexts whose Parts tab already redraws the RACK tag when shown (one listener per context, not per render). */
const tagOnShown = new WeakSet<AppCtx>();

export function renderPartsTab(
  body: HTMLElement,
  ctx: AppCtx,
  keyboard: Keyboard,
  midi: MidiAccessor,
): void {
  body.innerHTML = GRID_HTML;
  // A chain edit on the Mixer tab commits with a bare ctx.change, which marks no tab stale, so
  // the tag re-reads the rack's dot each time this tab is shown (windsor#885).
  if (!tagOnShown.has(ctx)) {
    tagOnShown.add(ctx);
    ctx.onTabShown('parts', (shown) => {
      if (shown) syncRackTag(ctx);
    });
  }
  const editor = patchEditor(ctx);
  ctx.parts.reload();
  keyboard.followPart();
  $('midiSlot').appendChild(midiPanel(midi));
  syncPresetAndBadge(ctx, editor);
  refreshPatchUi(editor);
  startScope($('scope') as HTMLCanvasElement, () => ctx.host.analyser);
  // Expand ends the button group (windsor#864): the keyboard opened wide below the header.
  $('keyButtons').append(keysExpandButton({ ctx, keyboard }));
  keyboard.render($('keys'));
  $('octDown').onclick = (): void => keyboard.shiftOctave(-1);
  $('octUp').onclick = (): void => keyboard.shiftOctave(1);
  $('panicBtn').onclick = (): void => keyboard.panic();
  $('holdBtn').onclick = (): void => keyboard.toggleHold();
  wireJsonDialog(ctx, editor);
}
