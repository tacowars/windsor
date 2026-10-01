/**
 * The Parametric EQ as an insert kind (windsor#198, registered by
 * windsor#199): one stereo worklet node between the stage's own input and
 * output gains. `set` writes the flat k-rate parameters and never re-wires.
 *
 * Two live extras for the card (windsor#200, record
 * `2026-09-30-parametric-eq-insert` decision 9), neither in the spec: the
 * output spectrum, an analyser the stage builds on the first activation and
 * connects from its output only while active, so it is a tap and never in
 * the program path; and Listen on drag, a `listen` message naming the band
 * the processor plays alone. Pinned by `eqInsert.test.ts`.
 */
import type { InsertKind, InsertStage } from './insertKind';
import { EQ_LISTEN, EQ_NAME, EQ_SPECTRUM } from './eqConstants';
import { eqParameterValues } from './eqParameters';
import { DEFAULT_EQ, EQ_FIELDS, normaliseEq } from './eqSpec';
import type { EqSpec } from './eqSpec';

type EqSpectrum = NonNullable<InsertStage<EqSpec>['spectrum']>;

/** The spectrum tap on `output`, and the call that takes it down with the stage. */
function spectrumTap(
  context: BaseAudioContext,
  output: AudioNode,
): { spectrum: EqSpectrum; dispose(): void } {
  let analyser: AnalyserNode | null = null;
  let active = false;
  const spectrum: EqSpectrum = {
    read(into) {
      if (active && analyser) analyser.getFloatFrequencyData(into);
      else into.fill(-Infinity);
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      if (!analyser) {
        analyser = context.createAnalyser();
        analyser.fftSize = EQ_SPECTRUM.fftSize;
        analyser.smoothingTimeConstant = EQ_SPECTRUM.smoothing;
      }
      if (active) output.connect(analyser);
      else output.disconnect(analyser);
    },
  };
  return { spectrum, dispose: () => spectrum.setActive(false) };
}

function create(context: BaseAudioContext, spec: EqSpec): InsertStage<EqSpec> {
  const values = eqParameterValues(spec);
  const processor = new AudioWorkletNode(context, EQ_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    parameterData: values,
  });
  const input = context.createGain();
  const output = context.createGain();
  input.connect(processor);
  processor.connect(output);
  const tap = spectrumTap(context, output);
  return {
    kind: 'eq',
    input,
    output,
    processor,
    spectrum: tap.spectrum,
    set(next): void {
      eqParameterValues(next, values);
      for (const name in values) processor.parameters.get(name)!.value = values[name]!;
    },
    listen(band): void {
      processor.port.postMessage({ type: 'listen', band: band >= 0 ? band : EQ_LISTEN.off });
    },
    dispose(): void {
      tap.dispose();
      input.disconnect();
      processor.disconnect();
      processor.port.postMessage({ type: 'stop' });
      processor.port.close();
    },
  };
}

export const EQ_INSERT: InsertKind<EqSpec> = {
  fields: EQ_FIELDS,
  defaults: DEFAULT_EQ,
  normalise: normaliseEq,
  create,
};
