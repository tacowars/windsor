/** Public surface of the audio package. */
export { AudioSystem } from './audioSystem';
export type { AudioSystemOptions } from './audioSystem';
export { FmEngine } from './fmEngine';
export type { PartOptions } from './fmEngine';
export { AudioPart } from './audioPart';
export { Scheduler } from './scheduler';
export type { SchedulerOptions } from './scheduler';
export { createBus } from './audioBus';
export type { AudioBus, BusOptions } from './audioBus';
export { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './reverbSpace';
export type { ReverbSpace, SpaceName } from './reverbSpace';
export { renderPatchToBuffer } from './offlineRender';
export type { BakeOptions } from './offlineRender';
export { attachPartToBabylon, createBabylonAudio } from './babylonBridge';
export { PRESETS, PRESET_NAMES } from './presets';
export * from './patch';
// Transport and pure generators (#74). None of these import the audio graph;
// `generatorBoundary.test.ts` enforces it.
export {
  BEATS_PER_BAR,
  DIVISORS,
  DIVISOR_NAMES,
  PPQ,
  TICKS_PER_BAR,
  TickTransport,
  isBarDivisor,
} from './scheduler';
export type {
  AudioClock,
  DivisorName,
  TickEvent,
  TickHandler,
  TickSource,
  Unsubscribe,
} from './scheduler';
export { euclid, patternFromString, patternToString, rotatePattern } from './euclid';
export type { Pattern } from './euclid';
export { GENERATOR_SEED_STRIDE, generatorRng, generatorSeed } from './generatorSeed';
export type { Rng } from './generatorSeed';
export type { NoteEvent, NoteHandler, NoteOffEvent, NoteOnEvent } from './noteEvent';
export {
  SCALES,
  SCALE_NAMES,
  SEMITONES_PER_OCTAVE,
  ScaleSampler,
  scaleOffsets,
  uniformWeights,
} from './scaleSampler';
export type { Register, SampledNote, ScaleName, ScaleSamplerConfig } from './scaleSampler';
export {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  EuclideanSequencer,
  LFO_SHAPES,
  lfoValue,
} from './euclideanSequencer';
export type {
  DensityMod,
  DensityModKind,
  EuclideanConfig,
  LfoShape,
  OnsetEvent,
  OnsetHandler,
} from './euclideanSequencer';
export { ARP_WALK_MODES, Arpeggiator, DEFAULT_ARPEGGIATOR_CONFIG } from './arpeggiator';
export type { ArpWalkMode, ArpeggiatorConfig } from './arpeggiator';
export { DEFAULT_STEP_SEQUENCER_CONFIG, StepSequencer } from './stepSequencer';
export type { StepSequencerConfig } from './stepSequencer';
