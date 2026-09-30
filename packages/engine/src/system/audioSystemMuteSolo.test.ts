/**
 * Mute and solo on the live system (windsor#154): a part's strip fields
 * applied live cut its dry path and its sends together, solo is additive
 * over the music parts and resolved over the whole roster, the returns keep
 * playing the soloed parts' sends, a sidechain key never notices, and the
 * aux strips never take part.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { renderGraph, sourceOf } from '../__fixtures__/fakeAudioContext';
import type { FakeGain } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { fake, sources, targets } from '../__fixtures__/stripRig';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import type { PartStrip } from '../mixer/channelStrip';
import type { ChannelStrip } from '../mixer/mix';
import { PRESETS } from '../patch/presets';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from './audioSystem';

const restore = installSidechainWorklet();
afterAll(restore);

/** Three parts, on slots 0–2, each sending to both returns. */
const THREE: ArrangementDocument = {
  ...FULL_DOCUMENT,
  parts: FULL_DOCUMENT.parts
    .slice(0, 3)
    .map((part) => ({ ...part, strip: { ...part.strip, sends: { a: 0.5, b: 0.5 } } })),
};
const SLOTS = [0, 1, 2];
const strip = (system: AudioSystem, slot: number): PartStrip => system.strip(musicPartName(slot))!;

/** A steady tone into a part, whether or not a note is playing. */
function tone(part: PartStrip['part'], rate: number): void {
  sourceOf(part).feed = (b, l, r) => {
    for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.4 * Math.sin((b * l.length + i) * rate);
  };
}

async function rig(doc = THREE): Promise<{ system: AudioSystem; context: FakeContext }> {
  const built = await sidechainRig(doc);
  for (const part of doc.parts) tone(strip(built.system, part.slot).part, 0.05 * (part.slot + 1));
  return built;
}

const peak = (channel: Float32Array): number =>
  channel.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

/** Per slot: whether its dry output and both its sends sound, all three, or none. */
function heard(system: AudioSystem, context: FakeContext, slots = SLOTS): string[] {
  const taps = slots.flatMap((slot) => {
    const s = strip(system, slot);
    return [s.rotation.output, s.sends.get('a')!, s.sends.get('b')!].map(fake);
  });
  const captures = renderGraph(context, 0.05, taps);
  return slots.map((_, k) => {
    const loud = captures.slice(3 * k, 3 * k + 3).map((c) => peak(c.left) > 1e-3);
    if (loud.every(Boolean)) return 'on';
    return loud.some(Boolean) ? 'partly' : 'off';
  });
}

const set = (slot: number, fields: Partial<ChannelStrip>) => ({
  parts: { [slot]: { strip: fields } },
});

describe('mute on a live strip', () => {
  it('silences the dry output and every send of that part only, and lets it back', async () => {
    const { system, context } = await rig();
    expect(system.apply(set(0, { mute: true }))).toEqual({ ok: true, ignored: [] });
    expect(heard(system, context)).toEqual(['off', 'on', 'on']);
    system.apply(set(0, { mute: false }));
    expect(heard(system, context)).toEqual(['on', 'on', 'on']);
    system.dispose();
  });

  it('builds a part muted in the document silent from the start', async () => {
    const { system, context } = await rig({
      ...THREE,
      parts: THREE.parts.map((p) =>
        p.slot === 2 ? { ...p, strip: { ...p.strip, mute: true } } : p,
      ),
    });
    expect(strip(system, 2).mute).toBe(true);
    expect(heard(system, context)).toEqual(['on', 'on', 'off']);
    system.dispose();
  });

  it('reports a mute or solo that is not a boolean', async () => {
    const { system } = await rig();
    const junk = { parts: { 0: { strip: { mute: 'yes', solo: 1 } } } };
    const result = system.apply(junk as unknown as DocumentPartial);
    expect(result.ignored).toEqual(['parts.0.strip.mute', 'parts.0.strip.solo']);
    system.dispose();
  });
});

