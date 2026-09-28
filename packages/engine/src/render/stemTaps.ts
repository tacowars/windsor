/**
 * The stem taps of one render pass (windsor#41): extra edges off the live
 * system's graph into the offline context's wider destination, added after
 * the system is built and before it plays. Nothing in the system changes;
 * the master still reaches channels 0–1 through the limiter, as in the song
 * render.
 *
 *   strip rotation.output ─▶ highpass (the music bus's) ─┐
 *   return.output ───────────────────────────────────────┤ splitter ─▶ merger pair 2k, 2k+1
 *                                                        ▼
 *                                   merger ─▶ gain (master level × music fader × output gain) ─▶ destination
 *
 * A part's stem is the strip's dry output: post-fader, post-insert, post-pan,
 * with its sends excluded (decision 1). The music bus's highpass sits on the
 * dry sum before the master, so each part's stem runs through a copy of it
 * (`MUSIC_BUS_OPTIONS`); a return joins the master after that filter and is
 * taken as it is. The one gain after the merger is the scalar gains the
 * master applies after its inserts — its level, the music fader, the engine's
 * output gain — so the stems summed are the master with its inserts and the
 * safety limiter bypassed, and nothing else.
 *
 * A part routed "Sidechain only" has its dry path gated to silence; asked
 * for, its stem is taken before the gate (the strip's `head`) through a
 * rotation at the strip's pan, so it sounds as it would routed to the master.
 */
import type { AudioBus } from '../mixer/audioBus';
import { MUSIC_BUS_OPTIONS, createBus } from '../mixer/audioBus';
import type { StereoRotate } from '../mixer/stereoRotate';
import { createStereoRotate } from '../mixer/stereoRotate';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from '../system/audioSystem';
import { RENDER_CHANNELS } from './renderConstants';
import type { PartStem, StemSource } from './stemPlan';
import { passChannels } from './stemPlan';

/** Wire `stems` onto channel pairs 2k, 2k+1 of the pass; the return undoes it. */
export function attachStems(system: AudioSystem, stems: readonly StemSource[]): () => void {
  const context = system.engine.context;
  const merger = context.createChannelMerger(passChannels(stems.length));
  const gain = context.createGain();
  gain.gain.value = masterScalarGain(system);
  merger.connect(gain);
  gain.connect(context.destination);
  const undo: (() => void)[] = [];
  stems.forEach((stem, k) => {
    const tap = stem.kind === 'part' ? partTap(system, stem) : returnTap(system, stem.name);
    const splitter = context.createChannelSplitter(RENDER_CHANNELS);
    tap.output.connect(splitter);
    for (let c = 0; c < RENDER_CHANNELS; c++) {
      splitter.connect(merger, c, RENDER_CHANNELS * (k + 1) + c);
    }
    undo.push(() => {
      tap.output.disconnect(splitter);
      splitter.disconnect();
      tap.dispose();
    });
  });
  return () => {
    for (const step of undo) step();
    merger.disconnect();
    gain.disconnect();
  };
}

/** The scalar gains between the master's inserts and its limiter, multiplied. */
export function masterScalarGain(system: AudioSystem): number {
  const level = system.masterStrip?.output.gain.value ?? 1;
  return level * system.musicGain * system.engine.master.gain.value;
}

interface Tap {
  readonly output: AudioNode;
  dispose(): void;
}

function partTap(system: AudioSystem, stem: PartStem): Tap {
  const context = system.engine.context;
  const strip = system.strip(musicPartName(stem.slot));
  if (!strip) throw new Error(`stem: part ${stem.slot} has no strip`);
  let rotation: StereoRotate | null = null;
  let source: AudioNode = strip.rotation.output;
  if (stem.muted) {
    // The dry path is gated after `head`: tap before the gate, and pan here.
    rotation = createStereoRotate(context, strip.rotation.pan);
    strip.head.connect(rotation.input);
    source = rotation.output;
  }
  const bus: AudioBus = createBus(context, MUSIC_BUS_OPTIONS);
  source.connect(bus.input);
  return {
    output: bus.output,
    dispose(): void {
      source.disconnect(bus.input);
      if (rotation) {
        strip.head.disconnect(rotation.input);
        rotation.dispose();
      }
      bus.input.disconnect();
      bus.filter?.disconnect();
      bus.output.disconnect();
    },
  };
}

function returnTap(system: AudioSystem, name: string): Tap {
  const bus = system.returnBus(name);
  if (!bus) throw new Error(`stem: no return "${name}"`);
  return { output: bus.output, dispose: () => {} };
}
