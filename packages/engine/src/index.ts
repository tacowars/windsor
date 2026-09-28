/**
 * The engine's public surface (issue #70): the one entry `@windsor/app`
 * imports. The engine touches nothing but Web Audio, so the console drives
 * the real `AudioSystem` rather than a copy of it; ESLint keeps the app from
 * reaching past this file, and `consoleBoundary.test.ts` keeps it from
 * building a graph of its own.
 */
/* eslint-disable max-lines -- one export list, one entry per engine name the console may reach; a split would be two halves of the same surface */
export { AudioSystem } from './system/audioSystem';
export type { AudioSystemOptions, MusicReadout } from './system/audioSystem';
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
  Swing,
  SwingGrid,
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
// Per-step parameter modulation (windsor#17): the lanes and the table behind them.
export { isStepModParam, stepModAt } from './sequencing/stepModLanes';
export type { StepModLane } from './sequencing/stepModLanes';
export {
  STEP_MOD_LANES_MAX,
  STEP_MOD_PARAMS,
  STEP_MOD_SLOT_COUNT,
  STEP_MOD_TABLE,
} from './worklet/fm/stepModTables';
export type { StepModCurve, StepModParam, StepModRow } from './worklet/fm/stepModTables';
export { stepModValue } from './worklet/fm/stepModValue';
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
  ARP_OCTAVES_MAX,
  ARP_OCTAVES_MIN,
} from './audioConstants';
export type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  MusicTransport,
  PartHost,
  PlayablePart,
} from './song/arrangementPlayer';
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
export { renderPatchToBuffer } from './render/offlineRender';
export type { BakeOptions } from './render/offlineRender';
// The song render and the WAV writer (windsor#40).
export { renderRefusal, renderSong, songSeconds } from './render/renderSong';
export type { RenderSongOptions, RenderedSong } from './render/renderSong';
export { encodeWav, encodeWavAsync } from './render/wavEncoder';
export type { EncodedWav } from './render/wavEncoder';
export {
  RENDER_SAMPLE_RATES,
  RENDER_SAMPLE_RATE_DEFAULT,
  RENDER_TAIL_SECONDS,
  WAV_BIT_DEPTHS,
  WAV_BIT_DEPTH_DEFAULT,
} from './render/renderConstants';
export type { RenderSampleRate, WavBitDepth } from './render/renderConstants';
export { loadBuiltInLibrary } from './patch/builtInLibrary';
export type { BuiltInLibrary } from './patch/builtInLibrary';
export {
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  loadPatchFile,
  loadPatchLibrary,
  patchLeafDifferences,
} from './patch/patchLibrary';
export type { LibraryEntry, PatchFile } from './patch/patchLibrary';
export { serialisePatchFile } from './patch/patchFileSerialise';
export { FALLBACK_PATCH, FALLBACK_PATCH_ID } from './patch/fallbackPatch';
export * from './patch/patch';
// The operator width's bounds and the second LFO's defaults (windsor#54).
export { LFO2_DEFAULTS, WIDTH_RANGE } from './worklet/fm/patchDefaults';
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
/**
 * Song swing (windsor#14): the bounds and grids of `transport.swing`. A live
 * edit is `ctx.change({ transport: { swing: { amount, grid } } })`, either
 * field alone allowed.
 */
export {
  STRAIGHT_SWING,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_GRIDS,
} from './sequencing/swingTables';
/**
 * The song loop (windsor#15): `transport.loop = { start, end, on }` in ticks,
 * snapped to `LOOP_GRID_TICKS`. A live edit is
 * `ctx.change({ transport: { loop: { start, end, on } } })`, any field alone.
 * The clock itself jumps back at the loop's end, so `audibleTick` already
 * reads inside the loop and the playhead's `tick mod songTicks` stays the
 * rule; ▶ from rest and ■ land on `playStartTick`.
 */
export { LOOP_GRID_TICKS, fitLoopRange, playStartTick, tickLoopOf } from './song/songLoop';
export type { SongLoop } from './song/arrangement';
export { followingTick, isLoopJump } from './sequencing/scheduler';
export type { TickLoop } from './sequencing/scheduler';
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
export { ARP_STYLES, DEFAULT_ARP_CONFIG, assertArpConfig } from './sequencing/arpSequencer';
export { Arpeggiator, arpNoteList } from './sequencing/arpeggiator';
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

export { HIDDEN_CATEGORY, filterPresets } from './patch/presetCatalog';
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

// Format versions (record `2026-09-28-format-versions-refuse-never-destroy`).
export { SONG_MIGRATIONS, upgradeSong } from './song/songMigrations';
export type { FormatMigrations, SongUpgrade } from './song/songMigrations';
export {
  PATCH_FILE_MIGRATIONS,
  PATCH_FORMAT_ABSENT,
  PATCH_MIGRATIONS,
  PatchFormatError,
  upgradePatch,
  upgradePatchFile,
} from './patch/patchMigrations';
export type { FormatRefusal, Migration, MigrationTable } from './song/formatUpgrade';
