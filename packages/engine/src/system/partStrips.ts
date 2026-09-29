/**
 * Every part the system created, on its strip, by engine part name: a music
 * part dry into the music bus, an aux part dry into the aux fader, both with
 * sends to every return (`standingGraph.ts` draws the whole graph). A part
 * lives from `createMusic` / `createAux` to `remove` or `dispose`; the
 * standing graph it lands on outlives it.
 */
import type { PartStrip, RouteOptions } from '../mixer/channelStrip';
import { routePart } from '../mixer/channelStrip';
import type { ChannelStrip } from '../mixer/mix';
import { stripFor } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import type { AudioPart } from '../synth/audioPart';
import type { FmEngine } from '../synth/fmEngine';
import type { ScheduledMessage } from '../synth/workletMessages';
import type { StandingGraph } from './standingGraph';
import type { SystemLoadMeter } from './systemLoadMeter';

export interface PartStripsOptions {
  /** Builds and disposes each part's processor. */
  engine: FmEngine;
  /** The bus, the returns and the aux fader a part is routed onto. */
  graph: StandingGraph;
  /** Each part's processor reports its load here, as `part:<name>`. */
  meter: SystemLoadMeter;
  /** The desk: a part's strip when the caller names none. */
  mix: Readonly<Record<string, ChannelStrip>>;
  /** Passed to every strip: its insert registry, its change hook, its fade. */
  routeOptions: RouteOptions;
  /** A part's processor seed, by engine part name (windsor#40); absent draws from `Math.random`. */
  partSeed?: ((name: string) => number) | undefined;
  /** The notes a part's processor is built holding, by engine part name (windsor#40). */
  partEvents?: ((name: string) => ScheduledMessage[] | undefined) | undefined;
}

export class PartStrips {
  private readonly strips = new Map<string, PartStrip>();

  constructor(private readonly options: PartStripsOptions) {}

  /** Create a part on its strip, dry into the music bus. The patch is the caller's (#562). */
  createMusic(name: string, patch: Patch, maxVoices: number, strip?: ChannelStrip): AudioPart {
    const { musicBus } = this.options.graph.standing();
    return this.route(name, patch, maxVoices, musicBus.input, strip);
  }

  /** Create a part on its strip, dry into the aux fader, so it never passes the song master. */
  createAux(name: string, patch: Patch, maxVoices: number): AudioPart {
    const { graph } = this.options;
    graph.standing();
    return this.route(name, patch, maxVoices, graph.auxNode());
  }

  /** The live strip of a part created here. */
  get(name: string): PartStrip | undefined {
    return this.strips.get(name);
  }

  /** Dispose one part: its strip, its load meter entry and its processor, and nothing else (#629 decision 1). */
  remove(name: string): void {
    this.strips.get(name)?.dispose();
    this.strips.delete(name);
    this.options.meter.detach(`part:${name}`);
    this.options.engine.disposePart(name);
  }

  /** Dispose every strip. The processors go with the engine, the meter entries with the meter. */
  dispose(): void {
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
  }

  private route(
    name: string,
    patch: Patch,
    maxVoices: number,
    dry: AudioNode,
    strip?: ChannelStrip,
  ): AudioPart {
    const { engine, graph, meter, mix, routeOptions, partSeed, partEvents } = this.options;
    const { returns } = graph.standing();
    const seed = partSeed?.(name);
    const events = partEvents?.(name);
    const part = engine.createPart(name, {
      patch,
      maxVoices,
      destination: null,
      ...(seed === undefined ? {} : { seed }),
      ...(events === undefined ? {} : { events }),
    });
    meter.attach(`part:${name}`, part.node);
    this.strips.set(
      name,
      routePart(part, strip ?? stripFor(mix, name), returns, dry, routeOptions),
    );
    return part;
  }
}
