/**
 * The standing graph a page plays through: the music bus, the song master,
 * the returns and the aux fader, built once by `AudioSystem.init()` and torn
 * down by its `dispose()`. The parts' strips come and go on it
 * (`partStrips.ts`); this owns what stands still.
 *
 * The standing graph, per docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md:
 *
 *   music part.output ─▶ [stages…] ─▶ tail ─┬─ [rotate θ] ─▶ musicBus.input ─▶ [highpass] ─┐
 *                                           ├─ send ─▶ return "room" (plate, 100% wet) ────┤
 *                                           └─ send ─▶ return "echo" (delay) ──────────────┤
 *                                                                                          ▼
 *                                                          song master inserts/level → musicBus.output (the Music fader)
 *                                                                                          │
 *   aux part.output ─▶ [stages…] ─▶ tail ─── [rotate θ] ─▶ auxLevel ─▶ master ◀────────────┘
 *                                                                      └─▶ output stage ─▶ out
 *
 * Each strip's stages sit between the part and its tail, and the rotation and
 * the sends both tap the tail (#639). The first stage is always the strip's
 * low cut (#640), so a room hears the cut signal too. Aux parts — an
 * audition, a metronome, anything outside the song — get the same strip with
 * the aux fader as their dry destination, so they skip the song master but
 * still have a real pan and a send. `musicBus.output` and `auxLevel` are the
 * two channel faders (#518 decision 1): the music one is the bus's existing output gain,
 * so the dry path gains no node, and the returns are summed into it so the
 * room follows the music down. The engine's master is not a fader and never
 * becomes one. The output stage (windsor#93) is the engine's, after its
 * master, so the aux path goes through it too; its mode, ceiling and
 * lookahead are the song's `master.output`, set in place by `AudioSystem`.
 */
import { type AudioBus, MUSIC_BUS_OPTIONS } from '../mixer/audioBus';
import type { RouteOptions } from '../mixer/channelStrip';
import type { MasterStrip } from '../mixer/masterStrip';
import { createMasterStrip } from '../mixer/masterStrip';
import type { ReturnSpec } from '../mixer/mix';
import type { ReturnBus } from '../mixer/returnBus';
import { createReturns } from '../mixer/returnBus';
import type { FmEngine } from '../synth/fmEngine';

/** What a call before the standing graph exists throws. */
const NOT_INITIALISED = 'AudioSystem.init() must be awaited first';

/** The standing nodes a part is routed onto. */
export interface Standing {
  musicBus: AudioBus;
  returns: Readonly<Record<string, ReturnBus>>;
}

export class StandingGraph {
  private musicBus: AudioBus | null = null;
  private masterStripValue: MasterStrip | null = null;
  private returns: Readonly<Record<string, ReturnBus>> | null = null;
  /** The aux strips' dry summing gain — the aux fader (#518); built by `build()`. */
  private auxLevel: GainNode | null = null;
  private musicGainValue = 1;
  private auxGainValue = 1;

  /**
   * `engine` supplies the context, the bus factory and the master the aux
   * fader feeds; `returnSpecs` are the returns to build; `routeOptions` are
   * the song master's, the same every strip gets.
   */
  constructor(
    private readonly engine: FmEngine,
    private readonly returnSpecs: Readonly<Record<string, ReturnSpec>>,
    private readonly routeOptions: RouteOptions,
  ) {}

  /** The song master, distinct from the engine-wide output stage and the channel faders. */
  get masterStrip(): MasterStrip | null {
    return this.masterStripValue;
  }

  /** Build the bus, the song master, the returns and the aux fader. The engine must be initialised. */
  build(): void {
    this.musicBus = this.engine.createBus(MUSIC_BUS_OPTIONS);
    // Keep the dry-only highpass. Returns join after it, before song inserts.
    const master = createMasterStrip(this.engine.context, this.routeOptions);
    this.masterStripValue = master;
    this.musicBus.filter!.disconnect(this.musicBus.output);
    this.musicBus.filter!.connect(master.input);
    master.output.connect(this.musicBus.output);
    this.returns = createReturns(this.engine.context, this.returnSpecs, master.input);
    this.auxLevel = this.engine.context.createGain();
    this.auxLevel.connect(this.engine.master);
    // A level set before `init()` (a saved setting read at boot) lands on the
    // nodes the moment they exist, so no sound is ever made at the wrong one.
    this.musicBus.output.gain.value = this.musicGainValue;
    this.auxLevel.gain.value = this.auxGainValue;
  }

  /** The music bus and the returns; throws before `build()`. */
  standing(): Standing {
    if (!this.musicBus || !this.returns) throw new Error(NOT_INITIALISED);
    return { musicBus: this.musicBus, returns: this.returns };
  }

  /** The aux fader, an aux part's dry destination; throws before `build()`. */
  auxNode(): GainNode {
    if (!this.auxLevel) throw new Error(NOT_INITIALISED);
    return this.auxLevel;
  }

  /** A return by name, once `build()` has built them. */
  returnBus(name: string): ReturnBus | undefined {
    return this.returns?.[name];
  }

  /**
   * The music fader (#518 decision 1): the music bus's own output gain, which
   * every music part and both returns pass through. Safe before `build()` —
   * the value is held and applied when the graph is built.
   */
  setMusicGain(gain: number): void {
    this.musicGainValue = gain;
    if (this.musicBus) this.musicBus.output.gain.value = gain;
  }

  /** The aux strips' fader. Safe before `build()`, like the music fader. */
  setAuxGain(gain: number): void {
    this.auxGainValue = gain;
    if (this.auxLevel) this.auxLevel.gain.value = gain;
  }

  get musicGain(): number {
    return this.musicGainValue;
  }

  get auxGain(): number {
    return this.auxGainValue;
  }

  /** Dispose the returns and the song master, and disconnect the bus and the aux fader. The fader values are kept. */
  dispose(): void {
    if (this.returns) for (const bus of Object.values(this.returns)) bus.dispose();
    this.masterStripValue?.dispose();
    this.masterStripValue = null;
    this.musicBus?.input.disconnect();
    this.musicBus?.filter?.disconnect();
    this.musicBus?.output.disconnect();
    this.auxLevel?.disconnect();
    this.musicBus = null;
    this.returns = null;
    this.auxLevel = null;
  }
}
