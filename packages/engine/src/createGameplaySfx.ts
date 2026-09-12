import type { CommandSink } from '../debug/console/commandRegistry';
import type { AudioSystem } from './audioSystem';
import { GameplaySfx, type GameplaySfxDeps } from './gameplaySfx';
import { loadSfxBuffers } from './sfxBuffers';
import { SFX_LIMITS } from './sfxConstants';
import { SpatialSfx } from './spatialSfx';

/** Composition seam; decoding and baking finish before spatial playback is constructed. */
export async function createGameplaySfx(
  music: AudioSystem,
  deps: GameplaySfxDeps,
  commands?: CommandSink,
): Promise<GameplaySfx> {
  const buffers = await loadSfxBuffers(music.engine.context);
  const audio = await SpatialSfx.create(music.engine.context, buffers);
  const system = new GameplaySfx(audio, deps);
  let volume: number = SFX_LIMITS.volume;
  commands?.register(
    'sfx',
    'sfx [on|off|0..1] — gameplay sound volume, independent of music',
    (args) => {
      if (args[0] !== undefined) {
        const value =
          args[0] === 'on' ? SFX_LIMITS.volume : args[0] === 'off' ? 0 : Number(args[0]);
        if (!Number.isFinite(value) || value < 0 || value > 1)
          return 'Use sfx on, off, or a volume from 0 to 1';
        volume = value;
        system.setVolume(value);
      }
      return `sfx volume ${volume}`;
    },
  );
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    system.dispose();
    music.dispose();
  });
  return system;
}
