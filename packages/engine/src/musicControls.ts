/**
 * Player-facing music controls (issue #69, refinement decision 2): the music
 * starts at the first user gesture — the same gesture that unlocks the
 * `AudioContext` under autoplay policy — `M` toggles mute, and `music: false`
 * (`?music=0`) builds the whole graph but never starts the transport, so dev
 * sessions and harnesses stay silent without a second code path.
 *
 * main.ts hands in the logger, so this module stays out of the debug area and
 * the `music` console events remain the audible-flow evidence the browser
 * verification reads.
 */
import { ARRANGEMENT } from './arrangement';
import type { AudioSystem } from './audioSystem';

export type MusicLog = (fields: Record<string, string | number | boolean | null>) => void;

export function installMusicControls(system: AudioSystem, music: boolean, log: MusicLog): void {
  system.initMusic(ARRANGEMENT, (part, tick) => log({ state: 'note', part, tick }));
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
    if (event.code !== 'KeyM') return;
    log({ state: system.toggleMute() ? 'muted' : 'unmuted' });
  });
}
