import type { CommandSink } from '../debug/console/commandRegistry';
import type { AudioSystem } from './audioSystem';
import { GameplaySfx, type GameplaySfxDeps } from './gameplaySfx';
import { createMixLevels, type SfxLevels } from './mixLevels';
import { loadSfxBuffers } from './sfxBuffers';
import { SpatialSfx } from './spatialSfx';

/**
 * Composition seam; decoding and baking finish before spatial playback is
 * constructed.
 *
 * `levels` is the SFX channel (#518): the spatial engine is attached to it the
 * moment it exists and before any sound could play, so the level a player
 * stored is the level the first footstep is made at (decision 5). It is also
 * what the `sfx` dev command writes, so the command and the settings panel
 * hold one value rather than two. Omitted — a test, or a page with no
 * settings — the mixer's own levels stand in, and the graph runs at unity.
 */
export async function createGameplaySfx(
  music: AudioSystem,
  deps: GameplaySfxDeps,
  commands?: CommandSink,
  levels: SfxLevels = createMixLevels(music),
): Promise<GameplaySfx> {
  const buffers = await loadSfxBuffers(music.engine.context);
  const audio = await SpatialSfx.create(music.engine.context, buffers);
  levels.attachSpatial(audio);
  const system = new GameplaySfx(audio, deps);
  commands?.register(
    'sfx',
    'sfx [on|off|0..1] — the settings panel’s SFX level, independent of music',
    (args) => {
      if (args[0] !== undefined) {
        const value = args[0] === 'on' ? 1 : args[0] === 'off' ? 0 : Number(args[0]);
        if (!Number.isFinite(value) || value < 0 || value > 1)
          return 'Use sfx on, off, or a level from 0 to 1';
        levels.setSfxLevel(value);
      }
      return `sfx level ${levels.sfxGain}`;
    },
  );
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    system.dispose();
    music.dispose();
  });
  return system;
}
