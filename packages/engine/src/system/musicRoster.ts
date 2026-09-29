/**
 * The music parts by slot: the roster the arrangement player reads and — for
 * a live add or removal — grows and shrinks through (#629). Each part is the
 * `music-<slot>` engine part (`musicPartName`) on its strip in `PartStrips`;
 * this owns which slots the song has, and the slot-keyed view of their
 * strips the sidechain desk routes between.
 */
import { MUSIC_PART_MAX_VOICES } from '../audioConstants';
import type { PartStrip } from '../mixer/channelStrip';
import type { ChannelStrip } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import type { MusicPart } from '../song/arrangement';
import type { PartHost } from '../song/arrangementPlayer';
import { musicPartName } from '../song/documentParts';
import type { AudioPart } from '../synth/audioPart';
import type { PartStrips } from './partStrips';

export class MusicRoster {
  private readonly parts = new Map<number, AudioPart>();

  /** `strips` builds and disposes each slot's engine part and strip. */
  constructor(private readonly strips: PartStrips) {}

  /**
   * The `music-<slot>` engine part on its strip (#629 decision 1). At init the
   * document's strip is handed in; a part added live starts on the desk's
   * default strip and `apply` then lands the partial's `strip` fields on it,
   * the way it does for every other slot.
   */
  add(part: MusicPart, patch: Patch, strip?: ChannelStrip): AudioPart {
    const audio = this.strips.createMusic(
      musicPartName(part.slot),
      patch,
      MUSIC_PART_MAX_VOICES,
      strip,
    );
    this.parts.set(part.slot, audio);
    return audio;
  }

  /** Dispose the `music-<slot>` part, its strip and its load meter entry, and nothing else (#629 decision 1). */
  remove(slot: number): void {
    this.strips.remove(musicPartName(slot));
    this.parts.delete(slot);
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
