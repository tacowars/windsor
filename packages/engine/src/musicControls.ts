/**
 * Player-facing music controls (issue #69, refinement decision 2): the music
 * starts at the first user gesture — the same gesture that unlocks the
 * `AudioContext` under autoplay policy — `M` toggles mute, and `music: false`
 * (`?music=0`) builds the whole graph but never starts the transport, so dev
 * sessions and harnesses stay silent without a second code path.
 *
 * The arrangement is a committed JSON document (issue #75), bundled at build
 * time — a malformed file fails the build and cannot reach a running game —
 * and chosen by `?music=<name>` (`arrangementLibrary.ts`, #435); main.ts
 * hands the selection in. It is normalised here like any document: a
 * repaired document logs what was corrected and still plays; an unusable
 * one, or a name no committed file carries, announces itself as the
 * metronome fallback — loud, per the record, never a silent default.
 *
 * main.ts hands in the logger, so this module stays out of the debug area and
 * the `music` console events remain the audible-flow evidence the browser
 * verification reads.
 *
 * The dev console (#119) is handed in the same way: a `CommandSink` type and
 * nothing else, so `music on|off` is registered by the system that owns the
 * mute rather than by a central command table, and this file still has no
 * dependency on the console's DOM. The command is registered even under
 * `?music=0` — it reports the suppressed transport honestly, which is more
 * use than a missing command.
 */
import type { CommandSink } from '../debug/console/commandRegistry';
import { parseOnOff } from '../debug/console/commandRegistry';
import { makeArrangement } from './arrangementDocument';
import type { AudioSystem } from './audioSystem';

export type MusicLog = (fields: Record<string, string | number | boolean | null>) => void;

/** What plays: the selection `selectMusic` made from the query string. */
export interface MusicChoice {
  readonly enabled: boolean;
  readonly name: string;
  readonly raw: unknown;
}

export function installMusicControls(
  system: AudioSystem,
  choice: MusicChoice,
  log: MusicLog,
  commands?: CommandSink,
): void {
  const music = choice.enabled;
  if (!music) system.suppressMusic();
  const { document, corrections, usable } = makeArrangement(choice.raw);
  if (choice.raw === undefined) {
    corrections.unshift(`no committed arrangements/${choice.name}.json — the fallback click plays`);
  }
  if (!usable || corrections.length > 0) {
    log({ state: 'arrangement', name: choice.name, usable, corrections: corrections.join('; ') });
  }
  system.initMusic(document, (part, tick) => log({ state: 'note', part, tick }));
  commands?.register(
    'music',
    'music [on|off] — unmute or mute the music (the `M` key); no argument reports it',
    (args) => {
      const want = parseOnOff(args[0]);
      if (want !== undefined) setMuted(system, !want, log);
      return `music ${system.isMuted ? 'off' : 'on'} — transport ${
        system.musicRunning ? 'running' : 'stopped'
      }`;
    },
  );
  const unlock = (): void =>
    void system.unlock().then(() => {
      if (!music || system.musicRunning || system.isMuted) return;
      system.startMusic();
      const r = system.readout();
      log({ state: 'started', bpm: r.bpm, root: r.root, scale: String(r.scale) });
    });
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  if (!music) return;
  window.addEventListener('keydown', (event) => {
    // `repeat`: a held M autorepeats keydown; one press is one toggle.
    if (event.code !== 'KeyM' || event.repeat) return;
    setMuted(system, !system.isMuted, log);
  });
}

/** The one writer of the mute after boot, so the `M` key and `music on|off` log alike. */
function setMuted(system: AudioSystem, muted: boolean, log: MusicLog): void {
  if (system.isMuted === muted) return;
  system.setMuted(muted);
  log({ state: muted ? 'muted' : 'unmuted' });
}
