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
  PartRegion,
  PartsPartial,
  RegionPattern,
  SequencerKind,
  SequencerSpec,
  Swing,
  SwingGrid,
} from './song/arrangement';
export { ArrangementPlayer } from './song/arrangementPlayer';
export { regionPattern } from './song/regionPattern';
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
// Per-step parameter modulation (windsor#17): the lanes, over the voice target table.
export { STEP_MOD_LANES_MAX, isVoiceTargetPath, stepModAt } from './sequencing/stepModLanes';
export { stepModAtCycle } from './sequencing/stepModLanes';
export type { StepModLane } from './sequencing/stepModLanes';
// The voice's modulation targets (windsor#419): one table for song lanes and step lanes.
export {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_PATHS,
  VOICE_TARGET_TABLE,
  voiceTargetRow,
} from './worklet/fm/voiceTargetTables';
export type {
  VoiceTargetCurve,
  VoiceTargetPath,
  VoiceTargetRow,
} from './worklet/fm/voiceTargetTables';
export { stepModValue, voiceTargetValue } from './worklet/fm/voiceTargetValue';
// Song automation lanes (windsor#341, record `2026-10-01-song-automation-lanes`): the pure core.
export type {
  AutomationLane,
  AutomationPoint,
  AutomationScale,
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  InsertTargetId,
  ParsedTarget,
  StripTargetId,
  VoiceTargetId,
} from './automation/automationLane';
export { pointsInOrder } from './automation/automationLane';
export {
  AUTOMATION_GRAIN_TICKS,
  AUTOMATION_STEP_RAMP_SECONDS,
} from './automation/automationConstants';
export {
  AUTOMATION_LEVEL_FLOOR_DB,
  AUTOMATION_STRIP_LEVEL_MAX,
  FM_LANES_MAX,
  STRIP_AUTOMATION_ROWS,
} from './automation/automationTargetTables';
export type { VoiceAutomationRow, VoiceSection } from './automation/automationTargetTables';
export { INSERT_AUTOMATION_FIELDS } from './automation/automationInsertTables';
export type { InsertFieldRow, InsertSpecOf } from './automation/automationInsertTables';
export { automatableInsertFields } from './automation/automationInsertFields';
export {
  STRIP_TARGET_IDS,
  VOICE_AUTOMATION_ROWS,
  VOICE_TARGET_IDS,
  catalogRow,
  formatTargetId,
  insertTargetRow,
  parseTargetId,
  targetKind,
  targetRow,
  voicePathOf,
  voiceTargetId,
} from './automation/automationTargets';
export { DISPLAY_ROW, fromDisplay, toDisplay } from './automation/automationDisplay';
export { bendCurve, rampsBetween, valueAt } from './automation/automationEvaluate';
export type { AutomationRamp, RampWindow } from './automation/automationEvaluate';
export { replaceRange, stampShape } from './automation/automationShapes';
export type { AutomationShapeSpec } from './automation/automationShapes';
export { AUTOMATION_SHAPE_KINDS } from './automation/automationShapeTables';
export type { AutomationShapeKind } from './automation/automationShapeTables';
// The automation player's writer interface (windsor#344); the system plays the lanes itself.
export type { AutomationHandle, AutomationHow } from './automation/automationHandles';
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
  eventChord,
  eventStack,
  isChordSize,
} from './harmony/chordTheory';
export type { Chord, ChordSize, ChordSpelling } from './harmony/chordTheory';
export { chordName, pitchClassName, romanNumeral, toRoman } from './harmony/chordNames';
export { invertStack, voiceChord } from './harmony/chordVoicing';
export type { VoiceOptions } from './harmony/chordVoicing';
export {
  ACCIDENTAL_GLYPHS,
  CHORD_ACCIDENTALS,
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_NOTE_NAMES,
  CHORD_QUALITIES,
  CHORD_VOICINGS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  QUALITY_INTERVALS,
  QUALITY_LABELS,
} from './harmony/chordTables';
export type {
  ChordAccidental,
  ChordQuality,
  ChordVoicing,
  ChordVoicingId,
  NamedQuality,
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
  EUCLID_LANE_STEPS_MAX,
  EUCLID_PITCH_LANE_MAX,
  EUCLID_RATCHET_MAX,
  RATCHET_MAX,
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
  HARMONY_DEGREE_MAX,
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
  RegionStep,
} from './song/arrangementPlayer';
export { FmEngine } from './synth/fmEngine';
export type { PartOptions, WorkletUrls } from './synth/fmEngine';
export { AudioPart } from './synth/audioPart';
export { Scheduler } from './sequencing/scheduler';
export type { SchedulerOptions } from './sequencing/scheduler';
export { createBus } from './mixer/audioBus';
export type { AudioBus, BusOptions } from './mixer/audioBus';
export {
  DEFAULT_GROUP,
  DEFAULT_STRIP,
  MIX,
  RETURNS,
  RETURN_NAMES,
  SEND_BUS_WET_MIX,
  isGroupOutput,
  isReturnName,
  onSendBus,
  stripFor,
} from './mixer/mix';
export type {
  ChannelStrip,
  GroupOutput,
  GroupSpec,
  PartName,
  ReturnName,
  ReturnSpec,
} from './mixer/mix';
// The solo rule over parts and group buses (windsor#284).
export { groupOf, isGroupOpen, isHeard, isSoloing } from './mixer/soloRule';
export type { GroupSwitches } from './mixer/soloRule';
export { createReturn, createReturns, createSend } from './mixer/returnBus';
export type { ReturnBus } from './mixer/returnBus';
export type { GroupBus } from './mixer/groupBus';
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
  MAX_GROUPS,
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
// Stems: one WAV per part and per return beside the master, and the zip they download as (windsor#41).
export { renderStems } from './render/renderStems';
export type { RenderStemsOptions, RenderedStem, RenderedStems } from './render/renderStems';
export { stemSources } from './render/stemPlan';
export type { PartStem, ReturnStem, Stem, StemSource } from './render/stemPlan';
export { StoredZipWriter } from './render/storedZip';
export { crc32, crc32Async } from './render/crc32';
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
// The operator width's bounds and the second LFO's defaults (windsor#54), and a
// Noise operator's colour range and floor (windsor#362).
export {
  LFO2_DEFAULTS,
  NOISE_COLOUR_FLOOR_HZ,
  NOISE_COLOUR_RANGE,
  VOWEL_RANGE,
  WIDTH_RANGE,
} from './worklet/fm/patchDefaults';
// The Formant filter's vowels (windsor#331): the table the voice reads, for the editor's display.
export { FORMANT_PEAKS, FORMANT_VOWELS } from './worklet/fm/formantTables';
export type { FormantVowel } from './worklet/fm/formantTables';
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
export { chordAt, chordIdentity, eventBounds } from './harmony/harmonyTimeline';
export type { EventBounds, Harmony, HarmonyChord, HarmonyEvent } from './harmony/harmonyTimeline';
export { ARP_STYLES, DEFAULT_ARP_CONFIG, assertArpConfig } from './sequencing/arpSequencer';
export { Arpeggiator, arpCellPitch, arpNoteList } from './sequencing/arpeggiator';
export type { ArpSequencerConfig, ArpStyle } from './sequencing/arpSequencer';
// The arp's step grid (windsor#127): the cells, their defaults and the cycle rule.
export { ARP_BOUNCE_STYLES, ARP_STEPS_MAX } from './sequencing/arpStepConstants';
export { arpCycleLength, arpNote, assertArpGrid, defaultArpSteps } from './sequencing/arpSteps';
export type { ArpGridFields, ArpNoteStep, ArpStep } from './sequencing/arpSteps';
export {
  BASS_PITCH_MODES,
  BassSequencer,
  DEFAULT_BASS_CONFIG,
  assertBassConfig,
  bassBarSteps,
  bassNote,
  defaultBassSteps,
} from './sequencing/bassSequencer';
export type {
  BassNoteStep,
  BassPitchMode,
  BassSequencerConfig,
  BassStep,
} from './sequencing/bassSequencer';
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
export { assertEuclidRows, euclidHitRead, laneStep } from './sequencing/euclidLanes';
export type { EuclidHitRead, EuclidRows } from './sequencing/euclidLanes';

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

