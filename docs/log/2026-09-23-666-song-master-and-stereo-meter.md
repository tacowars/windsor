# A song master before the game Music volume

Ticket #666, following the folder move in #655 and compressor in #660.
tacowars approved the master as the whole song, including returns. Post-FX
sidechains and silent triggers follow in #667; no Pre-Level synth output.

1. The existing dry-only 30 Hz highpass stays before the sum. Its output and
   the song returns enter a new master input, then the existing insert chain,
   an edit-fade gain and the song's output level. That output feeds the existing
   game Music volume gain and engine safety output. Gameplay Babylon SFX and
   dry synth SFX routing are unchanged. The unused legacy `createSfxPart`
   API can still explicitly send into the shared song returns, as before;
   those shared returns now pass through song master effects like all returns.
2. `master` is an optional song section: level and inserts. An absent section
   means unity and no inserts, so old documents need no migration/version bump.
   The normaliser owns bounds/defaults; live edits retain other master fields.
   Master Level is after inserts, unlike the pre-insert Level on a track.
3. Master effects use the same registry, two-insert limit, load attachment,
   fade/reorder and disposal contracts as track effects. `InsertTarget` in the
   editor is a track slot or `master`; one set of cards edits either target.
4. The meter is a separate, silent AudioWorklet tap on the song output. It
   measures each stereo channel independently on every render quantum, reports
   sample peaks at 30 Hz, holds each channel's peak for one second, and latches
   overload at magnitude 1 until reset. It is neither true-peak nor LUFS and
   precedes game volume and the engine safety compressor. No mono analyser
   cancellation, no frame-sampled transient gaps. A muted destination keeps
   the tap rendering; it cannot add program audio to the audible graph.
5. The UI owns activation. Hiding/detaching the meter stops/closes its node and
   disconnects its edges; game playback creates no meter processor. The
   existing editor frame loop reads the latest report, never rebuilds the
   audio graph per frame, and a late message from a disposed node is ignored.
   Metering doesn't alter the compressor DSP or master samples.
6. Evidence is the standalone file editor, using the retained Chrome probe in
   `docs/research/2026-09-23-666-song-master/`. A game-world movement collector
   cannot establish the Master UI criteria. Graph/sample tests cover sums,
   level, SFX separation and disposal; the real generated worklet tests cover
   stereo transients, silence, overload/reset and shutdown at 44.1/48/96 kHz.
   Browser observations identify the development machine/backend; no target
   performance claim or listening-equivalence claim is made.
