/**
 * The one place a settings channel level reaches the audio graph (#518
 * decision 1). Two channels, no master: the FM engine's master gain stays the
 * 0.9 `fmEngine.ts` sets, because a master fader would scale the limiter's
 * headroom along with everything else.
 *
 * **Music is the music bus's own output gain, and the returns land on it.**
 * `AudioBus.output` is already a `GainNode` at unity, so the music fader adds
 * no node to the dry path (the reason `channelStrip.ts` gives for keeping the
 * fader k-rate inside the worklet). The plate and the delay are built into
 * that same gain rather than into the master, so turning the music down takes
 * its room with it instead of leaving a bare reverb tail — decision 1's "the
 * returns follow the music level", by the first of the two routes it offers.
 * The one consequence: a *SFX* strip with a send (`MIX.place` has
 * `room: 0.08`) has its return contribution scaled by the music level too.
 * No `createSfxPart` call site exists on main today, so nothing ships with
 * that behaviour; the alternative is a second plate per channel, which is DSP
 * bought for a send that is not yet in the game.
 *
 * **SFX is one value over two paths**: the SFX strips' dry gain
 * (`AudioSystem.setSfxGain`) and the spatial gameplay engine's volume, which
 * is `SpatialSfx`'s own 0..1 setter. Its unity is `SFX_LIMITS.volume` — what
 * the engine is set to on main — so channel gain 1 reproduces today's level
 * exactly rather than jumping to full scale (decision 6).
 */
import { SFX_LIMITS } from './sfxConstants.js';

/** What this needs of the FM graph; `AudioSystem` satisfies it. */
export interface MixGraph {
  setMusicGain(gain: number): void;
  setSfxGain(gain: number): void;
}

/** What it needs of the spatial engine; `SpatialSfx` and `GameplaySfx` both satisfy it. */
export interface SpatialVolume {
  setVolume(volume: number): void;
}

/**
 * The spatial engine's level at SFX channel gain 1 — the value `SpatialSfx`
 * constructs itself with, imported rather than restated (root #147 item 7).
 */
export const SPATIAL_SFX_UNITY = SFX_LIMITS.volume;

/** The spatial engine's volume for a channel gain. */
export function spatialVolumeFor(gain: number): number {
  return SPATIAL_SFX_UNITY * gain;
}

export interface MixLevels {
  /** The music channel's gain as last set; 1 until something sets it. */
  readonly musicGain: number;
  readonly sfxGain: number;
  setMusicLevel(gain: number): void;
  setSfxLevel(gain: number): void;
  /**
   * Hand over the spatial engine once it exists and apply the current level
   * at once — `createGameplaySfx` calls this between constructing it and the
   * first sound it could play (decision 5).
   */
  attachSpatial(spatial: SpatialVolume): void;
}

/**
 * What `createGameplaySfx` needs of the SFX channel: the level to construct
 * the spatial engine at, and the handle its `sfx` dev command writes through.
 * `MixLevels` satisfies it, and so does the settings-backed adapter
 * (`settings/audioSettings.ts`) that main.ts hands over, so the command moves
 * the same value the panel shows instead of being a second caller.
 */
export interface SfxLevels {
  readonly sfxGain: number;
  setSfxLevel(gain: number): void;
  attachSpatial(spatial: SpatialVolume): void;
}

/** A gain a fader may hold: finite, and inside 0..1. Anything else changes nothing. */
function usable(gain: number): number | null {
  if (!Number.isFinite(gain)) return null;
  return Math.min(1, Math.max(0, gain));
}

export function createMixLevels(graph: MixGraph): MixLevels {
  let music = 1;
  let sfx = 1;
  let spatial: SpatialVolume | null = null;

  return {
    get musicGain(): number {
      return music;
    },
    get sfxGain(): number {
      return sfx;
    },
    setMusicLevel(gain: number): void {
      const value = usable(gain);
      if (value === null) return;
      music = value;
      graph.setMusicGain(value);
    },
    setSfxLevel(gain: number): void {
      const value = usable(gain);
      if (value === null) return;
      sfx = value;
      graph.setSfxGain(value);
      spatial?.setVolume(spatialVolumeFor(value));
    },
    attachSpatial(next: SpatialVolume): void {
      spatial = next;
      next.setVolume(spatialVolumeFor(sfx));
    },
  };
}
