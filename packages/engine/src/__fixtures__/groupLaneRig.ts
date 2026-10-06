/**
 * The group lanes' rig (windsor#614): the live system on the fake graph with
 * a stand-in node for every worklet insert (`insertParamRig.ts`), and the
 * fixture song with the kick and the hat in a Drums group holding a Phaser.
 * A structural insert edit waits until the test runs its fade (`settle`), so
 * a test can see the lanes before and after the re-wire. Node-only, like the
 * rest of this directory.
 */
import { FakeContext } from './fakeAudioContext';
import type { FakeParam } from './fakeAudioNodes';
import { FULL_DOCUMENT, FULL_SLOT } from './fullArrangement';
import { GROUP_PHASER, LANE_GROUP_ID } from './groupAutomationSong';
import { sources } from './stripRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import type { AutomationLane } from '../automation/automationLane';
import type { GroupBus } from '../mixer/groupBus';
import type { GroupSpec } from '../mixer/mix';
import { PPQ } from '../sequencing/scheduler';
import type { ArrangementDocument, DocumentPart } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';

/** One tick at the fixture's tempo, and the time a transport started at 0 issues its first. */
export const GROUP_TICK = 60 / FULL_DOCUMENT.transport.bpm / PPQ;
export const GROUP_FIRST = SCHEDULER_START_DELAY_SECONDS;

/** The group the rig's song plays the kick and the hat through: the Phaser, unity, centred. */
export const RIG_GROUP: GroupSpec = {
  id: LANE_GROUP_ID,
  name: 'Drums',
  level: 1,
  pan: 0,
  inserts: [GROUP_PHASER],
};

/** What a rig's song holds besides the fixture: the group's fields, its members, the hat's lanes. */
export interface GroupLaneSong {
  readonly group?: Partial<GroupSpec>;
  /** The slots routed into the group; the kick and the hat by default. */
  readonly members?: readonly number[];
  readonly hatLanes?: readonly AutomationLane[];
}

/** The fixture song with `song`'s group, members and hat lanes. */
export function groupLaneSong(song: GroupLaneSong = {}): ArrangementDocument {
  const members = new Set(song.members ?? [FULL_SLOT.kick, FULL_SLOT.hat]);
  const parts = FULL_DOCUMENT.parts.map((part): DocumentPart => {
    const strip = members.has(part.slot)
      ? { ...part.strip, output: { group: LANE_GROUP_ID } }
      : part.strip;
    const lanes = part.slot === FULL_SLOT.hat && song.hatLanes ? { automation: song.hatLanes } : {};
    return { ...part, strip, ...lanes };
  });
  return { ...FULL_DOCUMENT, parts, groups: [{ ...RIG_GROUP, ...song.group }] };
}

export interface GroupLaneRig {
  readonly sys: AudioSystem;
  readonly context: FakeContext;
  /** The live group bus, while the song holds the group. */
  bus(): GroupBus;
  /** The group fader's param. */
  level(): FakeParam;
  /** A param of the group's live stage of kind `kind`. */
  insertParam(kind: string, name: string): FakeParam;
  /** A part's own fader param. */
  partLevel(slot: number): FakeParam;
  /** Pump the transport to `until`. */
  play(until: number): void;
  /** Run the re-wires waiting out their fade, at `time`. */
  settle(time: number): void;
}

const fakeParam = (param: AudioParam): FakeParam => param as unknown as FakeParam;

/** The live system on `document`, every structural insert edit held until `settle`. */
export async function groupLaneRig(document: ArrangementDocument): Promise<GroupLaneRig> {
  const context = new FakeContext();
  const waiting: (() => void)[] = [];
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), {
    defer: (run) => waiting.push(run),
  });
  await sys.init();
  sys.initMusic(document);
  const bus = (): GroupBus => sys.groupBus(LANE_GROUP_ID)!;
  return {
    sys,
    context,
    bus,
    level: () => fakeParam((sources(bus().output)[0] as unknown as GainNode).gain),
    insertParam(kind, name) {
      const stage = bus().inserts.find((s) => s.kind === kind)!;
      return stage.processor!.parameters.get(name) as unknown as FakeParam;
    },
    partLevel: (slot) => fakeParam(sys.strip(musicPartName(slot))!.part.gain),
    play(until) {
      for (let t = context.currentTime; t <= until; t += 0.025) {
        context.currentTime = t;
        sys.update(0);
      }
      context.currentTime = until;
    },
    settle(time) {
      context.currentTime = time;
      for (const run of waiting.splice(0)) run();
    },
  };
}
