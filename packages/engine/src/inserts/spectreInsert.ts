/**
 * Spectre's graph (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`): `input → processor → output`, one
 * worklet node. Settings and the song's tempo write params; the tempo reaches
 * the processor folded into the delay's full scale, the grid's step and the
 * synced LFO's rate. The drawn cells and the selection are no params: they
 * travel as one payload (`spectreCellPayload`), handed over at construction
 * and posted again whenever a `set` changes it.
 *
 * The workbench reads the stage's `spectreScope`: each channel's spectrum
 * binned to the cells and the LFO's level, posted only while active, and
 * Listen, which solos the selection.
 *
 * Follow (decision 4) is Bloom's Song chord seam (windsor#729): the stage owns
 * the `pitches` param, `set` leaves it out, and it holds the song key's pitch
 * classes while the key is followed, or the chords `setChord` schedules while
 * the chord is; a chord not yet handed over plays the key, and no key yet,
 * every pitch class. Leaving Chord cancels what is scheduled from now.
 */
import { scaleOffsets } from '../sequencing/scaleSampler';
import { pitchMask } from './bloomPitches';
import type { SongKey } from './bloomPitches';
import { workletFieldParams } from './insertFieldHandles';
import type { InsertKind, InsertStage } from './insertKind';
import { spectreCellPayload } from './spectreCells';
import { SPECTRE_CELLS, SPECTRE_DSP, SPECTRE_NAME, SPECTRE_PITCHES_ALL } from './spectreConstants';
import { spectreParamOf, spectreParameters, spectreTiming } from './spectreParameters';
import { DEFAULT_SPECTRE, SPECTRE_FIELDS, normaliseSpectre } from './spectreSpec';
import type { SpectreSpec } from './spectreSpec';

/** What the workbench reads of a live Spectre. */
export interface SpectreScopeReading {
  /**
   * Each channel's input and output power in each cell (left's cells, then
   * right's, `2 · SPECTRE_CELLS` long), the loudest band held since the last
   * report; null before one arrives.
   */
  readonly input: Float32Array | null;
  readonly output: Float32Array | null;
  /** The LFO's level when the report closed, −1..1. */
  readonly lfo: number;
  /** The pitch classes the selection followed then, a 12-bit mask; 0 while it follows nothing. */
  readonly pitches: number;
  /** Bumped each time a report arrives. */
  readonly reports: number;
}

export interface SpectreScope {
  read(): SpectreScopeReading;
  setActive(active: boolean): void;
  /** Solo the selection, wet (live only; it never reaches the song). */
  setListen(listen: boolean): void;
}

interface ScopeMessage {
  type: string;
  input: Float32Array;
  output: Float32Array;
  lfo: number;
  pitches: number;
}

const EMPTY: SpectreScopeReading = { input: null, output: null, lfo: 0, pitches: 0, reports: 0 };

function scopeOf(processor: AudioWorkletNode): { scope: SpectreScope; release(): void } {
  let reading = EMPTY;
  let active = false;
  let listening = false;
  const receive = (event: MessageEvent): void => {
    const data = event.data as ScopeMessage;
    if (data.type !== 'scope' || data.input.length !== 2 * SPECTRE_CELLS) return;
    reading = {
      input: data.input,
      output: data.output,
      lfo: data.lfo,
      pitches: data.pitches,
      reports: reading.reports + 1,
    };
  };
  processor.port.addEventListener('message', receive);
  processor.port.start();
  const scope: SpectreScope = {
    read: () => reading,
    setActive(next): void {
      if (next === active) return;
      active = next;
      if (!active) reading = { ...EMPTY, reports: reading.reports };
      processor.port.postMessage({ type: 'scope', enabled: active });
    },
    setListen(next): void {
      if (next === listening) return;
      listening = next;
      processor.port.postMessage({ type: 'listen', enabled: listening });
    },
  };
  return { scope, release: () => processor.port.removeEventListener('message', receive) };
}

const samePayload = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Follow's seam on the stage's own `pitches` param: what it holds for a
 * spec's Follow, the key and chords handed in, and the switch between them.
 */
function followOf(
  context: BaseAudioContext,
  pitches: AudioParam,
  spec: SpectreSpec,
): Required<Pick<InsertStage<SpectreSpec>, 'setHarmony' | 'setChord'>> & {
  set(next: SpectreSpec): void;
} {
  let current = spec;
  let songKey: SongKey | undefined;
  let chord: number | undefined;
  const keyMask = (): number =>
    songKey ? pitchMask(songKey.root, scaleOffsets(songKey.scale)) : SPECTRE_PITCHES_ALL;
  /** What `pitches` holds for `spec` now: the key, the last chord (or the key), or every class. */
  const held = (s: SpectreSpec): number =>
    s.follow === 'key'
      ? keyMask()
      : s.follow === 'chord'
        ? (chord ?? keyMask())
        : SPECTRE_PITCHES_ALL;
  pitches.value = held(spec);
  return {
    set(next): void {
      const was = current.follow;
      current = next;
      if (was === next.follow) return;
      pitches.cancelScheduledValues(context.currentTime);
      pitches.value = held(next);
    },
    setHarmony(root, scale): void {
      songKey = { root, scale };
      if (current.follow === 'key' || (current.follow === 'chord' && chord === undefined)) {
        pitches.value = held(current);
      }
    },
    setChord(mask, time, hold): void {
      chord = mask;
      if (current.follow !== 'chord') return;
      if (hold) pitches.cancelScheduledValues(time);
      pitches.setValueAtTime(mask, time);
    },
  };
}

function create(context: BaseAudioContext, spec: SpectreSpec): InsertStage<SpectreSpec> {
  let current = spec;
  let bpm: number = SPECTRE_DSP.defaultBpm;
  let cells = spectreCellPayload(spec);
  const processor = new AudioWorkletNode(context, SPECTRE_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: spectreParameters(spec, bpm),
    processorOptions: { cells },
  });
  const input = context.createGain(),
    output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const { scope, release } = scopeOf(processor);
  const params = workletFieldParams(
    processor,
    (name) => spectreParameters(current, bpm)[name]!,
    spectreParamOf,
  );
  const follow = followOf(context, processor.parameters.get('pitches')!, spec);
  return {
    kind: 'spectre',
    input,
    output,
    processor,
    set(next): void {
      current = next;
      params.write(spectreParameters(current, bpm));
      follow.set(next);
      const payload = spectreCellPayload(current);
      if (samePayload(payload, cells)) return;
      cells = payload;
      processor.port.postMessage({ type: 'cells', cells: payload });
    },
    setTempo(next): void {
      bpm = next;
      params.write(spectreTiming(current, bpm));
    },
    setHarmony: follow.setHarmony,
    setChord: follow.setChord,
    param: (field) => params.param(field),
    spectreScope: scope,
    dispose(): void {
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      release();
      processor.port.close();
    },
  };
}

export const SPECTRE_INSERT: InsertKind<SpectreSpec> = {
  fields: SPECTRE_FIELDS,
  defaults: DEFAULT_SPECTRE,
  normalise: normaliseSpectre,
  create,
};
