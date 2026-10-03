/**
 * The system's part meter bank (windsor#540): the roster attaches each music
 * part's tap, the rotation's output its strip meter reads, on the part's
 * slot, through a live add and removal and whatever order the song lists its
 * parts in, and the system's `dispose` takes the bank down before the strips.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { PART_METER_BANK_NAME } from '../mixer/partMeterBankConstants';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(
  document: ArrangementDocument,
): Promise<{ sys: AudioSystem; bank: () => FakeWorkletNode | undefined }> {
  const context = new FakeContext();
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  const bank = (): FakeWorkletNode | undefined =>
    context.workletNodes.find((node) => node.name === PART_METER_BANK_NAME);
  return { sys, bank };
}

/** Each input's source, by slot. */
const wiring = (bank: FakeWorkletNode): Map<number, unknown> =>
  new Map(bank.inbound.map((edge) => [edge.input, edge.from]));

/** Each of the system's music strips' taps, by slot. */
const taps = (sys: AudioSystem, slots: readonly number[]): Map<number, unknown> =>
  new Map(slots.map((slot) => [slot, sys.strip(musicPartName(slot))!.rotation.output]));

const SLOTS = FULL_DOCUMENT.parts.map((part) => part.slot);

describe('the system’s part meter bank', () => {
  it('builds nothing until active, then meters every music part on its slot', async () => {
    const { sys, bank } = await system(FULL_DOCUMENT);
    expect(bank()).toBeUndefined();
    sys.partMeters.setActive(true);
    expect(wiring(bank()!)).toEqual(taps(sys, SLOTS));
  });

  it('meters each part on its own slot whatever order the song lists them in', async () => {
    const reversed = { ...FULL_DOCUMENT, parts: [...FULL_DOCUMENT.parts].reverse() };
    const { sys, bank } = await system(reversed);
    sys.partMeters.setActive(true);
    expect(wiring(bank()!)).toEqual(taps(sys, SLOTS));
  });

  it('follows a live removal and add', async () => {
    const { sys, bank } = await system(FULL_DOCUMENT);
    sys.partMeters.setActive(true);
    const { drone } = FULL_SLOT;
    const part = FULL_DOCUMENT.parts.find((p) => p.slot === drone)!;
    expect(sys.apply({ parts: { [drone]: null } }).ok).toBe(true);
    const rest = SLOTS.filter((slot) => slot !== drone);
    expect(wiring(bank()!)).toEqual(taps(sys, rest));
    expect(bank()!.posted).toContainEqual({ type: 'clear', slot: drone, seq: 1 });
    expect(sys.apply({ parts: { [drone]: part } }).ok).toBe(true);
    expect(wiring(bank()!)).toEqual(taps(sys, SLOTS));
  });

  it('is taken down with the system', async () => {
    const { sys, bank } = await system(FULL_DOCUMENT);
    sys.partMeters.setActive(true);
    const node = bank()!;
    sys.dispose();
    expect(node.inbound).toEqual([]);
    expect(node.outbound).toEqual([]);
  });
});
