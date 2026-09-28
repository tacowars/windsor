/**
 * The arrangement console (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements`): four tabs over
 * the real engine — Parts, Mixer, Song (#709), Arrangement. It boots on a new song — one part, the Init patch, no
 * sequencer (#598) — and a committed song opens through Import. It drives one
 * `AudioSystem`, and every change flows through `change` (live apply +
 * document merge) on the `AppContext`; Import is the one rebuild. Export writes the normalised document —
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
import { EngineHost } from './host';
import { HOST_PUMP_INTERVAL_MS } from './hostConstants';
import { Keyboard } from './keyboard';
import { MidiAccessor } from './midiAccess';
import { renderMixerTab } from './mixerTab';
import { renderPartsTab } from './partsTab';
import { wirePowerButton } from './powerButton';
import { newSong } from './songParts';
import { songTab } from './songTab';
import { mountTabShell } from './tabShell';
import { mountTransportStrip } from './transportStrip';
import { bootUserState } from './userSession';
import './console.css';

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

mountTransportStrip(ctx, $('transportStrip'));
mountTabShell(
  ctx,
  [
    { id: 'parts', label: 'Parts', render: (body) => renderPartsTab(body, ctx, keyboard, midi) },
    { id: 'mixer', label: 'Mixer', render: (body) => renderMixerTab(body, ctx) },
    { id: 'song', label: 'Song', render: songTab(ctx) },
    { id: 'arrangement', label: 'Arrangement', render: (body) => renderArrangementTab(body, ctx) },
  ],
  $('tabBar'),
  $('tabRoot'),
);
ctx.render();
keyboard.attachGlobalKeys();
void midi.resume();
wirePowerButton($('power'), ctx);
// The user's patches and autosaved song (IndexedDB), and a remembered library
// folder whose grant still stands; the row's button re-grants a dropped one.
// The boot status goes first, so the session's own messages land after it.
status('new song — pick a sequencer for Part 1 in the Parts tab, or import a song');
bootUserState(ctx).catch((error: unknown) => status(`your library: ${String(error)}`));
// The scheduler's look-ahead pump: a timer, since the console has no frame loop to drive it.
setInterval(() => host.update(), HOST_PUMP_INTERVAL_MS);
