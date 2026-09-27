import type { SfxBuffers } from './spatialSfx';
import { renderPatchToBuffer } from './offlineRender';
import { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from '../patch/gameplayPatches';
import { SFX_LIMITS } from './sfxConstants';

import SAMPLE_URLS from 'virtual:a204-audio';

export async function loadSfxBuffers(context: AudioContext): Promise<SfxBuffers> {
  const decode = async (url: string): Promise<AudioBuffer> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`SFX load failed: ${response.status}`);
    return context.decodeAudioData(await response.arrayBuffer());
  };
  const [step, impact, weapon, pickup, build, repair, mine, deplete] = await Promise.all([
    Promise.all(SAMPLE_URLS.step.map(decode)),
    Promise.all(SAMPLE_URLS.impact.map(decode)),
    renderPatchToBuffer(GAMEPLAY_PATCHES[GAMEPLAY_PATCH_IDS.weaponZap], {
      duration: SFX_LIMITS.bakeDuration,
      tail: SFX_LIMITS.bakeTail,
      sampleRate: context.sampleRate,
    }),
    renderPatchToBuffer(GAMEPLAY_PATCHES[GAMEPLAY_PATCH_IDS.pickupBlip], {
      duration: SFX_LIMITS.bakeDuration,
      tail: SFX_LIMITS.bakeTail,
      sampleRate: context.sampleRate,
    }),
    ...['build', 'repair', 'mine', 'deplete'].map((bank) => {
      const urls = SAMPLE_URLS[bank];
      if (!urls?.length) throw new Error(`Missing SFX bank: ${bank}`);
      return Promise.all(urls.map(decode));
    }),
  ]);
  return {
    step,
    impact,
    weapon: [weapon],
    pickup: [pickup],
    build: build!,
    repair: repair!,
    mine: mine!,
    deplete: deplete!,
  };
}
