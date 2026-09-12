import { CreateAudioEngineAsync } from '@babylonjs/core/AudioV2/webAudio/webAudioEngine';
import {
  CreateSoundAsync,
  type AudioEngineV2,
} from '@babylonjs/core/AudioV2/abstractAudio/audioEngineV2';
import type { StaticSound } from '@babylonjs/core/AudioV2/abstractAudio/staticSound';
import type { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { SFX_BANKS, SFX_LIMITS, type SfxKind, type SfxPosition } from './sfxConstants';
import { SfxSelection } from './sfxSelection';

export type SfxBuffers = Record<SfxKind, readonly AudioBuffer[]>;
interface Slot {
  sound: StaticSound;
  kind: SfxKind;
  variant: number;
}

/** One playback slot owns one panner, so overlapping emitters never move each other. */
export class SpatialSfx {
  private readonly slots: Slot[] = [];
  private readonly selectors = new Map<SfxKind, SfxSelection>();
  private position: SfxPosition = { x: 0, y: 0, z: 0 };
  private volume: number = SFX_LIMITS.volume;
  private disposed = false;

  private constructor(
    private readonly engine: AudioEngineV2,
    private readonly context: AudioContext,
    private readonly random: () => number,
  ) {}

  static async create(context: AudioContext, buffers: SfxBuffers): Promise<SpatialSfx> {
    const engine = await CreateAudioEngineAsync({
      audioContext: context,
      listenerEnabled: true,
      listenerAutoUpdate: false,
      disableDefaultUI: true,
      resumeOnInteraction: false,
      resumeOnPause: false,
    });
    const result = new SpatialSfx(engine, context, Math.random);
    try {
      await result.load(buffers);
      return result;
    } catch (error) {
      result.dispose();
      throw error;
    }
  }

  setListener(position: SfxPosition, rotation: Quaternion): void {
    this.position = position;
    this.engine.listener.position.copyFromFloats(position.x, position.y, position.z);
    this.engine.listener.rotationQuaternion.copyFrom(rotation);
    this.engine.listener.update();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.engine.setVolume(this.volume);
    if (this.volume === 0) for (const slot of this.slots) slot.sound.stop();
  }

  play(kind: SfxKind, position: SfxPosition): boolean {
    if (this.disposed || this.context.state !== 'running' || this.volume === 0) return false;
    const bank = SFX_BANKS[kind];
    const distance = Math.hypot(
      position.x - this.position.x,
      position.y - this.position.y,
      position.z - this.position.z,
    );
    if (!Number.isFinite(distance) || distance >= bank.range) return false;
    const variant = this.selectors.get(kind)!.next();
    const matching = this.slots.filter((s) => s.kind === kind && s.variant === variant);
    const slot = matching.find((s) => s.sound.activeInstancesCount === 0);
    // Each bank/variant has a bounded pool. Dropping an effect never affects gameplay.
    if (
      !slot ||
      this.slots.filter((s) => s.sound.activeInstancesCount > 0).length >= SFX_LIMITS.voices
    )
      return false;
    slot.sound.spatial.position.copyFromFloats(position.x, position.y, position.z);
    slot.sound.spatial.update();
    slot.sound.pitch = (this.random() * 2 - 1) * SFX_LIMITS.pitchCents;
    slot.sound.play({
      volume: bank.gain * (1 + (this.random() * 2 - 1) * SFX_LIMITS.gainVariation),
    });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) slot.sound.dispose();
    this.slots.length = 0;
    this.engine.dispose();
  }

  private async load(buffers: SfxBuffers): Promise<void> {
    for (const kind of Object.keys(buffers) as SfxKind[]) {
      const variants = buffers[kind];
      this.selectors.set(kind, new SfxSelection(variants.length));
      for (let variant = 0; variant < variants.length; variant++) {
        const sound = await CreateSoundAsync(
          `${kind}-${variant}`,
          variants[variant]!,
          {
            spatialEnabled: true,
            spatialAutoUpdate: false,
            spatialPanningModel: 'HRTF',
            spatialDistanceModel: 'linear',
            spatialMinDistance: SFX_LIMITS.minDistance,
            spatialMaxDistance: SFX_BANKS[kind].range,
            maxInstances: 1,
          },
          this.engine,
        );
        this.slots.push({ sound, kind, variant });
        const copies = Math.max(1, Math.floor(SFX_LIMITS.voices / variants.length));
        for (let i = 1; i < copies; i++) {
          this.slots.push({ sound: await sound.cloneAsync(), kind, variant });
        }
      }
    }
    this.engine.setVolume(this.volume);
  }
}
