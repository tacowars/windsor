import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { cellCentre, INTERPOLATION_DELAY_MS } from '@aotearoa/shared';
import type { SnapshotEntry, SnapshotRing } from '../net/snapshotRing';
import type { ServerClock } from '../net/serverClock';
import type { Frame } from '../systems';
import { MS_PER_SECOND } from '../timeConstants';
import { FootstepCadence, type FootstepSample } from './footstepCadence';
import { SFX_LIMITS, type SfxPosition } from './sfxConstants';
import type { SpatialSfx } from './spatialSfx';

export interface GameplaySfxDeps {
  ring: SnapshotRing;
  clock: ServerClock;
  local: () => FootstepSample;
  camera: Camera;
  height: (x: number, z: number) => number;
}

/** Observes replicated state; never drives a command or simulation decision. */
export class GameplaySfx {
  private readonly cadence = new FootstepCadence();
  private readonly rotation = Quaternion.Identity();
  private lastTick: number | null = null;

  constructor(
    private readonly audio: Pick<SpatialSfx, 'setListener' | 'play' | 'setVolume' | 'dispose'>,
    private readonly deps: GameplaySfxDeps,
  ) {}

  update({ dt, now }: Frame): void {
    const local = this.deps.local();
    this.deps.camera.getWorldMatrix().decompose(undefined, this.rotation);
    this.audio.setListener(local, this.rotation);
    const newest = this.deps.ring.newest();
    const tick = this.deps.clock.estimate(now);
    if (!newest || tick === null) return;
    const age = (tick - newest.snap.serverTick) / this.deps.clock.tickRate;
    if (age > SFX_LIMITS.staleSeconds || document.hidden) {
      this.cadence.clear();
      this.lastTick = newest.snap.serverTick;
      return;
    }
    const samples: FootstepSample[] = [local];
    const resolved = this.deps.ring.resolve(
      tick - (INTERPOLATION_DELAY_MS / MS_PER_SECOND) * this.deps.clock.tickRate,
    );
    if (resolved) {
      const { a, b, alpha } = resolved;
      for (let i = 0; i < b.snap.remoteCount; i++) {
        const p = b.snap.remote[i]!;
        const before =
          a.snap.remote.find((r, j) => j < a.snap.remoteCount && r.playerId === p.playerId) ?? p;
        samples.push({
          id: p.playerId,
          alive: p.hitPoints > 0,
          grounded: p.supported,
          x: before.x + (p.x - before.x) * alpha,
          y: before.y + (p.y - before.y) * alpha,
          z: before.z + (p.z - before.z) * alpha,
        });
      }
    }
    this.cadence.update(samples, dt, (p) => this.audio.play('step', p));
    if (this.lastTick === null || newest.snap.serverTick < this.lastTick) {
      this.lastTick = newest.snap.serverTick;
      return;
    }
    this.deps.ring.forEachAfter(this.lastTick, (entry) => {
      this.lastTick = entry.snap.serverTick;
      if ((tick - entry.snap.serverTick) / this.deps.clock.tickRate <= SFX_LIMITS.staleSeconds)
        this.hits(entry);
    });
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
  }

  /** Page teardown only: Babylon also closes the shared music AudioContext. */
  dispose(): void {
    this.cadence.clear();
    this.audio.dispose();
  }

  private hits(entry: SnapshotEntry): void {
    const { snap } = entry;
    const sources = new Set<string>();
    for (let i = 0; i < snap.hitCount; i++) {
      const hit = snap.hits[i]!;
      const target =
        hit.target === 'player'
          ? this.playerPosition(entry, hit.targetIndex)
          : hit.target === 'piece'
            ? this.piecePosition(entry, hit.targetIndex)
            : this.enemyPosition(entry, hit.targetIndex);
      if (target) this.audio.play('impact', target);
      const key = `${hit.source}:${hit.sourceIndex}`;
      if (hit.source === 'enemy' || sources.has(key)) continue;
      sources.add(key);
      const source =
        hit.source === 'player'
          ? this.playerPosition(entry, hit.sourceIndex)
          : this.piecePosition(entry, hit.sourceIndex);
      if (source) this.audio.play('weapon', source);
    }
  }

  private playerPosition({ snap }: SnapshotEntry, id: number): SfxPosition | undefined {
    return snap.local.playerId === id
      ? snap.local
      : snap.remote.find((p, i) => i < snap.remoteCount && p.playerId === id);
  }

  private piecePosition({ snap }: SnapshotEntry, index: number): SfxPosition | undefined {
    if (index < 0 || index >= snap.damagedCount) return undefined;
    const p = snap.damaged[index]!;
    return cellCentre(p.cx, p.cy, p.cz);
  }

  private enemyPosition(entry: SnapshotEntry, slot: number): SfxPosition | undefined {
    const index = entry.slotMap[slot];
    if (index === undefined || index < 0 || index >= entry.snap.hordeCount) return undefined;
    const x = entry.snap.hordeX[index]!;
    const z = entry.snap.hordeZ[index]!;
    return { x, y: this.deps.height(x, z), z };
  }
}
