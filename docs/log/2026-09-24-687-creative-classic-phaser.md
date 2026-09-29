# Creative classic phaser insert

Ticket: #687. tacowars supplied Stone Phaser as the reference and requested a
more open effect for acid basslines and spacey pads, retaining classic phasing.

1. Ship an original four-stage stereo phaser, named **Phaser**, through the
   existing track/Master insert registry. TypeScript AudioWorklet, no native
   toolchain or external runtime dependency. No change to existing inserts,
   routing, patch schema or song version.
2. Preserve the classic dry/all-pass blend and filtered feedback. Use
   bilinear first-order all-pass coefficients and normalized lattice state:
   each time-varying stage is an orthogonal scattering operation. Smooth
   numeric controls over 30 ms; cosine LFO mapped in octaves, with continuous
   phase through edits and bypass. This is inspiration, not a measured
   hardware or Stone Phaser match.
3. Expose rate, center, depth, signed feedback, feedback bass cut, stereo
   phase offset, signed envelope amount, bass preservation and mix. The
   linked peak envelope has 8 ms attack / 180 ms release and reaches full
   modulation at input magnitude 0.25. Bass keep routes an adjustable amount
   of the 150 Hz one-pole low band around the phaser. Feedback is gently
   saturated to control resonant buildup; there is no final output limiter.
4. Mix is a linear dry/wet blend: 0.5 makes the deepest classic cancellation,
   1 is all-pass wet. Bypass fades to the original stereo input while history
   continues advancing. Presets preserve Mix and enabled, store actual
   settings in the song, and become Custom after edits.
5. Original starting points: Classic swirl, Deep color, Acid motion, Space
   pad, Hollow orbit. No hardware preset data, Faust source, plugin UI or
   branding is copied. Research/provenance and development-machine evidence
   are in `docs/research/2026-09-24-687-phaser/`.

tacowars's listening verdict is required before merge. Passing DSP tests does not
establish musical preference or hardware equivalence.
