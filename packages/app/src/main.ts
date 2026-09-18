/**
 * The arrangement console (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements`): five tabs over
 * the real engine. It boots on a new song — one part, the Init patch, no
 * sequencer (#598) — and a committed song opens through Import. It drives one
 * `AudioSystem`, and every change flows through one pair of operations —
 * `change` (live apply + document merge) and `restructure` (renormalise +
 * rebuild) — on the `AppContext`. Export writes the normalised document —
 * since #435 the synth patches and the returns included, so one file is the
 * whole piece; import reads one back.
 *
 * Composition only (CLAUDE.md "Code structure", #620): this file constructs
 * the systems and wires them; the behaviour is theirs.
 */
import { AppContext } from './appContext';
import { renderArrangementTab } from './arrangementTab';
import { $ } from './dom';
import { DocumentModel } from './documentModel';
import { renderHarmonyTab } from './harmonyTab';
import { EngineHost } from './host';
import { HOST_PUMP_INTERVAL_MS } from './hostConstants';
import { Keyboard } from './keyboard';
import { bootLibrary, syncLibraryMode } from './libraryActions';
import { MidiAccessor } from './midiAccess';
import { renderMixerTab } from './mixerTab';
import { renderPartsTab } from './partsTab';
import { wirePowerButton } from './powerButton';
import { renderSequencersTab } from './sequencersTab';
import { newSong } from './songParts';
import { mountTabShell } from './tabShell';

const status = (message: string): void => {
  $('status').textContent = message;
};

const model = new DocumentModel(newSong());
const host = new EngineHost(status);
const ctx = new AppContext<HTMLElement>({ host, model, status });
// The keyboard plays the Parts tab's selected part, once audio is enabled.
const keyboard = new Keyboard(() => ctx.livePart());
// A MIDI controller plays through the same keyboard (#523).
const midi = new MidiAccessor((inputId) => keyboard.midiSink(inputId));
keyboard.onPanic = (): void => midi.forgetNotes();

mountTabShell(
  ctx,
  [
    { id: 'parts', label: 'Parts', render: (body) => renderPartsTab(body, ctx, keyboard, midi) },
    { id: 'mixer', label: 'Mixer', render: (body) => renderMixerTab(body, ctx) },
    { id: 'sequencers', label: 'Sequencers', render: (body) => renderSequencersTab(body, ctx) },
    { id: 'harmony', label: 'Harmony', render: (body) => renderHarmonyTab(body, ctx) },
    { id: 'arrangement', label: 'Arrangement', render: (body) => renderArrangementTab(body, ctx) },
  ],
  $('tabBar'),
  $('tabRoot'),
);
ctx.render();
keyboard.attachGlobalKeys();
void midi.resume();
// A remembered library folder whose grant still stands is read before the
// first render that could show it; the row's button re-grants a dropped one.
bootLibrary()
  .then(() => {
    syncLibraryMode();
    ctx.render();
  })
  .catch((error: unknown) => status(`library folder: ${String(error)}`));
wirePowerButton($('power'), ctx);
// The look-ahead pump the game's render loop provides; here, a timer.
setInterval(() => host.update(), HOST_PUMP_INTERVAL_MS);
status('new song — pick a sequencer for Part 1 in the Parts tab, or import a song');
