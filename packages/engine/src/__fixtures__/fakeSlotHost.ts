/**
 * A fake native host insert and two child kinds, for the slot's tests
 * (windsor#688): a host whose wet path is three plain gains and whose `route`
 * only records its calls, and children that count their builds, `set`s and
 * disposals and hand out a handle per field, so a test can tell which child
 * `param` reached. Node-only, like the rest of this directory.
 */
import type { AutomationHandle } from '../automation/automationHandles';
import type {
  InsertKind,
  InsertRegistry,
  InsertSpec,
  InsertStage,
} from '../inserts/insertRegistry';

/** A spec of any fake kind here: a host's carries its child in `slot`. */
export interface FakeSlotSpec {
  readonly kind: 'host' | 'tint' | 'tone';
  readonly id?: string;
  readonly level?: number;
  readonly slot?: FakeSlotSpec | null;
}

/** A child's handle on one field: which child, and which field. */
export interface FakeHandle extends AutomationHandle {
  readonly owner: FakeChild;
  readonly field: string;
}

/** What a fake child counts. */
export type FakeChild = InsertStage<InsertSpec> & {
  disposed: number;
  readonly sets: FakeSlotSpec[];
};

/** The host's own nodes and what `route` was asked. */
export type FakeHost = InsertStage<InsertSpec> & {
  readonly send: GainNode;
  readonly direct: GainNode;
  readonly ret: GainNode;
  readonly routes: boolean[];
  hostSets: number;
  hostDisposed: number;
};

/** Every child and host the fake kinds built, in order, for a test to count. */
export const children: FakeChild[] = [];
export const hosts: FakeHost[] = [];

const handle = (owner: FakeChild, field: string): FakeHandle => ({
  owner,
  field,
  schedule: () => {},
  cancelFrom: () => {},
  hold: () => {},
  release: () => {},
});

function childKind(kind: 'tint' | 'tone'): InsertKind<InsertSpec> {
  return {
    fields: ['kind', 'id', 'level'],
    defaults: { kind } as unknown as InsertSpec,
    normalise: (raw) => ({ ...raw, kind }) as unknown as InsertSpec,
    create(context) {
      const input = context.createGain();
      const output = context.createGain();
      input.connect(output);
      const stage: FakeChild = {
        kind: kind as InsertSpec['kind'],
        input,
        output,
        disposed: 0,
        sets: [],
        set(next) {
          stage.sets.push(next as unknown as FakeSlotSpec);
        },
        param: (field) => handle(stage, field),
        dispose() {
          stage.disposed++;
          input.disconnect();
        },
      };
      children.push(stage);
      return stage;
    },
  };
}

/** input ─▶ send ─▶ direct ─▶ ret ─▶ output: `send` and `ret` are the wet path's ends. */
const HOST_KIND: InsertKind<InsertSpec> = {
  fields: ['kind', 'id', 'level', 'slot'],
  defaults: { kind: 'host', slot: null } as unknown as InsertSpec,
  normalise: (raw) => ({ ...raw, kind: 'host' }) as unknown as InsertSpec,
  create(context) {
    const [input, send, direct, ret, output] = Array.from({ length: 5 }, () =>
      context.createGain(),
    ) as [GainNode, GainNode, GainNode, GainNode, GainNode];
    input.connect(send);
    send.connect(direct);
    direct.connect(ret);
    ret.connect(output);
    const routes: boolean[] = [];
    const host: FakeHost = {
      kind: 'host' as InsertSpec['kind'],
      input,
      output,
      send,
      direct,
      ret,
      routes,
      hostSets: 0,
      hostDisposed: 0,
      wetPath: { send: { node: send, output: 0 }, ret, route: (on) => void routes.push(on) },
      set() {
        host.hostSets++;
      },
      param: (field) =>
        field === 'level' ? handle(host as unknown as FakeChild, field) : undefined,
      dispose() {
        host.hostDisposed++;
        for (const node of [input, send, direct, ret]) node.disconnect();
      },
    };
    hosts.push(host);
    return host;
  },
};

/** The fake host and both child kinds. */
export const SLOT_KINDS = {
  host: HOST_KIND,
  tint: childKind('tint'),
  tone: childKind('tone'),
} as unknown as InsertRegistry;

/** A spec of a fake kind, typed for the chain. */
export const slotSpec = (spec: FakeSlotSpec): InsertSpec => spec as unknown as InsertSpec;
