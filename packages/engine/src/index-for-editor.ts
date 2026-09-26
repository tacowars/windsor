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
/* eslint-disable max-lines -- one export list, one entry per engine name the console may reach; a split would be two halves of the same surface */
export { AudioSystem } from './game/audioSystem';
export type { AudioSystemOptions, MusicReadout } from './game/audioSystem';
export {
  SEEDED_KINDS,
  SEQUENCER_KINDS,
  driverOf,
  mergeArrangement,
  mergeParts,
} from './song/arrangement';
export { FALLBACK_ARRANGEMENT } from './song/fallbackArrangement';
export { isShippable, makeArrangement } from './song/arrangementDocument';
export type {
  ArrangementDocument,
  DocumentPart,
  DocumentPartial,
  MakeArrangementResult,
} from './song/arrangementDocument';
export { musicPartName, partAt, removePart, removePartChange } from './song/documentParts';
export type {
  Arrangement,
  ArpDriver,
  ArpSpec,
  BassDriver,
  BassSpec,
  Transport,
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
} from './song/arrangement';
export { ArrangementPlayer } from './song/arrangementPlayer';
export {
  lookupPreset,
  partLabel,
  presetFor,
  validateArrangement,
} from './song/arrangementValidate';
export type { PresetTable } from './song/arrangementValidate';
export { normalisePatch, normalisePatches } from './patch/patchNormalise';
export { applyReturnsLive, applyStripLive } from './mixer/deskApply';
export { normaliseReturns, normaliseStrip } from './song/deskNormalise';
export { normaliseSequencer } from './song/sequencerNormalise';
export {
  DEFAULT_GRID_CONFIG,
  GRID_STEP_KINDS,
  GridSequencer,
  defaultGridSteps,
  gridNote,
} from './sequencing/gridSequencer';
export type {
  GridNoteStep,
  GridSequencerConfig,
  GridStep,
  GridStepKind,
} from './sequencing/gridSequencer';
export {
  CHORD_STEP_KINDS,
  ChordSequencer,
  DEFAULT_CHORD_CONFIG,
  assertChordConfig,
  hitStep,
  layoutSegments,
  restStep,
  voiceHit,
} from './sequencing/chordSequencer';
export type {
  ChordHitStep,
  ChordRestStep,
  ChordSegment,
  ChordSequencerConfig,
  ChordStep,
  ChordStepKind,
} from './sequencing/chordSequencer';
export {
  CHORD_SIZES,
  chordOf,
  chordQuality,
  chordTones,
  diatonicChords,
  isChordSize,
} from './harmony/chordTheory';
export type { Chord, ChordSize } from './harmony/chordTheory';
export { chordName, pitchClassName, romanNumeral, toRoman } from './harmony/chordNames';
export { invertStack, voiceChord } from './harmony/chordVoicing';
export type { VoiceOptions } from './harmony/chordVoicing';
export {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_NOTE_NAMES,
  CHORD_QUALITIES,
  CHORD_VOICINGS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  QUALITY_LABELS,
} from './harmony/chordTables';
export type {
  ChordQuality,
  ChordVoicing,
  ChordVoicingId,
  QualityLabel,
} from './harmony/chordTables';
export { foldDegree } from './sequencing/scaleSampler';
export {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  BARS_MAX,
  BARS_MIN,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BARS,
  GATE_MIN,
  HOLD_DEFAULT,
  HOLD_MAX,
  HOLD_MIN,
  LFO_BARS_DEFAULT,
  LFO_BARS_MIN,
  LFO_HZ_DEFAULT,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  PITCH_CLASS_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
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
} from './song/arrangementPlayer';
export { installMusicControls } from './game/musicControls';
export type { MusicChoice, MusicLog } from './game/musicControls';
export { musicDocumentFromQuery, musicEnabledFromQuery } from './game/musicOptions';
export { FmEngine } from './synth/fmEngine';
export type { PartOptions, WorkletUrls } from './synth/fmEngine';
export { AudioPart } from './synth/audioPart';
export { Scheduler } from './sequencing/scheduler';
export type { SchedulerOptions } from './sequencing/scheduler';
export { createBus } from './mixer/audioBus';
export type { AudioBus, BusOptions } from './mixer/audioBus';
export { DEFAULT_STRIP, MIX, RETURNS, RETURN_NAMES, stripFor } from './mixer/mix';
export type {
  ChannelStrip,
  DelayReturn,
  PartName,
  ReturnName,
  ReturnSpec,
  ReverbReturn,
} from './mixer/mix';
export { createReturn, createReturns, createSend } from './mixer/returnBus';
export type { ReturnBus } from './mixer/returnBus';
export { routePart } from './mixer/channelStrip';
export type { PartStrip, StripStage } from './mixer/channelStrip';
export { createLowCutStage } from './mixer/lowCutStage';
export type { LowCutStage } from './mixer/lowCutStage';
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
export { CHORUS_PRESETS, applyChorusPreset, matchingChorusPreset } from './inserts/chorusPresets';
export * from './inserts/insertConstants';
export { DEFAULT_RETRO_REVERB } from './inserts/retroReverbSpec';
export type { RetroReverbSpec } from './inserts/retroReverbSpec';
export { RETRO_REVERB_BOUNDS, RETRO_REVERB_MODES } from './inserts/retroReverbConstants';
export {
  RETRO_REVERB_PRESETS,
  applyRetroPreset,
  matchingRetroPreset,
} from './inserts/retroReverbPresets';
export { createStereoRotate, rotationAngle, rotationGains } from './mixer/stereoRotate';
export type { RotationGains, StereoRotate } from './mixer/stereoRotate';
export { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './mixer/reverbSpace';
export {
  DEFAULT_ARRANGEMENT_NAME,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
  ARRANGEMENT_VERSION,
  MUSIC_PARTS_MAX,
  REVERB_SPACE_RANGES,
  SECONDS_PER_MINUTE,
} from './audioConstants';
export type { ReverbSpace, SpaceName } from './mixer/reverbSpace';
export { renderPatchToBuffer } from './sfx/offlineRender';
export type { BakeOptions } from './sfx/offlineRender';
export { PATCH_LIBRARY, PRESETS, PRESET_NAMES } from './patch/presets';
export {
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  SWEEP_COMMAND,
  loadPatchFile,
  loadPatchLibrary,
  loadUnsweptPatchFile,
  patchContentHash,
  patchLeafDifferences,
} from './patch/patchLibrary';
export type {
  HeadroomRecord,
  LibraryEntry,
  PatchFile,
  UnsweptLibraryEntry,
} from './patch/patchLibrary';
export { serialisePatchFile } from './patch/patchFileSerialise';
export type { UnsweptPatchFile } from './patch/patchFileSerialise';
export { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from './patch/gameplayPatches';
export type { GameplayPatchId } from './patch/gameplayPatches';
export * from './patch/patch';
export {
  BEATS_PER_BAR,
  DIVISORS,
  DIVISOR_NAMES,
  PPQ,
  TICKS_PER_BAR,
  TickTransport,
  isBarDivisor,
} from './sequencing/scheduler';
export type {
  AudioClock,
  DivisorName,
  TickEvent,
  TickHandler,
  TickSource,
  Unsubscribe,
} from './sequencing/scheduler';
export { euclid, patternFromString, patternToString, rotatePattern } from './sequencing/euclid';
export type { Pattern } from './sequencing/euclid';
export { GENERATOR_SEED_STRIDE, hashSeed, streamRng } from './sequencing/generatorSeed';
export { NOT_LIVE, isInfiniteRegion, regionState } from './sequencing/regionClock';
export type { Region, RegionState } from './sequencing/regionClock';
export { RegionGate } from './sequencing/regionGate';
export type {
  PartTickEvent,
  PartTickHandler,
  PartTickSource,
  RegionGateConfig,
  RegionGateHooks,
} from './sequencing/regionGate';
export { chordAt, eventBounds } from './harmony/harmonyTimeline';
export type { EventBounds, Harmony, HarmonyChord, HarmonyEvent } from './harmony/harmonyTimeline';
export {
  ARP_STYLES,
  ArpSequencer,
  DEFAULT_ARP_CONFIG,
  assertArpConfig,
} from './sequencing/arpSequencer';
export type { ArpSequencerConfig, ArpStyle } from './sequencing/arpSequencer';
export {
  BASS_PITCH_MODES,
  BassSequencer,
  DEFAULT_BASS_CONFIG,
  assertBassConfig,
} from './sequencing/bassSequencer';
export type { BassPitchMode, BassSequencerConfig } from './sequencing/bassSequencer';
export { songTicksOf } from './song/arrangementPlayer';
export { defaultHarmonyEvents } from './song/timelineNormalise';
export type { Rng } from './sequencing/generatorSeed';
export type { NoteEvent, NoteHandler, NoteOffEvent, NoteOnEvent } from './sequencing/noteEvent';
export {
  SCALES,
  SCALE_NAMES,
  SEMITONES_PER_OCTAVE,
  ScaleSampler,
  scaleOffsets,
} from './sequencing/scaleSampler';
export type { ScaleName, ScaleSamplerConfig } from './sequencing/scaleSampler';
export {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  EuclideanSequencer,
  LFO_SHAPES,
  lfoValue,
} from './sequencing/euclideanSequencer';
export type {
  DensityMod,
  DensityModKind,
  EuclideanConfig,
  LfoShape,
  OnsetEvent,
  OnsetHandler,
} from './sequencing/euclideanSequencer';

export { HIDDEN_CATEGORY, PRESET_CATALOG, filterPresets } from './patch/presetCatalog';
// The envelope curve the worklet shapes segments with (#620 decision 4): the
// console's display draws with it, and the harness pins it to the DSP.
export { curveShape, segmentLevel } from './worklet/fm/envelope';
export type { PresetListing, PresetFilter } from './patch/presetCatalog';

export { DEFAULT_COMPRESSOR } from './inserts/compressorInsert';
export type { CompressorSpec } from './inserts/compressorInsert';
export {
  COMPRESSOR_ATTACKS,
  COMPRESSOR_RELEASES,
  COMPRESSOR_RATIOS,
  COMPRESSOR_BOUNDS,
  COMPRESSOR_DSP,
} from './inserts/compressorConstants';

export { DEFAULT_MASTER, normaliseMaster } from './mixer/masterSpec';
export type { MasterSpec } from './mixer/masterSpec';
export { PEAK_METER } from './mixer/peakMeterConstants';
export type { PeakMeter } from './mixer/peakMeter';

export { canSidechain } from './mixer/sidechainGraph';
export type { SidechainSource } from './inserts/sidechainSource';

export { DEFAULT_PHASER } from './inserts/phaserSpec';
export type { PhaserSpec } from './inserts/phaserSpec';
export { PHASER_BOUNDS } from './inserts/phaserConstants';
export { PHASER_PRESETS, applyPhaserPreset, matchingPhaserPreset } from './inserts/phaserPresets';

export { DEFAULT_DELAY } from './inserts/delaySpec';
export type { DelaySpec } from './inserts/delaySpec';
export { DELAY_BOUNDS, DELAY_DIVISIONS, DELAY_MODES } from './inserts/delayConstants';
export { DELAY_PRESETS, applyDelayPreset, matchingDelayPreset } from './inserts/delayPresets';

export { DEFAULT_ENSEMBLE } from './inserts/ensembleSpec';
export type { EnsembleSpec } from './inserts/ensembleSpec';
export { ENSEMBLE_BOUNDS } from './inserts/ensembleConstants';
export {
  ENSEMBLE_PRESETS,
  applyEnsemblePreset,
  matchingEnsemblePreset,
} from './inserts/ensemblePresets';

export { DEFAULT_ADVANCED_DRIVE, DEFAULT_DRIVE_STAGE } from './inserts/advancedDriveSpec';
export type { AdvancedDriveSpec, DriveStageSpec } from './inserts/advancedDriveSpec';
export * from './inserts/advancedDriveConstants';
export { driveShape } from './inserts/advancedDriveCurves';
export { DriveFilter } from './inserts/advancedDriveFilter';
export * from './inserts/advancedDrivePresets';
