/** Approximation bank: selecting a preset writes all sound parameters; Mix and bypass stay user-owned. */
import { DEFAULT_RETRO_REVERB } from './retroReverbSpec';
import type { RetroReverbSpec } from './retroReverbSpec';
import {
  RETRO_ROOM_TABLE,
  RETRO_PRESET_SIZES,
  RETRO_PRESET_TONES,
  RETRO_GATE_DURATIONS,
  RETRO_REVERSE_DURATIONS,
  RETRO_PRESET_DIFFUSION,
  RETRO_PRESET_CHARACTER,
  RETRO_GATE_FIRST,
  RETRO_REVERSE_FIRST,
  RETRO_MILLISECONDS,
} from './retroReverbPresetTables';

type Settings = Omit<RetroReverbSpec, 'kind' | 'mix' | 'enabled'>;
export interface RetroReverbPreset {
  readonly number: number;
  readonly label: string;
  readonly settings: Settings;
}

const base: Settings = {
  mode: 'reverb',
  decay: DEFAULT_RETRO_REVERB.decay,
  size: DEFAULT_RETRO_REVERB.size,
  tone: DEFAULT_RETRO_REVERB.tone,
  diffusion: RETRO_PRESET_DIFFUSION,
  preDelay: DEFAULT_RETRO_REVERB.preDelay,
  character: RETRO_PRESET_CHARACTER,
  duration: DEFAULT_RETRO_REVERB.duration,
};

export const RETRO_REVERB_PRESETS: readonly RetroReverbPreset[] = [
  ...RETRO_ROOM_TABLE.map(([decay, size, tone], i) => ({
    number: i + 1,
    label: `${String(i + 1).padStart(2, '0')} · ${decay}s ${size} ${tone}`,
    settings: { ...base, decay, size: RETRO_PRESET_SIZES[size], tone: RETRO_PRESET_TONES[tone] },
  })),
  ...RETRO_GATE_DURATIONS.map((duration, i) => ({
    number: RETRO_GATE_FIRST + i,
    label: `${RETRO_GATE_FIRST + i} · Gated ${Math.round(duration * RETRO_MILLISECONDS)}ms`,
    settings: { ...base, mode: 'gated' as const, duration },
  })),
  ...RETRO_REVERSE_DURATIONS.map((duration, i) => ({
    number: RETRO_REVERSE_FIRST + i,
    label: `${RETRO_REVERSE_FIRST + i} · Reverse ${Math.round(duration * RETRO_MILLISECONDS)}ms`,
    settings: { ...base, mode: 'reverse' as const, duration },
  })),
];

export function applyRetroPreset(spec: RetroReverbSpec, number: number): RetroReverbSpec {
  const preset = RETRO_REVERB_PRESETS.find((entry) => entry.number === number);
  return preset ? { ...spec, ...preset.settings } : spec;
}

export function matchingRetroPreset(spec: RetroReverbSpec): number | undefined {
  return RETRO_REVERB_PRESETS.find((preset) =>
    (Object.keys(preset.settings) as Array<keyof Settings>).every(
      (key) => preset.settings[key] === spec[key],
    ),
  )?.number;
}
