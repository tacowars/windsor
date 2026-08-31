/**
 * The seam between the synth and Babylon's Audio Engine v2.
 *
 * Babylon accepts an externally-created `AudioContext` and can wrap an arbitrary
 * `AudioNode` as a spatialised sound source. So the synth owns the DSP, Babylon
 * owns positioning and bus routing, and there is one `AudioContext` in the
 * process rather than two competing for the output device.
 *
 * Verified against the installed typings at `@babylonjs/core` 9.23.0:
 *   IWebAudioEngineOptions.audioContext   AudioV2/webAudio/webAudioEngine.d.ts:22
 *   CreateSoundSourceAsync                AudioV2/abstractAudio/audioEngineV2.d.ts:282
 *   unlockAsync                           AudioV2/abstractAudio/audioEngineV2.d.ts:211
 *
 * Deep imports per CLAUDE.md invariant 5 -- the `@babylonjs/core` barrel pulls
 * the whole engine.
 */
import type { AbstractSoundSource } from '@babylonjs/core/AudioV2/abstractAudio/abstractSoundSource';
import type { AudioEngineV2 } from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2';
import { CreateSoundSourceAsync } from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2';
import { CreateAudioEngineAsync } from '@babylonjs/core/AudioV2/webAudio/webAudioEngine';

import type { AudioPart } from './audioPart';
import type { FmEngine } from './fmEngine';

/**
 * Build a Babylon audio engine that shares the synth's context.
 *
 * `unlockAsync()` is required before anything plays -- browser autoplay policy
 * means the context stays suspended until a user gesture. Call this from a
 * click or key handler, not at load.
 */
export async function createBabylonAudio(engine: FmEngine): Promise<AudioEngineV2> {
  const babylonAudio = await CreateAudioEngineAsync({ audioContext: engine.context });
  await babylonAudio.unlockAsync();
  return babylonAudio;
}

/**
 * Give a part a position in the world.
 *
 * The part is detached from the synth master first: Babylon takes over its
 * routing, and leaving it connected to both would sum it twice.
 */
export async function attachPartToBabylon(
  babylonAudio: AudioEngineV2,
  part: AudioPart,
  spatial = true,
): Promise<AbstractSoundSource> {
  part.output.disconnect();
  return await CreateSoundSourceAsync(
    part.name,
    part.output,
    { spatialEnabled: spatial },
    babylonAudio,
  );
}
