# Scoring library and tagged browser

Date: 2026-09-12. Issue #475. Requested by Pat following #440, #455 and #462.

1. Add 100 musical starting points, retaining existing IDs. Put the four
   legacy gameplay FX behind an explicit category, since the instrument is
   now used for music. The initial family allocation is 16 strings / 24 pads /
   20 plucks / 16 basses / 24 soundtrack FX, chosen within Pat's requested scope.
2. Keep metadata outside Patch and ArrangementDocument. Search uses names,
   IDs, tags and playing notes, with intersecting category/tag/source filters.
   Native results support keyboard use without a dependency or modal browser.
   Custom-tag editing and user-wave editing are later scope.
3. Loading a browser selection copies its full patch into the song before
   any knob edit. This strengthens the whole-song export contract: future
   factory tuning cannot change an exported selection. Document overrides
   still win; rename/revert retain their existing semantics.
4. Author a compact set of synthesis recipes and 100 explicit parameter
   rows. These are deliberately different timbres, not randomized factory
   variations. USER spectra have distinct stable cache keys. FX use the
   existing envelopes, LFOs and filter; no DSP feature or allocation changes.
5. Reserve chord headroom in sustained voices. The first real-DSP four-note
   test reached 1.03625 on Wire Harmonics at recipe volume 0.35; lower the
   sustained recipe to 0.25 and rerun. The new bank records a 256-seed short
   sweep plus full-envelope/register/chord tests; this is sampled evidence,
   not an exhaustive clipping bound. Preserve the older bank's larger sweep.

No paid calls, downloaded audio, simulation changes, or mixer changes.
The preset values are synth configuration, not imported media assets.
Playing notes and extension procedure: `docs/design/scoring-preset-library.md`.
