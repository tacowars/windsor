/**
 * `MusicRoster` on its own, over a recording stand-in for `PartStrips`: a
 * slot's part is the `music-<slot>` part at the music part voice count, the
 * sidechain desk's view holds only the song's slots, and the player's
 * `PartHost` grows and shrinks the same roster.
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

/** Records what the roster asks of `PartStrips`, and keeps a strip per created name. */
class RecordingStrips {
  readonly created: Created[] = [];
  readonly removed: string[] = [];
  readonly strips = new Map<string, PartStrip>();

  createMusic(name: string, _patch: Patch, maxVoices: number, strip?: ChannelStrip): AudioPart {
    this.created.push({ name, maxVoices, strip });
    const part = { name } as AudioPart;
    this.strips.set(name, { part } as PartStrip);
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
});
