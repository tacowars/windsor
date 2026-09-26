// @dir Synthesised music and SFX — bus/return graph, arrangement, sequencers. Observes, never decides.
/** Public surface of the audio package. */
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
export { musicPartName, partAt, removePart } from './song/documentParts';
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
export { ARRANGEMENT_LIBRARY, ARRANGEMENT_NAMES, selectMusic } from './game/arrangementLibrary';
export type { MusicSelection } from './game/arrangementLibrary';
export { AudioLoadMeter, ZERO_AUDIO_LOAD, quantumBudgetMs, reportQuanta } from './cost/audioLoad';
export type { AudioLoadReadout } from './cost/audioLoad';
export { ZERO_AUDIO_COST } from './cost/audioCost';
export type { AudioCostReadout } from './cost/audioCost';
export { SchedCostMeter, ZERO_SCHED_COST } from './cost/schedCost';
export type { SchedCostMeterOptions, SchedCostReadout } from './cost/schedCost';
export {
  PlaybackStatsWindow,
  asPlaybackStatsHost,
  hasPlaybackStats,
  playbackLatencies,
  playbackWindowDelta,
  snapshotPlaybackStats,
  underrunMsPerEvent,
} from './cost/playbackStats';
export type {
  AudioPlaybackStatsApi,
  PlaybackLatencies,
  PlaybackStatsHost,
  PlaybackStatsSnapshot,
  PlaybackStatsWindowOptions,
  PlaybackWindowDelta,
  PlaybackWindowResult,
} from './cost/playbackStats';
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
export * from './inserts/insertConstants';
export { createStereoRotate, rotationAngle, rotationGains } from './mixer/stereoRotate';
export type { RotationGains, StereoRotate } from './mixer/stereoRotate';
export { DEFAULT_SPACE, SPACES, SPACE_NAMES, makeSpace } from './mixer/reverbSpace';
export {
  AUDIO_STATS_SETTLE_MS,
  DEFAULT_ARRANGEMENT_NAME,
  REVERB_SPACE_RANGES,
} from './audioConstants';
export type { ReverbSpace, SpaceName } from './mixer/reverbSpace';
export { renderPatchToBuffer } from './sfx/offlineRender';
export type { BakeOptions } from './sfx/offlineRender';
export { attachPartToBabylon, createBabylonAudio } from './game/babylonBridge';
export {
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  SWEEP_COMMAND,
  loadPatchFile,
  loadPatchLibrary,
  patchContentHash,
  patchLeafDifferences,
} from './patch/patchLibrary';
export type { HeadroomRecord, LibraryEntry, PatchFile } from './patch/patchLibrary';
// The whole-bank table (`presets.ts`, `presetCatalog.ts`) is deliberately not
// here: since #562 no game path resolves a patch by library id, so the bundler
// drops the 114 files. The editor reaches them through `index-for-editor.ts`.
export { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from './patch/gameplayPatches';
export type { GameplayPatchId } from './patch/gameplayPatches';
export * from './patch/patch';
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
  SLIDE_SECONDS_DEFAULT,
} from './audioConstants';

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
