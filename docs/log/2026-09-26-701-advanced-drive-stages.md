# Advanced Drive preserves Classic Drive and adds five stage routes

2026-09-26 · #701 · Pat's Roar-inspired drive request and explicit scope answers.

1. Ship a separate `advanced-drive` insert; keep `drive`'s native graph and
   existing settings unchanged. Label the latter Classic Drive in the editor.
   A transparent migration cannot be claimed for different nonlinear DSP.
2. Single, serial, parallel, three-band and mid/side are in scope. Feedback
   and delay routes are deferred, as are experimental shapers/filters. The
   existing compressor remains separate. Envelope follower plus one LFO
   modulates each stage's amount, bias and cutoff.
3. Store three independent stage objects in each song, retaining hidden
   stages through route changes. Clone nested defaults when adding inserts.
4. Use a stereo worklet with 2x FIR-filtered processing and LR4 crossovers.
   Compensate crossover phase in the low branch and dry reference. Active
   latency is 32 host samples; settled bypass is exact undelayed dry. No
   cross-track latency compensation is introduced.
5. Presets are original recipes, stored as settings, preserving mix/output/
   enabled. Curve displays use the engine functions. Refer to
   `docs/research/2026-09-26-701-drive/README.md` for semantics and audition.
