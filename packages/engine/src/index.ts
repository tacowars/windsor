// @dir Synthesised music and SFX — bus/return graph, arrangement, sequencers. Observes, never decides.
/** Public surface of the audio package. */
export { AudioSystem } from './audioSystem';
export type { AudioSystemOptions, MusicReadout } from './audioSystem';
export { FALLBACK_ARRANGEMENT, mergeArrangement } from './arrangement';
export { isShippable, makeArrangement } from './arrangementDocument';
export type { ArrangementDocument, MakeArrangementResult } from './arrangementDocument';
export type {
  ArpArrangement,
  ArpDriver,
  Arrangement,
  ArrangementKey,
  DeepPartial,
  DroneArrangement,
  EuclideanDriver,
  MergeResult,
  PercussionArrangement,
  StepDriver,
} from './arrangement';
export { ArrangementPlayer, GENERATOR_INDEX, MUSIC_PART_IDS } from './arrangementPlayer';
export { lookupPreset, presetFor, validateArrangement } from './arrangementValidate';
export type { PresetTable } from './arrangementValidate';
export { normalisePatch, normalisePatches } from './patchNormalise';
export { applyMixLive, applyReturnsLive } from './deskApply';
export { normaliseMix, normaliseReturns } from './deskNormalise';
export type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  MusicPartId,
  MusicTransport,
  PlayablePart,
} from './arrangementPlayer';
export { BarRecorder, assertNotePattern } from './capturedPattern';
export type { NotePattern } from './capturedPattern';
export { installMusicControls } from './musicControls';
export type { MusicChoice, MusicLog } from './musicControls';
export { musicDocumentFromQuery, musicEnabledFromQuery } from './musicOptions';
export { ARRANGEMENT_LIBRARY, ARRANGEMENT_NAMES, selectMusic } from './arrangementLibrary';
export type { MusicSelection } from './arrangementLibrary';
export { AudioLoadMeter, ZERO_AUDIO_LOAD, quantumBudgetMs, reportQuanta } from './audioLoad';
export type { AudioLoadReadout } from './audioLoad';
export { FmEngine } from './fmEngine';
export type { PartOptions, WorkletUrls } from './fmEngine';
export { AudioPart } from './audioPart';
export { Scheduler } from './scheduler';
export type { SchedulerOptions } from './scheduler';
export { createBus } from './audioBus';
export type { AudioBus, BusOptions } from './audioBus';
export { DEFAULT_STRIP, MIX, RETURNS, RETURN_NAMES, stripFor } from './mix';
export type {
  ChannelStrip,
  DelayReturn,
  PartName,
  ReturnName,
  ReturnSpec,
  ReverbReturn,
} from './mix';
export { createReturn, createReturns, createSend } from './returnBus';
export type { ReturnBus } from './returnBus';
export { routePart } from './channelStrip';
export type { PartStrip } from './channelStrip';
export { createStereoRotate, rotationAngle, rotationGains } from './stereoRotate';
export type { RotationGains, StereoRotate } from './stereoRotate';
export { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './reverbSpace';
export { DEFAULT_ARRANGEMENT_NAME, REVERB_SPACE_RANGES } from './audioConstants';
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
