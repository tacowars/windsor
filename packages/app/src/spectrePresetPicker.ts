/**
 * Spectre's Starting point picker (record `2026-10-17-spectre-drawn-cells`
 * decision 12), on the Reverb's pattern (`returnControls.ts`'s
 * `spacePicker`): `custom` when nothing matches, then the bank under its
 * groups. A pick writes the preset's whole sound in one undo step, the
 * user's Mix, Output, Freeze switch and on/off kept; `refresh` reads the
 * match back after any edit, from the card or the workbench. `picked` runs
 * after a pick, so the owner repaints what the preset moved.
 */
import {
  SPECTRE_PRESET_GROUPS,
  SPECTRE_PRESETS,
  applySpectrePreset,
  matchingSpectrePreset,
} from '@windsor/engine';
import type { SpectreSpec } from '@windsor/engine';
import { groupedSelect } from './dom';
import { withGesture } from './gestureHooks';
import type { RefreshingControl } from './returnControls';
import { SPECTRE_BENCH_LABELS } from './spectreBenchTables';

const GROUPS = SPECTRE_PRESET_GROUPS.map((group) => ({
  group,
  options: SPECTRE_PRESETS.filter((p) => p.group === group).map((p) => ({
    value: String(p.number),
    label: p.label,
  })),
}));

/** The picker over `current()`, committing through `commit`, then calling `picked`. */
export function spectrePresetPicker(
  current: () => SpectreSpec,
  commit: (next: SpectreSpec) => void,
  picked: () => void,
): RefreshingControl {
  let refresh = (): void => {};
  const root = groupedSelect(SPECTRE_BENCH_LABELS.presetPicker, GROUPS, '', (value) => {
    if (value === '') return;
    const preset = SPECTRE_PRESETS.find((p) => p.number === Number(value));
    withGesture(`Spectre ${preset?.label ?? ''}`.trim(), () =>
      commit(applySpectrePreset(current(), Number(value))),
    );
    refresh();
    picked();
  });
  const sel = root.querySelector('select') as HTMLSelectElement;
  const custom = new Option('custom', '');
  refresh = (): void => {
    const match = matchingSpectrePreset(current());
    if (match !== undefined) custom.remove();
    else if (custom.parentElement !== sel) sel.insertBefore(custom, sel.firstChild);
    sel.value = match === undefined ? '' : String(match);
  };
  refresh();
  return { root, refresh };
}
