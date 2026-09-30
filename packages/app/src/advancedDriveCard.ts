/**
 * Advanced Drive edits the real song insert, as pages in the rack
 * (windsor#174, record `2026-09-30-insert-rack-and-send-bus-chains`
 * decision 3): Main (starting point, routing, tone compensation, the route
 * and the global knobs), one Stage page per stage the routing uses (its
 * switches, pickers, six knobs, both plots, then its six modulation
 * amounts), and Mod (the modulation sources). The on/off switch is the
 * rack's rail. A routing or starting-point change renders the rack, so the
 * Stage pages follow it; every other edit keeps the page as it is.
 */
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
import type { InsertCard, InsertPage } from './insertCards';
import type { InsertTarget } from './insertTarget';
import { insertChange, insertsOf } from './insertTarget';
import { driveSelect, driveToggle, driveKnob } from './advancedDriveControls';
import { drivePlots } from './advancedDrivePlots';
import type { DrivePage } from './advancedDriveModel';
import { drivePages, editDriveStage } from './advancedDriveModel';
import {
  DRIVE_GLOBAL_FIELDS,
  DRIVE_STAGE_FIELDS,
  DRIVE_SOURCE_FIELDS,
  DRIVE_MOD_FIELDS,
  DRIVE_ROUTE_FIELDS,
  DRIVE_ROUTE_LABELS,
  DRIVE_ROUTE_DIAGRAMS,
  DRIVE_SOURCE_HELP,
  DRIVE_SOURCE_NOTE,
} from './advancedDriveTables';
import {
  fitColumn,
  insertColumn,
  insertNote,
  insertPage,
  insertRule,
  knobColumns,
  wideColumn,
} from './insertLayout';

type GlobalNumber = keyof typeof ADVANCED_DRIVE_BOUNDS;
type StageNumber = keyof typeof DRIVE_STAGE_BOUNDS;

interface DriveView {
  current(): AdvancedDriveSpec;
  /** Send `spec`; with `render`, render the rack after (the pages may change). */
  commit(spec: AdvancedDriveSpec, render?: boolean): void;
}

const HZ_FIELDS: ReadonlySet<string> = new Set(['pivot', 'low', 'high', 'rate', 'frequency']);

/** The global knob for `key`, labelled `label`; `onKnob` runs after each turn. */
function globalKnob(
  view: DriveView,
  [key, label]: readonly [GlobalNumber, string],
  o: { readonly onKnob?: () => void; readonly big?: boolean | undefined } = {},
): HTMLElement {
  return driveKnob({
    label,
    bounds: ADVANCED_DRIVE_BOUNDS[key],
    def: DEFAULT_ADVANCED_DRIVE[key],
    get: () => view.current()[key],
    set: (value) => {
      view.commit({ ...view.current(), [key]: value });
      o.onKnob?.();
    },
    hz: HZ_FIELDS.has(key),
    big: o.big,
  });
}

/** The knobs of `fields` on the stage at `stage`, two to a column; `onKnob` runs after each turn. */
function stageKnobs(
  view: DriveView,
  stage: number,
  fields: readonly (readonly [StageNumber, string])[],
  onKnob?: () => void,
): HTMLElement[] {
  const knobs = fields.map(([key, label]) =>
    driveKnob({
      label,
      bounds: DRIVE_STAGE_BOUNDS[key],
      def: DEFAULT_DRIVE_STAGE[key],
      get: () => view.current().stages[stage]![key],
      set: (value) => {
        view.commit(editDriveStage(view.current(), stage, key, value));
        onKnob?.();
      },
      hz: HZ_FIELDS.has(key),
    }),
  );
  return knobColumns(knobs);
}

const byKey = (key: GlobalNumber): readonly [GlobalNumber, string] =>
  [...DRIVE_GLOBAL_FIELDS, ...DRIVE_SOURCE_FIELDS].find(([k]) => k === key)!;

