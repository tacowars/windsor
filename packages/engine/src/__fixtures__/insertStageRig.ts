/**
 * One insert stage on a fake context, for the insert lanes' tests
 * (windsor#345): a kind's open spec, a catalog field read and written by its
 * path (`bands.3.freq` included), a value in a row's range away from another,
 * and the stage built with every param it made, by name. Node-only, like the
 * rest of this directory.
 */
import type { AutomationTargetRow } from '../automation/automationLane';
import type { InsertKindName, InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import { FakeContext } from './fakeAudioContext';
import type { FakeParam } from './fakeAudioNodes';
import { graphParams } from './insertParamRig';

/**
 * Each kind's defaults, switched on, with both delay sides free: a synced
 * side's time comes from the tempo, so `set` would not show the field.
 */
export function openSpec(kind: InsertKindName): InsertSpec {
  const spec = { ...INSERT_KINDS[kind].defaults, enabled: true } as InsertSpec;
  return spec.kind === 'delay' ? { ...spec, leftSync: false, rightSync: false } : spec;
}

/** `spec` with the catalog field `field` (`bands.3.freq` included) at `value`. */
export function withField(spec: InsertSpec, field: string, value: number): InsertSpec {
  const put = (node: unknown, path: readonly string[]): unknown => {
    const [head, ...rest] = path;
    const child = rest.length === 0 ? value : undefined;
    if (Array.isArray(node)) {
      return node.map((item, i) => (String(i) === head ? (child ?? put(item, rest)) : item));
    }
    const record = node as Record<string, unknown>;
    return { ...record, [head!]: child ?? put(record[head!], rest) };
  };
  return put(spec, field.split('.')) as InsertSpec;
}

/** A value in `row`'s range at `share` of it, moved on if that is `from`. */
export function otherValue(row: AutomationTargetRow, from: number, share = 0.37): number {
  const at = (s: number): number => row.min + s * (row.max - row.min);
  return at(share) === from ? at(share + 0.24) : at(share);
}

/** The catalog field `field`'s value in `spec`. */
export const fieldValue = (spec: InsertSpec, field: string): number =>
  field
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], spec) as number;

/** A stage, every param its graph built by name, and its context. */
export interface Built {
  readonly stage: InsertStage<InsertSpec>;
  readonly params: ReadonlyMap<string, FakeParam>;
  readonly context: FakeContext;
}

/** `spec`'s stage, with the build's own automation calls cleared. */
export function build(spec: InsertSpec): Built {
  const context = new FakeContext();
  const stage = INSERT_KINDS[spec.kind].create(context.asAudioContext(), spec);
  const params = new Map(graphParams(context).map(({ name, param }) => [name, param]));
  for (const param of params.values()) param.automation.length = 0;
  return { stage, params, context };
}

/** Every param's value now, by name. */
export const values = (built: Built): Map<string, number> =>
  new Map([...built.params].map(([name, param]) => [name, param.value]));

/** The names of the params any automation call reached. */
export const touched = (built: Built): string[] =>
  [...built.params].filter(([, p]) => p.automation.length > 0).map(([name]) => name);
