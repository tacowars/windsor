/**
 * Spectre's workbench Shape row (record `2026-10-17-spectre-drawn-cells`
 * decision 10): the generators with their settings and Apply, the lane they
 * write to, and the transforms. A generator's shape shows as a ghost on its
 * lane while it is picked, written within the selection on Apply (or Enter)
 * and dropped by Esc; a transform writes at once. The settings are the
 * workbench's own, never the song's.
 */
import { STRIP_COLOR } from './consoleColors';
import { el, seg } from './dom';
import { makeKnob } from './knob';
import {
  SPECTRE_BENCH_LABELS,
  SPECTRE_GENERATOR_SETTINGS,
  SPECTRE_GENERATORS,
  SPECTRE_LANE_LABELS,
  SPECTRE_LANES,
  SPECTRE_SHAPE_SETTINGS,
  SPECTRE_TRANSFORMS,
} from './spectreBenchTables';
import type { SpectreGenerator, SpectreShapeSetting, SpectreTransform } from './spectreBenchTables';
import type { SpectreCurve } from '@windsor/engine';

/** What the Shape row reads and asks of its workbench. */
export interface SpectreShapeHost {
  /** The generator picked, or null while none previews. */
  generator(): SpectreGenerator | null;
  pickGenerator(next: SpectreGenerator | null): void;
  setting(key: SpectreShapeSetting): number;
  setSetting(key: SpectreShapeSetting, value: number): void;
  focus(): SpectreCurve;
  setFocus(curve: SpectreCurve): void;
  apply(): void;
  transform(id: SpectreTransform): void;
}

const fmt =
  (key: SpectreShapeSetting) =>
  (v: number): string =>
    key === 'root' || key === 'count' || key === 'width' || key === 'seed'
      ? String(Math.round(v))
      : key === 'period'
        ? `${v.toFixed(2)} oct`
        : v.toFixed(2);

/** A seg's buttons pressed to match `current`, as its own sync does, for a change made elsewhere. */
function pressed(box: HTMLElement, values: readonly string[], current: string | null): void {
  [...box.children].forEach((child, i) => {
    child.setAttribute('aria-pressed', String(values[i] === current));
  });
}

/** A plain button for a transform. */
function transformButtons(host: SpectreShapeHost): HTMLElement {
  const transforms = el('div', 'spectre-transforms');
  for (const t of SPECTRE_TRANSFORMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.label;
    b.title = t.hint;
    b.onclick = (): void => host.transform(t.id);
    transforms.append(b);
  }
  return transforms;
}

/** The knobs of the generator picked, into `settings`. */
function settingKnobs(
  host: SpectreShapeHost,
  settings: HTMLElement,
  picked: SpectreGenerator,
): void {
  settings.replaceChildren(
    ...SPECTRE_GENERATOR_SETTINGS[picked].map((key) => {
      const s = SPECTRE_SHAPE_SETTINGS[key];
      return makeKnob({
        label: s.label,
        min: s.range[0],
        max: s.range[1],
        def: s.def,
        dial: 'rack',
        fmt: fmt(key),
        get: () => host.setting(key),
        set: (v) => host.setSetting(key, v),
      });
    }),
  );
}

/** A labelled line of the row. */
function line(...parts: (string | HTMLElement)[]): HTMLElement {
  const row = el('div', 'spectre-shape-line');
  row.append(
    ...parts.map((p) => (typeof p === 'string' ? el('span', 'spectre-shape-label', p) : p)),
  );
  return row;
}

/** The row's two lines; `refresh` redraws the picks and the settings for the generator picked. */
export function spectreShapeRow(host: SpectreShapeHost): { element: HTMLElement; refresh(): void } {
  const settings = el('div', 'spectre-shape-settings');
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'spectre-apply';
  apply.textContent = SPECTRE_BENCH_LABELS.apply;
  apply.title = SPECTRE_BENCH_LABELS.applyHint;
  apply.onclick = (): void => host.apply();
  const generators = seg(
    SPECTRE_GENERATORS.map((g) => ({ value: g.id, label: g.label })),
    () => host.generator() ?? '',
    (value) => {
      host.pickGenerator(host.generator() === value ? null : (value as SpectreGenerator));
      refresh();
    },
    STRIP_COLOR,
  );
  const lanes = seg(
    SPECTRE_LANES.map(({ curve, key }) => ({
      value: curve,
      label: `${key} ${SPECTRE_LANE_LABELS[curve]}`,
    })),
    () => host.focus(),
    (value) => {
      host.setFocus(value as SpectreCurve);
      refresh();
    },
    STRIP_COLOR,
  );
  const refresh = (): void => {
    pressed(
      generators,
      SPECTRE_GENERATORS.map((g) => g.id),
      host.generator(),
    );
    pressed(
      lanes,
      SPECTRE_LANES.map((l) => l.curve),
      host.focus(),
    );
    const picked = host.generator();
    apply.disabled = picked === null;
    if (picked) settingKnobs(host, settings, picked);
    else settings.replaceChildren();
  };
  const element = el('div', 'spectre-shape');
  element.append(
    line(SPECTRE_BENCH_LABELS.shape, generators, settings, apply),
    line(SPECTRE_BENCH_LABELS.lane, lanes, SPECTRE_BENCH_LABELS.transform, transformButtons(host)),
  );
  refresh();
  return { element, refresh };
}
