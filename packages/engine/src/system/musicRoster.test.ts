/**
 * `MusicRoster` on its own, over a recording stand-in for `PartStrips`: a
 * slot's part is the `music-<slot>` part at the music part voice count, the
 * sidechain desk's view holds only the song's slots, the player's
 * `PartHost` grows and shrinks the same roster, and solo resolves over every
 * slot (windsor#154).
 */
import { describe, expect, it } from 'vitest';

import { LOW_CUT_MIN_HZ, MUSIC_PART_MAX_VOICES } from '../audioConstants';
import type { PartStrip } from '../mixer/channelStrip';
import type { ChannelStrip } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import type { MusicPart } from '../song/arrangement';
import type { AudioPart } from '../synth/audioPart';
import { MusicRoster } from './musicRoster';
import type { PartStrips } from './partStrips';

interface Created {
  name: string;
  maxVoices: number;
  strip: ChannelStrip | undefined;
}

/** A strip's solo state, and the ramp each change of `soloedOut` asked for. */
function soloStrip(part: AudioPart, solo: boolean): PartStrip & { ramps: (number | undefined)[] } {
  let soloedOut = false;
  let own = solo;
  const ramps: (number | undefined)[] = [];
  return {
    part,
    ramps,
    get solo(): boolean {
      return own;
    },
    setSolo(next: boolean): void {
      own = next;
    },
    get soloedOut(): boolean {
      return soloedOut;
    },
    setSoloedOut(next: boolean, seconds?: number): void {
      if (next === soloedOut) return;
      soloedOut = next;
      ramps.push(seconds);
    },
  } as PartStrip & { ramps: (number | undefined)[] };
}

/** Records what the roster asks of `PartStrips`, and keeps a strip per created name. */
class RecordingStrips {
  readonly created: Created[] = [];
  readonly removed: string[] = [];
  readonly strips = new Map<string, PartStrip>();

  createMusic(name: string, _patch: Patch, maxVoices: number, strip?: ChannelStrip): AudioPart {
    this.created.push({ name, maxVoices, strip });
    const part = { name } as AudioPart;
    this.strips.set(name, soloStrip(part, strip?.solo === true));
    return part;
  }

  get(name: string): PartStrip | undefined {
    return this.strips.get(name);
  }

  remove(name: string): void {
    this.removed.push(name);
    this.strips.delete(name);
  }
}

const PATCH = PRESETS['pad-drift']!;
const part = (slot: number): MusicPart => ({ slot }) as MusicPart;
const STRIP: ChannelStrip = { level: 0.5, pan: 0, lowCut: LOW_CUT_MIN_HZ, inserts: [], sends: {} };
const SOLO: ChannelStrip = { ...STRIP, solo: true };

function rig(): { strips: RecordingStrips; roster: MusicRoster } {
  const strips = new RecordingStrips();
  return { strips, roster: new MusicRoster(strips as unknown as PartStrips) };
}

describe('MusicRoster', () => {
  it('builds a slot as music-<slot> at the music part voice count, on the strip handed in', () => {
    const { strips, roster } = rig();
    const audio = roster.add(part(3), PATCH, STRIP);
    expect(strips.created).toEqual([
      { name: 'music-3', maxVoices: MUSIC_PART_MAX_VOICES, strip: STRIP },
    ]);
    expect(roster.host().get(3)).toBe(audio);
    expect(roster.strip(3)).toBe(strips.get('music-3'));
  });

  it('gives the sidechain desk only the song’s slots that have a strip, by slot', () => {
    const { strips, roster } = rig();
    roster.add(part(0), PATCH);
    roster.add(part(2), PATCH);
    // An aux part on the same PartStrips is not a track.
    strips.strips.set('ui', {} as PartStrip);
    expect([...roster.tracks().entries()]).toEqual([
      [0, strips.get('music-0')],
      [2, strips.get('music-2')],
    ]);
    strips.strips.delete('music-2');
    expect([...roster.tracks().keys()]).toEqual([0]);
  });

  it('removes a slot through PartStrips and frees it', () => {
    const { strips, roster } = rig();
    roster.add(part(1), PATCH);
    roster.remove(1);
    expect(strips.removed).toEqual(['music-1']);
    expect(roster.host().get(1)).toBeUndefined();
    expect(roster.tracks().size).toBe(0);
  });

  it('lets the player add on the desk default strip and remove through the same roster', () => {
    const { strips, roster } = rig();
    const host = roster.host();
    const added = host.add!(part(4), PATCH);
    expect(strips.created).toEqual([
      { name: 'music-4', maxVoices: MUSIC_PART_MAX_VOICES, strip: undefined },
    ]);
    expect(roster.host().get(4)).toBe(added);
    host.remove!(4);
    expect(roster.host().get(4)).toBeUndefined();
  });

  it('forgets every slot on clear, disposing nothing itself', () => {
    const { strips, roster } = rig();
    roster.add(part(0), PATCH);
    roster.clear();
    expect(roster.host().get(0)).toBeUndefined();
    expect(roster.tracks().size).toBe(0);
    expect(strips.removed).toEqual([]);
  });

  it('solos additively over every slot, and unsoloing brings them all back', () => {
    const { roster } = rig();
    for (const slot of [0, 1, 2]) roster.add(part(slot), PATCH);
    const out = (): boolean[] => [0, 1, 2].map((slot) => roster.strip(slot)!.soloedOut);
    roster.strip(1)!.setSolo(true);
    roster.resolveSolo();
    expect(out()).toEqual([true, false, true]);
    roster.strip(2)!.setSolo(true);
    roster.resolveSolo();
    expect(out()).toEqual([true, false, false]);
    roster.strip(1)!.setSolo(false);
    roster.strip(2)!.setSolo(false);
    roster.resolveSolo();
    expect(out()).toEqual([false, false, false]);
  });

  it('brings a part added while another is soloed in silent, with no ramp', () => {
    const { strips, roster } = rig();
    roster.add(part(0), PATCH, SOLO);
    roster.host().add!(part(1), PATCH);
    const added = strips.get('music-1') as ReturnType<typeof soloStrip>;
    expect(added.soloedOut).toBe(true);
    expect(added.ramps).toEqual([0]);
    expect(roster.strip(0)!.soloedOut).toBe(false);
  });

  it('brings every part back when the only soloed part is removed', () => {
    const { roster } = rig();
    roster.add(part(0), PATCH);
    roster.add(part(1), PATCH, SOLO);
    roster.add(part(2), PATCH);
    roster.resolveSolo(0);
    expect(roster.strip(0)!.soloedOut).toBe(true);
    roster.host().remove!(1);
    expect(roster.strip(0)!.soloedOut).toBe(false);
    expect(roster.strip(2)!.soloedOut).toBe(false);
  });
});
