/** Advanced Drive edits the real song insert; local stage selection is editor-only. */
import {
  DEFAULT_ADVANCED_DRIVE,
  DEFAULT_DRIVE_STAGE,
  ADVANCED_DRIVE_BOUNDS,
  DRIVE_STAGE_BOUNDS,
  DRIVE_ROUTES,
  DRIVE_SHAPERS,
  DRIVE_FILTERS,
  DRIVE_LFO_SHAPES,
  DRIVE_DIVISIONS,
  ADVANCED_DRIVE_PRESETS,
  applyAdvancedDrivePreset,
  matchingAdvancedDrivePreset,
} from '@windsor/engine';
import type { AdvancedDriveSpec, DriveStageSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertCard } from './insertCards';
import type { InsertTarget } from './insertTarget';
import { insertChange, insertsOf } from './insertTarget';
import { el } from './dom';
import type { KnobElement } from './knob';
import { driveSelect, driveToggle, driveKnob } from './advancedDriveControls';
import { drivePlots } from './advancedDrivePlots';
import { editDriveStage } from './advancedDriveModel';
import {
  DRIVE_GLOBAL_FIELDS,
  DRIVE_STAGE_FIELDS,
  DRIVE_SOURCE_FIELDS,
  DRIVE_MOD_FIELDS,
  DRIVE_ROUTE_LABELS,
  DRIVE_ROUTE_DIAGRAMS,
} from './advancedDriveTables';

