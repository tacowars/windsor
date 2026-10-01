/**
 * The music parts by slot: the roster the arrangement player reads and — for
 * a live add or removal — grows and shrinks through (#629). Each part is the
 * `music-<slot>` engine part (`musicPartName`) on its strip in `PartStrips`;
 * this owns which slots the song has, and the slot-keyed view of their
 * strips the sidechain desk routes between. It sees every music strip, so it
 * is the one place solo resolves (windsor#154): the aux strips are never in
 * it, so solo never touches them. It reads the live group buses too
 * (windsor#285), and sets their gates by the same rule (`soloRule.ts`).
 */
import { MUSIC_PART_MAX_VOICES } from '../audioConstants';
import type { PartStrip } from '../mixer/channelStrip';
import type { GroupBus } from '../mixer/groupBus';
import type { ChannelStrip } from '../mixer/mix';
import { DEFAULT_STRIP, isGroupOutput } from '../mixer/mix';
import type { GroupSwitches } from '../mixer/soloRule';
import { isGroupOpen, isHeard, isSoloing } from '../mixer/soloRule';
import type { Patch } from '../patch/patch';
import type { MusicPart } from '../song/arrangement';
import type { PartHost } from '../song/arrangementPlayer';
import { musicPartName } from '../song/documentParts';
import type { AudioPart } from '../synth/audioPart';
import type { PartStrips } from './partStrips';

/**
 * What the solo rule reads of a live strip: its solo flag and its group.
 * Its own mute and a Sidechain Output close its gate themselves, so they are
 * left out, and `soloedOut` means silenced by the others' solo or by its group.
 */
function soloView(strip: PartStrip): ChannelStrip {
  const output = strip.output;
  return { ...DEFAULT_STRIP, solo: strip.solo, ...(isGroupOutput(output) ? { output } : {}) };
}

export class MusicRoster {
  private readonly parts = new Map<number, AudioPart>();

  /**
   * `strips` builds and disposes each slot's engine part and strip; `groups`
   * are the live group buses (windsor#285), none by default.
   */
  constructor(
    private readonly strips: PartStrips,
    private readonly groups: () => readonly GroupBus[] = () => [],
  ) {}

  /**
   * The `music-<slot>` engine part on its strip (#629 decision 1). At init the
   * document's strip is handed in; a part added live starts on the desk's
   * default strip and `apply` then lands the partial's `strip` fields on it,
   * the way it does for every other slot. A part added while another is
   * soloed comes in silent at once, with no ramp (windsor#154); what its own
   * solo does to the others is `resolveSolo`'s.
   */
  add(part: MusicPart, patch: Patch, strip?: ChannelStrip): AudioPart {
    const audio = this.strips.createMusic(
      musicPartName(part.slot),
      patch,
      MUSIC_PART_MAX_VOICES,
      strip,
    );
    this.parts.set(part.slot, audio);
    const added = this.strip(part.slot);
    if (added) {
      const switches = this.groups().map((group) => group.spec);
      const soloing = isSoloing([...this.tracks().values()], switches);
      added.setSoloedOut(!isHeard(soloView(added), soloing, switches), 0);
    }
    return audio;
  }

  /**
   * Dispose the `music-<slot>` part, its strip and its load meter entry, and
   * nothing else (#629 decision 1). Removing the only soloed part brings the
   * rest back.
   */
  remove(slot: number): void {
    this.strips.remove(musicPartName(slot));
    this.parts.delete(slot);
    this.resolveSolo();
  }

  /**
   * Mute and solo over every music strip and group (windsor#154,
   * windsor#285): while any part or group has solo, every part neither it
   * nor its group soloes is soloed out; a muted group silences its members,
   * sends included; and each group's own gate is open only while
   * `isGroupOpen` says so. Only a gate whose state changes ramps, over
   * `seconds`; 0 sets it at once, for a system that has not played yet.
   */
  resolveSolo(seconds?: number): void {
    const tracks = [...this.tracks().values()];
    const views = tracks.map(soloView);
    const groups = this.groups();
    const switches: GroupSwitches[] = groups.map((group) => group.spec);
    const soloing = isSoloing(views, switches);
    tracks.forEach((strip, i) =>
      strip.setSoloedOut(!isHeard(views[i]!, soloing, switches), seconds),
    );
    groups.forEach((group, i) => group.setOpen(isGroupOpen(switches[i]!, views, soloing), seconds));
  }

  /** The live strip of the part on `slot`, by its engine name. */
  strip(slot: number): PartStrip | undefined {
    return this.strips.get(musicPartName(slot));
  }

  /** Every slot's strip, by slot: the tracks the sidechain desk routes between. */
  tracks(): ReadonlyMap<number, PartStrip> {
    return new Map(
      [...this.parts.keys()].flatMap((slot) => {
        const strip = this.strip(slot);
        return strip ? [[slot, strip] as const] : [];
      }),
    );
  }

  /**
   * The roster as the player sees it. The player calls `add` and `remove`
   * only after its plan has validated the whole partial, so a refused edit
   * creates and disposes nothing.
   */
  host(): PartHost {
    return {
      get: (slot) => this.parts.get(slot),
      add: (part, patch) => this.add(part, patch),
      remove: (slot) => this.remove(slot),
    };
  }

  /** Forget every slot. The strips are `PartStrips`' to dispose. */
  clear(): void {
    this.parts.clear();
  }
}
