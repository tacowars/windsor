# A feedback compressor insert with a separate detector input

Ticket: #660. Pat requested implementation after a feasibility investigation,
with the final sonic verdict reserved for an audition against Cytomic The Glue.

1. `compressor` is a normal, song-owned part insert. Its fixed graph wraps a
   dedicated stereo AudioWorklet; parameter edits do not rebuild it. The existing
   master safety compressor remains independent. Bus/group insert locations are
   future routing work. Channel Level remains before inserts, so it changes
   compression drive, as it already does for Drive.
2. The DSP is an original behavioral approximation: a linked peak detector,
   soft-knee feedback gain law, implicit analytic envelope update, and independent
   fast/slow states for Auto release. It is not Cytomic's nonlinear dual-diode
   circuit model. Stereo uses the maximum rectified channel, not a signed sum.
   Range bounds control gain reduction, without modelling Cytomic's detector-rail
   saturation. No exact sonic equivalence is claimed before Pat's verdict.
3. Controls are threshold, makeup, stepped attack/ratio/release (zero means Auto),
   detector-only highpass, Range, linear dry/wet and smoothed bypass. Detector HP
   zero is off. No lookahead or oversampling is introduced, so dry and wet samples
   remain aligned. Clipping/oversampling can follow measured aliasing/listening
   needs. Neither compressor nor Range promises brickwall peak limiting.
4. Every compressor has a separate detector input and explicit runtime
   `setExternal` capability. The present UI only uses internal detection. A future
   mixer owns source routing, validation and connection lifetime; external silence
   stays silent and never falls back to program detection. Song settings do not
   yet pretend to carry a sidechain route.
5. `InsertStage` exposes optional worklet, detector and reduction capabilities.
   The engine decorates the insert registry to attach/detach load metering with
   each stage's lifetime, including live replacement. Meter messages use an event
   listener so load metering's existing `onmessage` handler can coexist. The editor
   reads the live stage and uses its existing frame loop; hidden/detached cards
   stop gain-reduction telemetry. The line shows peak wet-path gain reduction,
   zero when bypassed; its scale saturates at 24 dB, while the number retains the
   full reading. Neither Mix nor makeup changes that detector reading.
6. The processor is registered during `FmEngine.init`, before synchronous insert
   factories run. Its source bundles through the existing worklet build table and
   the same generated script is loaded by Vite, the standalone page and tests.
   New code lives outside the FM source folder being refactored concurrently.
7. Browser evidence is the standalone editor: the game-world evidence collector
   cannot express this file-based console scenario. The retained Playwright script
   records the controls, real worklet telemetry, export, screenshot and full console
   and request events. No world movement, rendering-backend stats or game screenshot
   would establish this criterion. The separate Web Audio reading is development
   evidence only; target-machine performance remains unmeasured.

References: [Cytomic's technical description](https://cytomic.com/product/glue/),
[The Glue manual](https://cytomic.com/files/TheGlue-Manual.pdf), and
[Web Audio compressor limitations](https://www.w3.org/TR/webaudio-1.1/#DynamicsCompressorNode).
