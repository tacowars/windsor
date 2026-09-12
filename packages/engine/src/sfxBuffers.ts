import type { SfxBuffers } from './spatialSfx';
import { renderPatchToBuffer } from './offlineRender';
import { SFX_PRESETS } from './presetsSfx';
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
    renderPatchToBuffer(SFX_PRESETS['weapon-zap']!, {
      duration: SFX_LIMITS.bakeDuration,
      tail: SFX_LIMITS.bakeTail,
      sampleRate: context.sampleRate,
    }),
    renderPatchToBuffer(SFX_PRESETS['pickup-blip']!, {
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
