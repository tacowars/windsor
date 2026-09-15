/**
 * The arrangement console (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements`): five tabs over
 * the real engine. It boots on the committed `bed-01.json`, drives one
 * `AudioSystem`, and every change flows through one pair of operations —
 * `change` (live apply + document merge) and `restructure` (renormalise +
 * rebuild). Export writes the normalised document — since #435 the synth
 * patches and the returns included, so one file is the whole piece; import
 * reads one back.
 */
import type {
  ApplyResult,
  ArrangementDocument,
  DeepPartial,
  MusicPartId,
} from '../../../packages/client/src/audio/index-for-editor';
import { makeArrangement } from '../../../packages/client/src/audio/index-for-editor';
import raw from '../../../packages/client/src/audio/arrangements/bed-01.json';
import { renderArrangementTab } from './arrangementTab';
import type { AppCtx } from './context';
import { $, el } from './dom';
import { DocumentModel } from './documentModel';
import { renderHarmonyTab } from './harmonyTab';
import { EngineHost } from './host';
import { Keyboard } from './keyboard';
import { bootLibrary, syncLibraryMode } from './libraryActions';
import { MidiAccessor } from './midiAccess';
import { renderMixerTab } from './mixerTab';
import { renderPartsTab } from './partsTab';
import { partsState } from './patchState';
import { renderSequencersTab } from './sequencersTab';

const status = (message: string): void => {
  $('status').textContent = message;
};

const model = new DocumentModel(raw);
const host = new EngineHost((line) => status(line));
// The keyboard plays the Parts tab's selected part, once audio is enabled.
const keyboard = new Keyboard(() => partsState.part);
// A MIDI controller plays through the same keyboard (#523).
const midi = new MidiAccessor((inputId) => keyboard.midiSink(inputId));
keyboard.onPanic = (): void => midi.forgetNotes();

const ctx: AppCtx = {
  host,
  model,
  change(partial: DeepPartial<ArrangementDocument>): ApplyResult {
    const live = host.apply(partial);
    if (live && !live.ok) {
      status(`refused: ${live.error ?? 'invalid'}`);
      return live;
    }
    model.merge(partial);
    if (live && live.ignored.length > 0) status(`ignored: ${live.ignored.join(', ')}`);
    return live ?? { ok: true, ignored: [] };
  },
  restructure(edit): void {
    model.mutate(edit);
    void host.build(model.doc).then(render, (error: unknown) => status(String(error)));
    render();
  },
  importDoc(rawDoc): void {
    model.adopt(makeArrangement(rawDoc));
    void host.build(model.doc).then(render, (error: unknown) => status(String(error)));
    render();
  },
  capture(id: MusicPartId): boolean {
    const pattern = host.capturePattern(id);
    if (!pattern) return false;
    const result = ctx.change({
      [id]: { driver: { pattern } },
    } as DeepPartial<ArrangementDocument>);
    if (result.ok) {
      status(`${id}: captured — the sounding bar is now a literal array in the document`);
      render();
    }
    return result.ok;
  },
  release(id: MusicPartId): void {
    const result = ctx.change({
      [id]: { driver: { pattern: null } },
    } as DeepPartial<ArrangementDocument>);
    if (result.ok) {
      status(`${id}: released back to generative`);
      render();
    }
  },
  render(): void {
    render();
  },
  status,
};

interface Tab {
  id: string;
  label: string;
  render: (body: HTMLElement) => void;
}

const TABS: Tab[] = [
  { id: 'parts', label: 'Parts', render: (body) => renderPartsTab(body, ctx, keyboard, midi) },
  { id: 'mixer', label: 'Mixer', render: (body) => renderMixerTab(body, ctx) },
  { id: 'sequencers', label: 'Sequencers', render: (body) => renderSequencersTab(body, ctx) },
  { id: 'harmony', label: 'Harmony', render: (body) => renderHarmonyTab(body, ctx) },
  { id: 'arrangement', label: 'Arrangement', render: (body) => renderArrangementTab(body, ctx) },
];

let active = 'parts';
const panels = new Map<string, HTMLElement>();

function render(): void {
  for (const tab of TABS) {
    const panel = panels.get(tab.id);
    if (panel) tab.render(panel);
  }
}

function buildShell(): void {
  const bar = $('tabBar');
  const root = $('tabRoot');
  for (const tab of TABS) {
    const button = el('button', 'tab-btn', tab.label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.tab = tab.id;
    button.onclick = (): void => {
      active = tab.id;
      for (const [id, panel] of panels) panel.hidden = id !== active;
      bar
        .querySelectorAll('.tab-btn')
        .forEach((b) =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.tab === active)),
        );
    };
    button.setAttribute('aria-pressed', String(tab.id === active));
    bar.appendChild(button);
    const panel = el('div', 'tab-panel');
    panel.hidden = tab.id !== active;
    panels.set(tab.id, panel);
    root.appendChild(panel);
  }
}

function boot(): void {
  buildShell();
  render();
  keyboard.attachGlobalKeys();
  void midi.resume();
  // A remembered library folder whose grant still stands is read before the
  // first render that could show it; the row's button re-grants a dropped one.
  bootLibrary()
    .then(() => {
      syncLibraryMode();
      render();
    })
    .catch((error: unknown) => status(`library folder: ${String(error)}`));
  const power = $('power');
  power.onclick = (): void => {
    void host
      .enable(model.doc)
      .then(() => {
        power.textContent = 'Audio on';
        power.classList.remove('primary');
        status('running — the real AudioSystem is playing the document');
        render();
      })
      .catch((error: unknown) => status(`audio failed: ${String(error)}`));
  };
  // The look-ahead pump the game's render loop provides; here, a timer.
  setInterval(() => host.update(), 25);
  status(
    model.usable
      ? 'audio off — enable to hear the committed arrangement'
      : 'audio off — document unusable, the metronome fallback would play',
  );
}

boot();