describe('solo over the music parts', () => {
  it('is additive, keeps a muted soloed part silent, and unsoloing brings all three back', async () => {
    const { system, context } = await rig();
    system.apply(set(1, { solo: true }));
    expect(heard(system, context)).toEqual(['off', 'on', 'off']);
    system.apply(set(2, { solo: true }));
    expect(heard(system, context)).toEqual(['off', 'on', 'on']);
    system.apply({ parts: { 1: { strip: { solo: false } }, 2: { strip: { solo: false } } } });
    expect(heard(system, context)).toEqual(['on', 'on', 'on']);
    system.apply(set(1, { solo: true, mute: true }));
    expect(heard(system, context)).toEqual(['off', 'off', 'off']);
    system.dispose();
  });

  it("keeps the returns playing the soloed part's sends, and nobody else's", async () => {
    const { system, context } = await rig();
    const echo = system.returnBus('b')!;
    const room = system.returnBus('a')!;
    // The echo repeats after its delay time, so its output is read late in the render.
    const late = Math.round(0.35 * context.sampleRate);
    const returned = (): number[] => {
      const taps = [room.input, echo.input, echo.output].map(fake);
      const [roomIn, echoIn, echoOut] = renderGraph(context, 0.4, taps);
      return [peak(roomIn!.left), peak(echoIn!.left), peak(echoOut!.left.slice(late))];
    };
    system.apply(set(1, { solo: true }));
    expect(returned().every((p) => p > 1e-3)).toBe(true);
    // The soloed part sends nothing now: whatever still reached a return came from the others.
    system.apply(set(1, { sends: { a: 0, b: 0 } }));
    expect(returned().slice(0, 2)).toEqual([0, 0]);
    system.dispose();
  });

  it('brings a part added live in silent, and removing the only soloed part brings all back', async () => {
    const { system, context } = await rig();
    system.apply(set(1, { solo: true }));
    const drone = { ...FULL_DOCUMENT.parts[3]!, strip: THREE.parts[0]!.strip };
    expect(system.apply({ parts: { [drone.slot]: drone } }).ok).toBe(true);
    const added = strip(system, drone.slot);
    tone(added.part, 0.3);
    expect(added.soloedOut).toBe(true);
    expect(heard(system, context, [0, 1, 2, 3])).toEqual(['off', 'on', 'off', 'off']);
    expect(system.apply({ parts: { 1: null } }).ok).toBe(true);
    expect(heard(system, context, [0, 2, 3])).toEqual(['on', 'on', 'on']);
    system.dispose();
  });

  it('lands a solo in the document at once, before anything plays', async () => {
    const { system, context } = await rig({
      ...THREE,
      parts: THREE.parts.map((p) =>
        p.slot === 0 ? { ...p, strip: { ...p.strip, solo: true } } : p,
      ),
    });
    const gain = (targets(strip(system, 1).head)[0] as FakeGain).gain;
    expect(gain.automation.map((a) => a.call)).toEqual(['cancelScheduledValues', 'setValueAtTime']);
    expect(heard(system, context)).toEqual(['on', 'off', 'off']);
    system.dispose();
  });

  it('never touches an aux strip', async () => {
    const { system, context } = await rig();
    system.createAuxPart('audition', PRESETS['pad-drift']!);
    const audition = system.strip('audition')!;
    tone(audition.part, 0.2);
    system.apply(set(0, { solo: true }));
    expect(audition.soloedOut).toBe(false);
    const [dry] = renderGraph(context, 0.05, [fake(audition.rotation.output)]);
    expect(peak(dry!.left)).toBeGreaterThan(1e-3);
    system.dispose();
  });
});

describe('the sidechain key under mute and solo', () => {
  const keyed = {
    parts: {
      1: {
        strip: { inserts: [{ ...DEFAULT_COMPRESSOR, threshold: -30, sidechain: { track: 0 } }] },
      },
    },
  };
  const keyLevel = (system: AudioSystem, context: FakeContext): number => {
    const detector = strip(system, 1).inserts[0]!.detector!.input;
    expect(sources(detector)).toEqual([fake(strip(system, 0).head)]);
    return peak(renderGraph(context, 0.05, [fake(detector)])[0]!.left);
  };

  it('keeps feeding the detector while its source is muted, or another part is soloed', async () => {
    const { system, context } = await rig();
    system.apply(keyed);
    const open = keyLevel(system, context);
    expect(open).toBeGreaterThan(1e-3);
    // Each render restarts the tone's phase into a filter that kept its state: near, not equal.
    system.apply(set(0, { mute: true }));
    expect(heard(system, context)[0]).toBe('off');
    expect(keyLevel(system, context)).toBeGreaterThan(0.9 * open);
    system.apply({ parts: { 0: { strip: { mute: false } }, 1: { strip: { solo: true } } } });
    expect(heard(system, context)[0]).toBe('off');
    expect(keyLevel(system, context)).toBeGreaterThan(0.9 * open);
    system.dispose();
  });
});
