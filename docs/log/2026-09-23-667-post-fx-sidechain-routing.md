# Post-FX sidechains and silent trigger tracks

Ticket: #667. Builds on #666 / PR #668. Pat chose post-FX only after
confirming a Sidechain only output; there is no Pre-Level tap.

- Compressor `sidechain` defaults to Internal; `{ track: slot }` selects a
  post-Level, post-low-cut, post-insert, pre-pan stereo signal. `{ track:
  null }` explicitly selects external silence. No detector signal is mixed
  into program audio. Track and master insert cards use the same selector.
- `strip.output` defaults to Master. Sidechain only adds an audible gate
  after the stable post-FX tap and before both rotation and sends. A short
  fade uses the existing insert fade constant. The instrument/effects and
  sidechain keep running, and shared returns keep their tails.
- Names are labels; references use slots. Deletion normalises every affected
  reference to disconnected external. A later track on that slot requires a
  new explicit selection. This state survives export and re-import.
- Self and cyclic post-FX dependencies are forbidden even with a compressor
  bypassed or a track silent. The shared graph rule disables selector
  choices, reports and disconnects bad imported references, and rejects a
  cyclic live transaction before touching tempo, patches or routing.
- Detector edges belong to the mixer. Desired routing is checked before
  live mutation; actual applied insert specs drive wiring after each
  settings change or deferred structural edit. During a transition, an old
  source reference that disagrees with the desired slot remains disconnected
  external. A temporarily cyclic intermediate graph is not connected.
- Routing runs on edits, not the render loop. The compressor DSP and FM
  worklet are unchanged; each strip gains one native audible-output gain.
  No CPU/frame-time claim follows from this structural description.

Evidence: `docs/research/2026-09-23-667-post-fx-sidechains/` and the real-DSP
routing tests. Listening remains available to Pat in the standalone editor;
this change makes no new Glue-equivalence claim.