export { DEFAULT_MASTER, masterOutput, normaliseMaster } from './mixer/masterSpec';
export type { MasterSpec } from './mixer/masterSpec';
export { PEAK_METER } from './mixer/peakMeterConstants';
export type { PeakMeter } from './mixer/peakMeter';

// The engine's output stage (windsor#93): `FmEngine.outputStage` is the live
// one; the song's settings are `master.output`.
export type { OutputStage } from './mixer/outputStage';
export {
  OUTPUT_CEILING_DB,
  OUTPUT_LIMITER,
  OUTPUT_SOFT_CLIP,
  OUTPUT_STAGE_DEFAULTS,
  OUTPUT_STAGE_MODES,
  OUTPUT_STAGE_REPORT_HZ,
} from './mixer/outputStageConstants';
export type { OutputStageMode, OutputStageReport } from './mixer/outputStageConstants';
export { outputStageLatency } from './mixer/outputStageDsp';
export { outputStageCurve } from './mixer/outputStageCurve';
export { DEFAULT_OUTPUT_STAGE, normaliseOutputStage } from './mixer/outputStageSpec';
export type { OutputStageSettings } from './mixer/outputStageSpec';

export { canSidechain } from './mixer/sidechainGraph';
export type { SidechainSource } from './inserts/sidechainSource';

