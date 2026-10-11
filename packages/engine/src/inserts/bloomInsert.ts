/**
 * bloom's stage. The stage owns DSP lifetime, the mixer owns output edges.
 *
 *   input ─▶ processor ─(0: dry + layer · (1 − split))──────────────────────▶ output
 *                      ─(1: the layer after Amount)─▶ [slot child ─▶ fade] ─▶ ret ─┘
 *                      ─(2: Mix's wet share × switch)─▶ ret.gain
 *
 * bloom is a host (record `2026-10-11-bloom-insert` decision 14, E2): it
 * mixes inside its worklet, and a child can't return into the worklet
 * without a cycle, so the layer leaves on output 1 and comes back through
 * `ret`, a native gain at 0 whose gain is output 2 (`BLOOM_SLOT`). The slot
 * module (`mixer/insertSlot.ts`) wires the child between them and fades it;
 * `route` ramps the processor's a-rate `split` over the same window with
 * `fadeRamp`, so the layer leaves output 0 exactly as the child's fade
 * brings it back. All three outputs and `ret` are built with the stage, so
 * the first child takes the normal arrival path.
 *
 * On Scale's Song chord (windsor#729) the stage owns `pitches`: `set` leaves
 * it out, and `setChord` schedules the sets the follower hands over. The
 * stage keeps the last one on any scale, so a switch to Song chord takes it
 * at once; a switch away cancels what is scheduled from now and writes the
 * spec's own set.
 */
import { fadeRamp } from './fadeRamp';
import { ownParam, workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage, WetPath } from './insertKind';
import {
  BLOOM_BOUNDS,
  BLOOM_NAME,
  BLOOM_SCALE_CHORD,
  BLOOM_SCALE_SONG,
  BLOOM_SLOT,
} from './bloomConstants';
import { bloomPitches } from './bloomPitches';
import type { SongKey } from './bloomPitches';
import {
  BLOOM_FIELDS,
  BLOOM_NUMBERS,
  BLOOM_SWITCHES,
  DEFAULT_BLOOM,
  normaliseBloom,
} from './bloomSpec';
import type { BloomSpec } from './bloomSpec';

/**
 * Every param `set` writes, by name, for `spec`: the numbers as they are,
 * the switches as 0/1, Key and Scale as one pitch set, `pitches`
 * (`bloomPitches.ts`), with Scale's `song` read from `songKey`. The
 * processor's `split` param is no field's, so it is not here.
 */
export function bloomValues(spec: BloomSpec, songKey?: SongKey): Record<string, number> {
  const values: Record<string, number> = {};
  for (const name of BLOOM_NUMBERS) values[name] = spec[name];
  for (const name of BLOOM_SWITCHES) values[name] = Number(spec[name]);
  values.pitches = bloomPitches(spec, songKey);
  return values;
}

/** The fields a lane may hold: the numbers, the switch and Freeze. Key and Scale are enums (guide §4.5). */
const numberOrSwitch = ownParam(BLOOM_BOUNDS);
const bloomParamOf = (field: string): string | undefined =>
  field === 'freeze' ? field : numberOrSwitch(field);

/**
 * bloom's wet path: the child takes output 1 and returns into `ret`, whose
 * gain output 2 drives; `route` crosses `split` from where it has reached
 * now, so a reversal mid-window turns round with no step.
 */
function bloomWetPath(
  context: BaseAudioContext,
  processor: AudioWorkletNode,
  ret: GainNode,
): WetPath {
  const ramp = fadeRamp(context, processor.parameters.get(BLOOM_SLOT.splitParam)!);
  return {
    send: { node: processor, output: BLOOM_SLOT.wetOutput },
    ret,
    route: (on: boolean): void => ramp.to(on ? 1 : 0),
  };
}

/** bloom's nodes, wired as the diagram at the top has them. */
function bloomGraph(context: BaseAudioContext, spec: BloomSpec) {
  const processor = new AudioWorkletNode(context, BLOOM_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: BLOOM_SLOT.outputs,
    outputChannelCount: [...BLOOM_SLOT.outputChannelCount],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: bloomValues(spec),
  });
  const input = context.createGain();
  const output = context.createGain();
  // Silent until a child plays into it; its gain is output 2 alone.
  const ret = context.createGain();
  ret.gain.value = 0;
  input.connect(processor);
  processor.connect(output, BLOOM_SLOT.mixOutput);
  processor.connect(ret.gain, BLOOM_SLOT.wetGainOutput);
  ret.connect(output);
  return { processor, input, output, ret };
}

/** bloom's kind: input → processor → output, with its slot's return beside it. */
export const BLOOM_INSERT: InsertKind<BloomSpec> = {
  fields: BLOOM_FIELDS,
  defaults: DEFAULT_BLOOM,
  normalise: normaliseBloom,
  create(context, spec): InsertStage<BloomSpec> {
    let current = spec;
    // The last song key the registry handed over (windsor#717): Scale's `song` reads it.
    let songKey: SongKey | undefined;
    // The last song chord's set (windsor#729): Scale's `chord` plays it.
    let chord: number | undefined;
    const onChord = (s: BloomSpec): boolean => s.scale === BLOOM_SCALE_CHORD;
    const { processor, input, output, ret } = bloomGraph(context, spec);
    const pitches = processor.parameters.get('pitches')!;
    const params = workletFieldParams(
      processor,
      (name) => bloomValues(current, songKey)[name]!,
      bloomParamOf,
    );
    return {
      kind: 'bloom',
      input,
      output,
      processor,
      wetPath: bloomWetPath(context, processor, ret),
      set(next): void {
        const was = onChord(current);
        current = next;
        const { pitches: own, ...values } = bloomValues(next, songKey);
        if (was !== onChord(next)) pitches.cancelScheduledValues(context.currentTime);
        if (!onChord(next)) values.pitches = own!;
        else if (!was) values.pitches = chord ?? own!;
        params.write(values);
      },
      setHarmony(root, scale): void {
        songKey = { root, scale };
        // Song chord plays the song key until a chord is handed over.
        if (current.scale === BLOOM_SCALE_SONG || (onChord(current) && chord === undefined)) {
          params.write({ pitches: bloomPitches(current, songKey) });
        }
      },
      setChord(mask, time, hold): void {
        chord = mask;
        if (!onChord(current)) return;
        if (hold) pitches.cancelScheduledValues(time);
        pitches.setValueAtTime(mask, time);
      },
      param: (field) => params.param(field),
      dispose(): void {
        input.disconnect();
        processor.disconnect();
        ret.disconnect();
        processor.port.postMessage({ type: 'stop' });
        processor.port.close();
      },
    };
  },
};
