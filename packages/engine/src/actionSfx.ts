import {
  pieceTransform,
  type HarvestNodeField,
  type InteractionCompletedMessage,
  type PlacedMessage,
  type TerrainParams,
} from '@aotearoa/shared';
import type { NetSession } from '../net/session';
import type { ServerClock } from '../net/serverClock';
import { SFX_LIMITS, type SfxKind, type SfxPosition } from './sfxConstants';

type ActionMessage = PlacedMessage | InteractionCompletedMessage;
export interface ActionSfxDeps {
  session: Pick<NetSession, 'onActionSound' | 'playerId' | 'appliedWorldRevision'>;
  terrain: TerrainParams;
  nodes: HarvestNodeField;
}

/** Live confirmations only: attach after decoding, never replay initialization history. */
export class ActionSfx {
  private readonly pending: ActionMessage[] = [];
  private readonly interactionTicks = new Map<number, number>();
  private revision: number;
  private readonly receive = (message: ActionMessage): void => {
    if (message.type === 'placed') {
      if (message.revision <= this.revision) return;
      this.revision = message.revision;
      if (message.action !== 'place') return;
    } else {
      if (message.tick <= (this.interactionTicks.get(message.playerId) ?? -1)) return;
      this.interactionTicks.set(message.playerId, message.tick);
    }
    if (document.hidden) return;
    if (this.pending.length === SFX_LIMITS.pendingActions) this.pending.shift();
    this.pending.push(message);
  };

  constructor(
    private readonly deps: ActionSfxDeps,
    private readonly clock: ServerClock,
    private readonly play: (kind: SfxKind, position: SfxPosition) => boolean,
  ) {
    this.revision = deps.session.appliedWorldRevision;
    deps.session.onActionSound = this.receive;
  }

  update(now: number, local: SfxPosition): void {
    const tick = this.clock.estimate(now);
    for (const message of this.pending) {
      if (document.hidden || tick === null) continue;
      const age = (tick - message.tick) / this.clock.tickRate;
      if (age > SFX_LIMITS.staleSeconds || age < -SFX_LIMITS.staleSeconds) continue;
      this.sound(message, local);
    }
    this.pending.length = 0;
  }

  dispose(): void {
    if (this.deps.session.onActionSound === this.receive) delete this.deps.session.onActionSound;
    this.pending.length = 0;
    this.interactionTicks.clear();
  }

  private sound(message: ActionMessage, local: SfxPosition): void {
    if (message.type === 'placed' || message.target.kind === 'piece') {
      const placement =
        message.type === 'placed'
          ? message.placement
          : message.target.kind === 'piece'
            ? message.target.placement
            : null;
      if (!placement) return;
      const [x, y, z] = pieceTransform(placement, this.deps.terrain).position;
      this.play(message.type === 'placed' ? 'build' : 'repair', { x, y, z });
      return;
    }
    const { index } = message.target;
    const field = this.deps.nodes;
    if (!Number.isInteger(index) || index < 0 || index >= field.count) return;
    const position = { x: field.x[index]!, y: field.y[index]!, z: field.z[index]! };
    this.play('mine', position);
    if (message.depleted) this.play('deplete', position);
    if (message.playerId === this.deps.session.playerId && message.materialGained > 0)
      this.play('pickup', local);
  }
}
