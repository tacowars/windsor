/**
 * The console-safe surface of the audio package (issue #70): everything
 * `index.ts` exports except `babylonBridge.ts` — the sole module importing
 * Babylon. The engine below it touches nothing but Web Audio, so the
 * standalone arrangement console can drive the real `AudioSystem` rather
 * than a copy of it.
 *
 * `build-editor.mjs` bundles the console from this entry and asserts the
 * output contains no Babylon; a Babylon import creeping in here fails that
 * build, not the game's.
 */
export { AudioSystem } from './audioSystem';
export type { AudioSystemOptions, MusicReadout } from './audioSystem';
export { SEQUENCER_KINDS, driverOf, mergeArrangement, mergeParts } from './arrangement';
export { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
export { isShippable, makeArrangement } from './arrangementDocument';
export type {
  ArrangementDocument,
  DocumentPart,
  DocumentPartial,
  MakeArrangementResult,
} from './arrangementDocument';
export { musicPartName, partAt, removePart, removePartChange } from './documentParts';
export type {
  ArpDriver,
  ArpSpec,
  Arrangement,
  ArrangementKey,
  ArrangementPartial,
  DeepPartial,
  EuclideanDriver,
  EuclideanSpec,
  MergeResult,
  MusicPart,
  ChordDriver,
  ChordSpec,
  GridDriver,
  GridSpec,
  NoSequencer,
  PartsPartial,
  SequencerKind,
  SequencerSpec,
  StepDriver,
  StepSpec,
} from './arrangement';
export { ArrangementPlayer } from './arrangementPlayer';
export { lookupPreset, partLabel, presetFor, validateArrangement } from './arrangementValidate';
export type { PresetTable } from './arrangementValidate';
export { normalisePatch, normalisePatches } from './patchNormalise';
export { applyReturnsLive, applyStripLive } from './deskApply';
export { normaliseReturns, normaliseStrip } from './deskNormalise';
export { normaliseSequencer } from './sequencerNormalise';
export {
  DEFAULT_GRID_CONFIG,
  GRID_STEP_KINDS,
  GridSequencer,
  defaultGridSteps,
  gridNote,
} from './gridSequencer';
export type { GridNoteStep, GridSequencerConfig, GridStep, GridStepKind } from './gridSequencer';
export {
  CHORD_STEP_KINDS,
  ChordSequencer,
  DEFAULT_CHORD_CONFIG,
  assertChordConfig,
  chordStep,
  layoutSegments,
  restStep,
} from './chordSequencer';
export type {
  ChordChordStep,
  ChordRestStep,
  ChordSegment,
  ChordSequencerConfig,
  ChordStep,
  ChordStepKind,
} from './chordSequencer';
export {
  CHORD_SIZES,
  chordOf,
  chordQuality,
  chordTones,
  diatonicChords,
  isChordSize,
} from './chordTheory';
export type { Chord, ChordSize } from './chordTheory';
export { chordName, pitchClassName, romanNumeral, toRoman } from './chordNames';
export { invertStack, voiceChord } from './chordVoicing';
export type { VoiceOptions } from './chordVoicing';
export {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_NOTE_NAMES,
  CHORD_QUALITIES,
  CHORD_VOICINGS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  QUALITY_LABELS,
} from './chordTables';
export type { ChordQuality, ChordVoicing, ChordVoicingId, QualityLabel } from './chordTables';
export { foldDegree } from './scaleSampler';
export {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  BPM_MAX,
  BPM_MIN,
  GATE_MIN,
  HOLD_DEFAULT,
  HOLD_MAX,
  HOLD_MIN,
  LFO_BARS_DEFAULT,
  LFO_BARS_MIN,
  LFO_HZ_DEFAULT,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  POOL_SIZE_MAX,
  REFRESH_BARS_MAX,
  VELOCITY_DEFAULT,
  WALK_CHANCE,
  EUCLID_STEPS_MAX,
  GRID_DEGREE_MAX,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  CHORD_DURATION_DEFAULT,
  CHORD_GATE_DEFAULT,
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_DEFAULT,
  CHORD_REPEAT_MAX,
  CHORD_SEMITONE_MAX,
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  CHORD_VOICING_NOTES_MAX,
} from './audioConstants';
export type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  MusicTransport,
  PartHost,
  PlayablePart,
} from './arrangementPlayer';
export { BarRecorder, assertNotePattern } from './capturedPattern';
export type { NotePattern } from './capturedPattern';
export { installMusicControls } from './musicControls';
export type { MusicChoice, MusicLog } from './musicControls';
export { musicDocumentFromQuery, musicEnabledFromQuery } from './musicOptions';
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
export type { PartStrip, StripStage } from './channelStrip';
export { createLowCutStage } from './lowCutStage';
export type { LowCutStage } from './lowCutStage';
export {
  INSERT_KINDS,
  INSERT_KIND_NAMES,
  insertKind,
  normaliseInserts,
} from './inserts/insertRegistry';
export type {
  InsertKind,
  InsertKindName,
  InsertRegistry,
  InsertSpec,
  InsertStage,
} from './inserts/insertRegistry';
export { DEFAULT_DRIVE, DRIVE_INSERT, driveCompensation } from './inserts/driveInsert';
export type { DriveSpec } from './inserts/driveInsert';
export { CHORUS_INSERT, DEFAULT_CHORUS } from './inserts/chorusInsert';
export type { ChorusSpec } from './inserts/chorusInsert';
export * from './inserts/insertConstants';
export { createStereoRotate, rotationAngle, rotationGains } from './stereoRotate';
export type { RotationGains, StereoRotate } from './stereoRotate';
export { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './reverbSpace';
export {
  DEFAULT_ARRANGEMENT_NAME,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
  MUSIC_PARTS_MAX,
  REVERB_SPACE_RANGES,
  SECONDS_PER_MINUTE,
} from './audioConstants';
export type { ReverbSpace, SpaceName } from './reverbSpace';
export { renderPatchToBuffer } from './offlineRender';
export type { BakeOptions } from './offlineRender';
export { PATCH_LIBRARY, PRESETS, PRESET_NAMES } from './presets';
export {
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  SWEEP_COMMAND,
  loadPatchFile,
  loadPatchLibrary,
  loadUnsweptPatchFile,
  patchContentHash,
  patchLeafDifferences,
} from './patchLibrary';
export type { HeadroomRecord, LibraryEntry, PatchFile, UnsweptLibraryEntry } from './patchLibrary';
export { serialisePatchFile } from './patchFileSerialise';
export type { UnsweptPatchFile } from './patchFileSerialise';
export { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from './gameplayPatches';
export type { GameplayPatchId } from './gameplayPatches';
export * from './patch';
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

export { HIDDEN_CATEGORY, PRESET_CATALOG, filterPresets } from './presetCatalog';
// The envelope curve the worklet shapes segments with (#620 decision 4): the
// console's display draws with it, and the harness pins it to the DSP.
export { curveShape, segmentLevel } from './worklet/fm/envelope';
export type { PresetListing, PresetFilter } from './presetCatalog';