function mainPage(view: DriveView): HTMLElement {
  const spec = view.current();
  const preset = driveSelect(
    'Starting point',
    ['', ...ADVANCED_DRIVE_PRESETS.map((p) => p.id)],
    matchingAdvancedDrivePreset(spec) ?? '',
    (id) => view.commit(applyAdvancedDrivePreset(view.current(), id), true),
    ['Custom', ...ADVANCED_DRIVE_PRESETS.map((p) => p.label)],
  );
  const showMatch = (): void => {
    preset.querySelector('select')!.value = matchingAdvancedDrivePreset(view.current()) ?? '';
  };
  const routing = driveSelect(
    'Routing',
    DRIVE_ROUTES,
    spec.route,
    (route) => view.commit({ ...view.current(), route: route as AdvancedDriveSpec['route'] }, true),
    DRIVE_ROUTE_LABELS,
  );
  const compensation = driveToggle('Tone compensation', spec.compensation, (on) =>
    view.commit({ ...view.current(), compensation: on }),
  );
  const knob = (key: GlobalNumber): HTMLElement =>
    globalKnob(view, byKey(key), { onKnob: showMatch });
  const routeKnobs = DRIVE_ROUTE_FIELDS[spec.route].map((field) =>
    globalKnob(view, field, { onKnob: showMatch }),
  );
  return insertPage(
    fitColumn(preset, routing, compensation),
    insertColumn(knob('drive'), knob('output')),
    insertColumn(knob('tone'), knob('pivot')),
    ...knobColumns(routeKnobs),
    insertColumn(globalKnob(view, byKey('mix'), { onKnob: showMatch, big: true })),
    wideColumn(insertNote(DRIVE_ROUTE_DIAGRAMS[DRIVE_ROUTES.indexOf(spec.route)]!)),
  );
}

function stagePage(view: DriveView, stage: number): HTMLElement {
  const now = (): DriveStageSpec => view.current().stages[stage]!;
  const plots = insertColumn();
  plots.classList.add('drive-plots');
  const draw = (): void => plots.replaceChildren(...drivePlots(now()));
  const set = <K extends keyof DriveStageSpec>(key: K, value: DriveStageSpec[K]): void => {
    view.commit(editDriveStage(view.current(), stage, key, value));
    draw();
  };
  const s = now();
  const switches = fitColumn(
    driveToggle('Stage on', s.enabled, (v) => set('enabled', v)),
    driveToggle('Shaper on', s.shaping, (v) => set('shaping', v)),
    driveToggle('Filter on', s.filtering, (v) => set('filtering', v)),
    driveToggle('Filter before shaper', s.pre, (v) => set('pre', v)),
  );
  const pickers = wideColumn(
    driveSelect('Shaper', DRIVE_SHAPERS, s.shaper, (v) =>
      set('shaper', v as DriveStageSpec['shaper']),
    ),
    driveSelect('Filter', DRIVE_FILTERS, s.filter, (v) =>
      set('filter', v as DriveStageSpec['filter']),
    ),
  );
  draw();
  return insertPage(
    switches,
    pickers,
    ...stageKnobs(view, stage, DRIVE_STAGE_FIELDS, draw),
    plots,
    insertRule(),
    ...stageKnobs(view, stage, DRIVE_MOD_FIELDS),
  );
}

function modPage(view: DriveView): HTMLElement {
  const spec = view.current();
  const rate = globalKnob(view, byKey('rate'));
  const dimRate = (): void => {
    rate.classList.toggle('dim', view.current().sync);
  };
  dimRate();
  const sources = wideColumn(
    driveToggle('Sync LFO', spec.sync, (sync) => {
      view.commit({ ...view.current(), sync });
      dimRate();
    }),
    driveSelect('Division', Object.keys(DRIVE_DIVISIONS), spec.division, (division) =>
      view.commit({ ...view.current(), division: division as AdvancedDriveSpec['division'] }),
    ),
    driveSelect('Wave', DRIVE_LFO_SHAPES, spec.wave, (wave) =>
      view.commit({ ...view.current(), wave: wave as AdvancedDriveSpec['wave'] }),
    ),
    insertNote(DRIVE_SOURCE_NOTE, DRIVE_SOURCE_HELP),
  );
  return insertPage(
    insertColumn(globalKnob(view, byKey('attack')), globalKnob(view, byKey('release'))),
    insertColumn(globalKnob(view, byKey('sensitivity')), rate),
    sources,
  );
}

function pageBody(view: DriveView, page: DrivePage): HTMLElement {
  if (page.kind === 'main') return mainPage(view);
  if (page.kind === 'stage') return stagePage(view, page.stage);
  return modPage(view);
}

export const advancedDriveCard: InsertCard = (ctx: AppCtx, target: InsertTarget, index) => {
  const view: DriveView = {
    current: () => {
      const spec = insertsOf(ctx, target)[index];
      return spec?.kind === 'advanced-drive' ? spec : DEFAULT_ADVANCED_DRIVE;
    },
    commit(spec, render = false): void {
      const inserts = [...insertsOf(ctx, target)];
      if (inserts[index]?.kind !== 'advanced-drive') return;
      inserts[index] = spec;
      if (ctx.change(insertChange(target, inserts)).ok && render) ctx.render();
    },
  };
  return drivePages(view.current().route).map((page): InsertPage => ({
    name: page.name,
    ...(page.kind === 'stage' ? { title: page.title } : {}),
    build: () => pageBody(view, page),
  }));
};
