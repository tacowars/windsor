import { SFX_LIMITS, type SfxPosition } from './sfxConstants';

export interface FootstepSample extends SfxPosition {
  id: number;
  grounded: boolean;
  alive: boolean;
}

interface Trail {
  position: SfxPosition;
  distance: number;
}

/** Distance-driven contact approximation; no timer continues after movement stops. */
export class FootstepCadence {
  private readonly trails = new Map<number, Trail>();

  constructor(
    private readonly limits: {
      strideM: number;
      teleportM: number;
      maxFrameSeconds: number;
    } = SFX_LIMITS,
  ) {}

  update(samples: readonly FootstepSample[], dt: number, play: (p: SfxPosition) => void): void {
    const seen = new Set<number>();
    for (const sample of samples) {
      seen.add(sample.id);
      this.step(sample, dt, play);
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
  }

  clear(): void {
    this.trails.clear();
  }

  private step(sample: FootstepSample, dt: number, play: (p: SfxPosition) => void): void {
    const old = this.trails.get(sample.id);
    const position = { x: sample.x, y: sample.y, z: sample.z };
    if (!Object.values(position).every(Number.isFinite)) {
      this.trails.delete(sample.id);
      return;
    }
    const distance = old ? Math.hypot(sample.x - old.position.x, sample.z - old.position.z) : 0;
    const reset =
      !old ||
      !sample.alive ||
      !sample.grounded ||
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > this.limits.maxFrameSeconds ||
      distance > this.limits.teleportM;
    const accumulated = reset ? 0 : old.distance + distance;
    this.trails.set(sample.id, {
      position,
      distance: accumulated % this.limits.strideM,
    });
    if (accumulated >= this.limits.strideM) play(position);
  }
}
