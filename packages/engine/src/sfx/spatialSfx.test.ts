import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { SpatialSfx } from './spatialSfx';
import { SFX_LIMITS } from './sfxConstants';

const fake = vi.hoisted(() => {
  const sounds: {
    activeInstancesCount: number;
    pitch: number;
    spatial: {
      position: { copyFromFloats: ReturnType<typeof vi.fn> };
      update: ReturnType<typeof vi.fn>;
    };
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const sound = () => {
    const value = {
      activeInstancesCount: 0,
      pitch: 0,
      spatial: { position: { copyFromFloats: vi.fn() }, update: vi.fn() },
      play: vi.fn(() => {
        value.activeInstancesCount = 1;
      }),
      stop: vi.fn(() => {
        value.activeInstancesCount = 0;
      }),
      dispose: vi.fn(),
      cloneAsync: async () => sound(),
    };
    sounds.push(value);
    return value;
  };
  const engine = {
    listener: {
      position: { copyFromFloats: vi.fn() },
      rotationQuaternion: { copyFrom: vi.fn() },
      update: vi.fn(),
    },
    setVolume: vi.fn(),
    dispose: vi.fn(),
  };
  return { sounds, sound, engine };
});
vi.mock('@babylonjs/core/AudioV2/webAudio/webAudioEngine', () => ({
  CreateAudioEngineAsync: async () => fake.engine,
}));
vi.mock('@babylonjs/core/AudioV2/abstractAudio/audioEngineV2', () => ({
  CreateSoundAsync: async () => fake.sound(),
}));

describe('spatial SFX playback ownership', () => {
  beforeEach(() => {
    fake.sounds.length = 0;
    vi.clearAllMocks();
  });
  const buffers = {
    step: [{} as AudioBuffer],
    impact: [{} as AudioBuffer],
    weapon: [{} as AudioBuffer],
    build: [{} as AudioBuffer],
    repair: [{} as AudioBuffer],
    mine: [{} as AudioBuffer],
    deplete: [{} as AudioBuffer],
    pickup: [{} as AudioBuffer],
  };

  it('keeps overlapping emitters and pitch independent', async () => {
    const sfx = await SpatialSfx.create({ state: 'running' } as AudioContext, buffers);
    sfx.setListener({ x: 0, y: 0, z: 0 }, Quaternion.Identity());
    expect(sfx.play('step', { x: -1, y: 0, z: 0 })).toBe(true);
    const first = fake.sounds.find((s) => s.activeInstancesCount > 0)!;
    const firstPitch = first.pitch;
    expect(sfx.play('step', { x: 1, y: 0, z: 0 })).toBe(true);
    const second = fake.sounds.filter((s) => s.activeInstancesCount > 0)[1]!;
    expect(first.spatial.position.copyFromFloats).toHaveBeenCalledExactlyOnceWith(-1, 0, 0);
    expect(second.spatial.position.copyFromFloats).toHaveBeenCalledExactlyOnceWith(1, 0, 0);
    expect(first.pitch).toBe(firstPitch);
    sfx.dispose();
  });

  it('drops distant, invalid and excess sounds; mute stops active slots', async () => {
    const sfx = await SpatialSfx.create({ state: 'running' } as AudioContext, buffers);
    expect(sfx.play('step', { x: SFX_LIMITS.footstepRange, y: 0, z: 0 })).toBe(false);
    expect(sfx.play('step', { x: NaN, y: 0, z: 0 })).toBe(false);
    const position = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < SFX_LIMITS.voices; i++) expect(sfx.play('step', position)).toBe(true);
    expect(sfx.play('weapon', position)).toBe(false);
    sfx.setVolume(0);
    expect(fake.sounds.every((s) => s.activeInstancesCount === 0)).toBe(true);
    expect(sfx.play('step', position)).toBe(false);
    sfx.dispose();
    sfx.dispose();
    expect(fake.engine.dispose).toHaveBeenCalledTimes(1);
  });

  it('never queues a backlog while the shared context is suspended', async () => {
    const context = { state: 'suspended' };
    const sfx = await SpatialSfx.create(context as AudioContext, buffers);
    expect(sfx.play('step', { x: 0, y: 0, z: 0 })).toBe(false);
    context.state = 'running';
    expect(fake.sounds.every((s) => s.play.mock.calls.length === 0)).toBe(true);
    sfx.dispose();
  });
});