export { DEFAULT_PHASER } from './inserts/phaserSpec';
export type { PhaserSpec } from './inserts/phaserSpec';
export { PHASER_BOUNDS } from './inserts/phaserConstants';
export { PHASER_PRESETS, applyPhaserPreset, matchingPhaserPreset } from './inserts/phaserPresets';
// The Parametric EQ (windsor#198; registered with its card, windsor#199; spectrum and Listen, windsor#200).
export { DEFAULT_EQ } from './inserts/eqSpec';
export type { EqSpec, EqBand } from './inserts/eqSpec';
export {
  EQ_BAND_TYPES,
  EQ_SLOPES,
  EQ_BOUNDS,
  EQ_DSP,
  EQ_LISTEN,
  EQ_SPECTRUM,
} from './inserts/eqConstants';
export type { EqBandType, EqSlope } from './inserts/eqConstants';
export { eqResponseDb } from './inserts/eqCoefficients';
export { EQ_INSERT } from './inserts/eqInsert';
export { DEFAULT_TAPE } from './inserts/tapeSpec';
export type { TapeCore, TapeSpec } from './inserts/tapeSpec';
export {
  TAPE_BOUNDS,
  TAPE_CORE_BOUNDS,
  TAPE_TYPES,
  TAPE_LABELS,
  TAPE_OVERSAMPLING,
} from './inserts/tapeConstants';
export type { TapeOversampling } from './inserts/tapeConstants';
export { driveGain } from './inserts/tapeMagneticConstants';
export { randomiseTape } from './inserts/tapeRandomise';
export {
  tapeControlValue,
  setTapeControl,
  tapeCoreOf,
  setTapeCore,
  clearTapeCore,
} from './inserts/tapeControls';
export type { TapeNumber } from './inserts/tapeControls';
export { TAPE_PRESETS } from './inserts/tapePresetTables';
export { applyTapePreset } from './inserts/tapePresets';

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

// The Plate reverb and Echo insert kinds (windsor#171).
export {
  DEFAULT_PLATE_REVERB,
  PLATE_REVERB_INSERT,
  PLATE_SPACE_FIELDS,
  plateSpace,
} from './inserts/plateReverbInsert';
export type { PlateReverbSpec } from './inserts/plateReverbInsert';
export {
  PLATE_REVERB_MIX_DEFAULT,
  PLATE_REVERB_SPACE_DEFAULT,
} from './inserts/plateReverbConstants';
export { DEFAULT_ECHO, ECHO_INSERT } from './inserts/echoInsert';
export type { EchoSpec } from './inserts/echoInsert';
export { ECHO_BOUNDS, ECHO_MIX_DEFAULT } from './inserts/echoConstants';

// Every insert's identity in its chain (windsor#186).
export {
  createInsertIdSource,
  freshInsertId,
  isInsertId,
  withInsertIds,
} from './inserts/insertIds';
export type { InsertIdSource } from './inserts/insertIds';
export type { InsertIdentity } from './inserts/insertRegistry';
