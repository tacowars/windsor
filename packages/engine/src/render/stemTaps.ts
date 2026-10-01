/**
 * The stem taps of one render pass (windsor#41): extra edges off the live
 * system's graph into the offline context's wider destination, added after
 * the system is built and before it plays. Nothing in the system changes;
 * the master still reaches channels 0–1 through the output stage
 * (windsor#93), as in the song render.
 *
 *   strip rotation.output ─▶ highpass (the music bus's) ─┐
 *   group output ──────────▶ highpass (the music bus's) ─┤
 *   return.output ───────────────────────────────────────┤ splitter ─▶ merger pair 2k, 2k+1
 *                                                        ▼
 *                                   merger ─▶ gain (master level × music fader × output gain) ─▶ destination
 *
 * A part's stem is the strip's dry output: post-fader, post-insert, post-pan,
 * with its sends excluded (decision 1). A group's stem is its bus's output
 * (windsor#286): after its inserts, pan, level and gate, where it joins the
 * music bus. The music bus's highpass sits on the dry sum before the master,
 * so each part's and group's stem runs through a copy of it
 * (`MUSIC_BUS_OPTIONS`); a return joins the master after that filter and is
 * taken as it is. The one gain after the merger is the scalar gains the
 * master applies after its inserts — its level, the music fader, the engine's
 * output gain — so the stems summed are the master with its inserts and the
 * output stage bypassed, and nothing else. The stage may delay the master;
 * `renderStems.ts` reads the master that much later, so they line up.
 *
 * A part routed "Sidechain only" has its dry path gated to silence; asked
 * for, its stem is taken before the gate (the strip's `head`) through a
 * rotation that follows the strip's (`StereoRotate.follower`): its pan knob
 * and its pan lane (windsor#344) move both, so the stem sounds as the part
 * would routed to the master.
 * A part muted or soloed out (windsor#154) is taken after the gate like any
 * other, so its stem is silent, as playback plays it, whatever its output.
 * A muted or soloed-out group's gate is shut, so its stem is silent too.
 */
import type { AudioBus } from '../mixer/audioBus';
import { MUSIC_BUS_OPTIONS, createBus } from '../mixer/audioBus';
import type { RotationFollower } from '../mixer/stereoRotate';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from '../system/audioSystem';
import { RENDER_CHANNELS } from './renderConstants';
import type { GroupStem, PartStem, StemSource } from './stemPlan';
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
    const tap = tapFor(system, stem);
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

/** The scalar gains between the master's inserts and the output stage, multiplied. */
export function masterScalarGain(system: AudioSystem): number {
  const level = system.masterStrip?.output.gain.value ?? 1;
  return level * system.musicGain * system.engine.master.gain.value;
}

interface Tap {
  readonly output: AudioNode;
  dispose(): void;
}

function tapFor(system: AudioSystem, stem: StemSource): Tap {
  switch (stem.kind) {
    case 'part':
      return partTap(system, stem);
    case 'group':
      return groupTap(system, stem);
    case 'return':
      return returnTap(system, stem.name);
  }
}

/** `source` through a copy of the music bus's highpass; disposing it takes the copy away. */
function throughMusicHighpass(context: BaseAudioContext, source: AudioNode): Tap {
  const bus: AudioBus = createBus(context, MUSIC_BUS_OPTIONS);
  source.connect(bus.input);
  return {
    output: bus.output,
    dispose(): void {
      source.disconnect(bus.input);
      bus.input.disconnect();
      bus.filter?.disconnect();
      bus.output.disconnect();
    },
  };
}

function partTap(system: AudioSystem, stem: PartStem): Tap {
  const context = system.engine.context;
  const strip = system.strip(musicPartName(stem.slot));
  if (!strip) throw new Error(`stem: part ${stem.slot} has no strip`);
  if (!stem.muted || strip.mute || strip.soloedOut) {
    return throughMusicHighpass(context, strip.rotation.output);
  }
  // Only the sidechain routing closed the gate after `head`: tap before it, and pan
  // here, through a rotation the strip's pan knob and pan lane drive with its own.
  const rotation: RotationFollower = strip.rotation.follower();
  system.resyncAutomation(stem.slot);
  strip.head.connect(rotation.input);
  const tap = throughMusicHighpass(context, rotation.output);
  return {
    output: tap.output,
    dispose(): void {
      tap.dispose();
      strip.head.disconnect(rotation.input);
      rotation.dispose();
    },
  };
}

function groupTap(system: AudioSystem, stem: GroupStem): Tap {
  const bus = system.groupBus(stem.id);
  if (!bus) throw new Error(`stem: no group ${stem.id}`);
  return throughMusicHighpass(system.engine.context, bus.output);
}

function returnTap(system: AudioSystem, name: string): Tap {
  const bus = system.returnBus(name);
  if (!bus) throw new Error(`stem: no return "${name}"`);
  return { output: bus.output, dispose: () => {} };
}
