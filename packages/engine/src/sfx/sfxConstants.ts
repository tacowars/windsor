/** Authored playback limits, independent of simulation rules. */
export const SFX_LIMITS = {
  voices: 24,
  pendingActions: 64,
  actionRange: 35,
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

export type SfxKind =
  'step' | 'impact' | 'weapon' | 'build' | 'repair' | 'mine' | 'deplete' | 'pickup';
export interface SfxPosition {
  x: number;
  y: number;
  z: number;
}

export const SFX_BANKS = {
  build: { range: SFX_LIMITS.actionRange, gain: 0.65 },
  repair: { range: SFX_LIMITS.actionRange, gain: 0.5 },
  mine: { range: SFX_LIMITS.actionRange, gain: 0.55 },
  deplete: { range: SFX_LIMITS.actionRange, gain: 0.5 },
  pickup: { range: SFX_LIMITS.actionRange, gain: 0.2 },
  step: { range: SFX_LIMITS.footstepRange, gain: 0.5 },
  impact: { range: SFX_LIMITS.combatRange, gain: 0.65 },
  weapon: { range: SFX_LIMITS.combatRange, gain: 0.5 },
} as const;
