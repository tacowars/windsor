/**
 * The arrangement console (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements`): four tabs over
 * the real engine — Parts, Mixer, Song (#709) and the Settings gear (windsor#39). It boots on a new song — one part, the Init patch, no
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
import { mountAudioGate } from './audioGate';
import { $ } from './dom';
import { DocumentModel } from './documentModel';
import { EngineHost } from './host';
import { HOST_PUMP_INTERVAL_MS } from './hostConstants';
import { Keyboard, qwertyPlaysOn } from './keyboard';
import { MidiAccessor } from './midiAccess';
import { renderMixerTab } from './mixerTab';
import { mountPartStrip } from './partStrip';
import { renderPartsTab } from './partsTab';
import { wirePowerButton } from './powerButton';
import { newSong } from './songParts';
import { songTab } from './songTab';
import { GEAR_ICON, mountTabShell } from './tabShell';
import { mountToasts, notify } from './toast';
import { mountTransportStrip } from './transportStrip';
import { mountUndoControls } from './undoControls';
import { bootUserState } from './userSession';
import './console.css';

mountToasts($('toasts'));
const model = new DocumentModel(newSong());
const host = new EngineHost((message) => notify(message, 'error'));
const ctx = new AppContext<HTMLElement>({ host, model, notify });
// The keyboard plays the Parts tab's selected part, once audio is enabled,
// and its QWERTY keys only while the Parts tab is shown.
const keyboard = new Keyboard(
  () => ctx.livePart(),
  () => qwertyPlaysOn(ctx.activeTab),
);
// A MIDI controller plays through the same keyboard (#523).
const midi = new MidiAccessor((inputId) => keyboard.midiSink(inputId));
keyboard.onPanic = (): void => midi.forgetNotes();
// The bend and the mod wheel follow the selected part, whichever view picked it.
ctx.parts.onSelect(() => keyboard.followPart());

mountUndoControls(ctx, $('undoControls'));
mountTransportStrip(ctx, $('transportStrip'));
mountPartStrip(ctx, $('partStrip'));
mountTabShell(
  ctx,
  [
    { id: 'parts', label: 'Parts', render: (body) => renderPartsTab(body, ctx, keyboard, midi) },
    { id: 'mixer', label: 'Mixer', render: (body) => renderMixerTab(body, ctx) },
    { id: 'song', label: 'Song', render: songTab(ctx) },
    {
      id: 'arrangement',
      label: 'Settings',
      icon: GEAR_ICON,
      ariaLabel: 'Settings',
      render: (body) => renderArrangementTab(body, ctx),
    },
  ],
  $('tabBar'),
  $('tabRoot'),
);
ctx.render();
keyboard.attachGlobalKeys();
void midi.resume();
// The gate's button is the gesture that starts or resumes audio (windsor#578);
// the header's power button shows up as the CPU meter once audio is on.
const power = wirePowerButton($('power'), ctx);
mountAudioGate({
  host,
  enable: () => host.enable(ctx.model.doc),
  onEnabled: () => power.audioOn(),
});
// The user's patches and autosaved song (IndexedDB), and a remembered library
// folder whose grant still stands; the row's button re-grants a dropped one.
bootUserState(ctx).catch((error: unknown) => notify(`your library: ${String(error)}`, 'error'));
// The scheduler's look-ahead pump: a timer, since the console has no frame loop to drive it.
setInterval(() => host.update(), HOST_PUMP_INTERVAL_MS);
