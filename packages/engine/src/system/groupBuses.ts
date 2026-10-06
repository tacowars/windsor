/**
 * The song's live group buses, by id (windsor#285; record
 * `2026-10-01-group-buses`). They stand beside the send buses: built from
 * the document by `initMusic` before any part is routed, so a part that
 * starts on a group connects to it directly, and added, edited and removed
 * by a live partial in the order `AudioSystem.apply` lands it:
 *
 * 1. `begin`: new groups are built, removed ones leave the lookup (so no
 *    strip can be routed onto them), and the edits land;
 * 2. the strips land, their Outputs among them;
 * 3. `release`: a part still on a group that has gone plays on Master, and
 *    is reported;
 * 4. the roster resolves solo;
 * 5. `finish`: each removed group fades shut and is disposed once the fade
 *    has landed, after every member's move off it, which was asked for
 *    first and waits out the same fade.
 */
import { MS_PER_SECOND } from '../audioConstants';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { PartStrip, RouteOptions } from '../mixer/channelStrip';
import type { GroupsPlan } from '../mixer/groupApply';
import { applyGroupsLive, planGroupsLive } from '../mixer/groupApply';
import type { GroupBus, GroupBusOptions } from '../mixer/groupBus';
import { createGroupBus } from '../mixer/groupBus';
import type { GroupSpec } from '../mixer/mix';
import { isGroupOutput } from '../mixer/mix';
import type { StandingGraph } from './standingGraph';

export interface GroupBusesOptions {
  readonly context: BaseAudioContext;
  /** The music bus each group plays into. */
  readonly graph: StandingGraph;
  /** A strip's: the insert registry, the change hook, the fade's wait. */
  readonly routeOptions: RouteOptions;
  /**
   * A group's insert chain was re-wired inside its fade (windsor#614): the
   * group's lanes on its inserts re-attach, as a part's do.
   */
  readonly insertsRebuilt?: (bus: GroupBus) => void;
}

const laterByTimeout = (run: () => void, seconds: number): void => {
  setTimeout(run, seconds * MS_PER_SECOND);
};

export class GroupBuses {
  private readonly live = new Map<number, GroupBus>();
  /** Removed by the partial in flight: out of the lookup, still in the graph until `finish`. */
  private leaving: GroupBus[] = [];
  /** Fading shut, disposed when the fade lands or when the system goes. */
  private readonly retiring = new Set<GroupBus>();

  constructor(private readonly options: GroupBusesOptions) {}

  /** Build the document's groups. The standing graph must be built. */
  build(specs: readonly GroupSpec[]): void {
    for (const spec of specs) this.live.set(spec.id, this.create(spec));
  }

  /** A live group by id. */
  get(id: number): GroupBus | undefined {
    return this.live.get(id);
  }

  /** Every live group. */
  all(): GroupBus[] {
    return [...this.live.values()];
  }

  /** Read a `groups` partial against the live ids; changes nothing. */
  plan(overlay: unknown): GroupsPlan {
    return planGroupsLive(new Set(this.live.keys()), overlay);
  }

  /** Build the plan's new groups, take its removed ones out of the lookup, and land its edits. */
  begin(plan: GroupsPlan): string[] {
    for (const spec of plan.added) this.live.set(spec.id, this.create(spec));
    this.leaving = plan.removed.flatMap((id) => {
      const bus = this.live.get(id);
      this.live.delete(id);
      return bus ? [bus] : [];
    });
    return applyGroupsLive(this.live, plan.edits);
  }

  /**
   * Every strip whose Output names a group that is not live plays on
   * Master, reported by its path (record decision 7).
   */
  release(tracks: ReadonlyMap<number, PartStrip>): string[] {
    const ignored: string[] = [];
    for (const [slot, strip] of tracks) {
      const output = strip.output;
      if (!isGroupOutput(output) || this.live.has(output.group)) continue;
      strip.setOutput('master');
      ignored.push(`parts.${slot}.strip.output`);
    }
    return ignored;
  }

  /** Fade each removed group shut and dispose it once the fade has landed. */
  finish(): void {
    const later = this.options.routeOptions.defer ?? laterByTimeout;
    for (const bus of this.leaving) {
      this.retiring.add(bus);
      bus.setOpen(false);
      later(() => {
        if (this.retiring.delete(bus)) bus.dispose();
      }, INSERT_FADE_SECONDS);
    }
    this.leaving = [];
  }

  /** Dispose every group, live, leaving or fading. The parts must be gone first. */
  dispose(): void {
    for (const bus of [...this.live.values(), ...this.leaving, ...this.retiring]) bus.dispose();
    this.live.clear();
    this.leaving = [];
    this.retiring.clear();
  }

  private create(spec: GroupSpec): GroupBus {
    const { context, graph, routeOptions } = this.options;
    // A strip's options, with the group's own re-wire hook in place of a part's.
    const options: GroupBusOptions = {
      ...routeOptions,
      insertsRebuilt: (bus) => this.options.insertsRebuilt?.(bus),
    };
    return createGroupBus(context, spec, graph.standing().musicBus.input, options);
  }
}
