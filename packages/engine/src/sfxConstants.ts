/** Authored playback limits, independent of simulation rules. */
export const SFX_LIMITS = {
  voices: 24,
  volume: 0.65,
  pitchCents: 65,
  gainVariation: 0.1,
  minDistance: 2,
  footstepRange: 22,
  combatRange: 65,
  strideM: 1.6,
  teleportM: 4,
  maxFrameSeconds: 0.25,
  staleSeconds: 0.5,
  bakeDuration: 0.2,
  bakeTail: 0.3,
} as const;

export type SfxKind = 'step' | 'impact' | 'weapon';
export interface SfxPosition {
  x: number;
  y: number;
  z: number;
}

export const SFX_BANKS = {
  step: { range: SFX_LIMITS.footstepRange, gain: 0.5 },
  impact: { range: SFX_LIMITS.combatRange, gain: 0.65 },
  weapon: { range: SFX_LIMITS.combatRange, gain: 0.5 },
} as const;
