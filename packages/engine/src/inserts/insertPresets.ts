/**
 * An insert's preset bank, generically (#695; the phaser's `phaserPresets.ts`
 * is the shape). Selecting a preset writes its values into the spec, so a song
 * never depends on a bank version; any field a preset does not name — `mix`,
 * `enabled` — stays the user's. A spec whose values are no preset's reads as
 * Custom (`undefined`).
 */

/** Where a preset's numbers come from: a public source, and whether it states them. */
export interface PresetSource {
  /** The public pages the values were read from; empty for an original recipe. */
  readonly urls: readonly string[];
  /** True when the source states the values; false when they are an approximation of it. */
  readonly measured: boolean;
}

export interface InsertPreset<S> {
  readonly id: string;
  readonly label: string;
  readonly settings: Partial<S>;
  readonly source: PresetSource;
}

export function applyInsertPreset<S>(presets: readonly InsertPreset<S>[], spec: S, id: string): S {
  const preset = presets.find((entry) => entry.id === id);
  return preset ? { ...spec, ...preset.settings } : spec;
}

export function matchingInsertPreset<S>(
  presets: readonly InsertPreset<S>[],
  spec: S,
): string | undefined {
  return presets.find((preset) =>
    (Object.keys(preset.settings) as Array<keyof S>).every(
      (key) => preset.settings[key] === spec[key],
    ),
  )?.id;
}