type GlobalNumber = keyof typeof ADVANCED_DRIVE_BOUNDS;
type StageNumber = keyof typeof DRIVE_STAGE_BOUNDS;
interface DriveView {
  current(): AdvancedDriveSpec;
  commit(spec: AdvancedDriveSpec, redraw?: boolean): void;
  selected: number;
  plots: HTMLElement;
  root: HTMLElement;
  draw(): void;
}
function globalKnobs(
  view: DriveView,
  fields: readonly (readonly [GlobalNumber, string])[],
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const [key, label] of fields)
    row.append(
      driveKnob({
        label,
        bounds: ADVANCED_DRIVE_BOUNDS[key],
        def: DEFAULT_ADVANCED_DRIVE[key],
        get: () => view.current()[key],
        set: (value) => view.commit({ ...view.current(), [key]: value }),
        hz: key === 'pivot' || key === 'low' || key === 'high' || key === 'rate',
      }),
    );
  return row;
}
function stageKnobs(
  view: DriveView,
  fields: readonly (readonly [StageNumber, string])[],
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const [key, label] of fields)
    row.append(
      driveKnob({
        label,
        bounds: DRIVE_STAGE_BOUNDS[key],
        def: DEFAULT_DRIVE_STAGE[key],
        get: () => view.current().stages[view.selected]![key],
        set: (value) => {
          view.commit(editDriveStage(view.current(), view.selected, key, value));
          view.plots.replaceChildren(drivePlots(view.current().stages[view.selected]!));
        },
        hz: key === 'frequency',
      }),
    );
  return row;
}
function sources(view: DriveView): HTMLElement {
  const root = el('details', 'drive-section'),
    spec = view.current();
  root.append(el('summary', '', 'Modulation sources'), globalKnobs(view, DRIVE_SOURCE_FIELDS));
  const row = el('div', 'knob-row');
  row.append(
    driveToggle('Sync LFO', spec.sync, (sync) => view.commit({ ...view.current(), sync }, true)),
    driveSelect('Division', Object.keys(DRIVE_DIVISIONS), spec.division, (division) =>
      view.commit({ ...view.current(), division: division as AdvancedDriveSpec['division'] }),
    ),
    driveSelect('Wave', DRIVE_LFO_SHAPES, spec.wave, (wave) =>
      view.commit({ ...view.current(), wave: wave as AdvancedDriveSpec['wave'] }),
    ),
  );
  root.append(
    row,
    el(
      'p',
      'hint',
      'Envelope follows this insert’s stereo input. Cutoff modulation is in octaves. LFO Hz applies when Sync is off.',
    ),
  );
  return root;
}
function stagePanel(view: DriveView): HTMLElement {
  const spec = view.current(),
    stage = spec.stages[view.selected]!;
  const root = el('div', 'drive-section'),
    tabs = el('div', 'knob-row');
  const names =
    spec.route === 'multiband'
      ? ['Low', 'Mid', 'High']
      : spec.route === 'mid-side'
        ? ['Mid', 'Side']
        : spec.route === 'single'
          ? ['Stage 1']
          : ['Stage 1', 'Stage 2'];
  names.forEach((name, i) => {
    const button = el('button', i === view.selected ? 'btn active' : 'btn', name);
    button.setAttribute('aria-pressed', String(i === view.selected));
    button.onclick = (): void => {
      view.selected = i;
      view.draw();
    };
    tabs.append(button);
  });
  const row = el('div', 'knob-row');
  const set = <K extends keyof DriveStageSpec>(key: K, value: DriveStageSpec[K]): void =>
    view.commit(editDriveStage(view.current(), view.selected, key, value), true);
  row.append(
    driveToggle('Stage on', stage.enabled, (v) => set('enabled', v)),
    driveToggle('Shaper on', stage.shaping, (v) => set('shaping', v)),
    driveSelect('Shaper', DRIVE_SHAPERS, stage.shaper, (v) =>
      set('shaper', v as DriveStageSpec['shaper']),
    ),
    driveToggle('Filter on', stage.filtering, (v) => set('filtering', v)),
    driveSelect('Filter', DRIVE_FILTERS, stage.filter, (v) =>
      set('filter', v as DriveStageSpec['filter']),
    ),
    driveToggle('Filter before shaper', stage.pre, (v) => set('pre', v)),
  );
  view.plots = el('div');
  view.plots.append(drivePlots(stage));
  const mod = el('details', 'drive-section');
  mod.append(el('summary', '', 'Stage modulation amounts'), stageKnobs(view, DRIVE_MOD_FIELDS));
  root.append(tabs, row, stageKnobs(view, DRIVE_STAGE_FIELDS), view.plots, mod);
  return root;
}
function drawDrive(view: DriveView): void {
  const spec = view.current();
  if (spec.route === 'single') view.selected = 0;
  else if (spec.route !== 'multiband') view.selected = Math.min(1, view.selected);
  const row = el('div', 'knob-row');
  row.append(
    driveSelect(
      'Starting point',
      ['', ...ADVANCED_DRIVE_PRESETS.map((p) => p.id)],
      matchingAdvancedDrivePreset(spec) ?? '',
      (id) => view.commit(applyAdvancedDrivePreset(view.current(), id), true),
      ['Custom', ...ADVANCED_DRIVE_PRESETS.map((p) => p.label)],
    ),
    driveToggle('Advanced Drive', spec.enabled, (enabled) =>
      view.commit({ ...view.current(), enabled }, true),
    ),
    driveSelect(
      'Routing',
      DRIVE_ROUTES,
      spec.route,
      (route) =>
        view.commit({ ...view.current(), route: route as AdvancedDriveSpec['route'] }, true),
      DRIVE_ROUTE_LABELS,
    ),
    driveToggle('Tone compensation', spec.compensation, (compensation) =>
      view.commit({ ...view.current(), compensation }),
    ),
  );
  const route = el('div', 'hint', DRIVE_ROUTE_DIAGRAMS[DRIVE_ROUTES.indexOf(spec.route)]);
  view.root.replaceChildren(row, route, globalKnobs(view, DRIVE_GLOBAL_FIELDS));
  if (spec.route === 'multiband')
    view.root.append(
      globalKnobs(view, [
        ['low', 'Low crossover Hz'],
        ['high', 'High crossover Hz'],
      ]),
    );
  if (spec.route === 'serial' || spec.route === 'parallel')
    view.root.append(globalKnobs(view, [['blend', 'Blend']]));
  view.root.append(stagePanel(view), sources(view));
}
function advancedDriveBody(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
  const view: DriveView = {
    root: el('div', 'advanced-drive-card'),
    plots: el('div'),
    selected: 0,
    current: () => {
      const spec = insertsOf(ctx, target)[index];
      return spec?.kind === 'advanced-drive' ? spec : DEFAULT_ADVANCED_DRIVE;
    },
    commit(spec, redraw = false): void {
      const inserts = [...insertsOf(ctx, target)];
      if (inserts[index]?.kind !== 'advanced-drive') return;
      inserts[index] = spec;
      if (!ctx.change(insertChange(target, inserts)).ok) return;
      if (redraw) view.draw();
      else {
        for (const knob of view.root.querySelectorAll<KnobElement>('.knob')) knob.refresh();
        const picker = view.root.querySelector<HTMLSelectElement>(
          'select[aria-label="Starting point"]',
        );
        if (picker) picker.value = matchingAdvancedDrivePreset(view.current()) ?? '';
      }
    },
    draw: () => drawDrive(view),
  };
  view.draw();
  return view.root;
}

/** Today's controls as one page whose body scrolls inside the rack's height (windsor#173; windsor#174 pages it). */
export const advancedDriveCard: InsertCard = (ctx, target, index) => [
  { name: 'Advanced Drive', build: () => advancedDriveBody(ctx, target, index) },
];
