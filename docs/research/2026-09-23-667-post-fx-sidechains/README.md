# Post-FX sidechain verification — #667

`collect.mjs` drives the generated standalone editor in Chrome using the real
FM and compressor worklets. Run with Node 24 from this checkout. The machine,
browser, page hash and parent commit are recorded in `browser.json`.

The run selects track 0 on both the track-1 and master compressors, with
track 0 set to Sidechain only and its sends raised. With only that trigger
playing, both reduction meters respond while the master meter remains at
its -60 dB display floor. Adding program audio yields ducking; lowering the
trigger's Level releases both compressors without changing External mode.
Switching its output to Master exercises an audible source. Export and
re-import preserve both detector selections and Sidechain only output.
`editor.png` shows the controls; `console.json` and `network.json` are the
complete browser listings (zero warnings/errors).

The fixture uses sustained Init notes for repeatable measurements. These
are development-machine functional readings, not a target CPU benchmark or
a listening verdict. Unit tests additionally render through the actual
compressor DSP to check post-insert filtering, Level response, no detector
leak and preserved delay tails, and exercise cycles, renames, deletion,
slot reuse, repeated insert kinds, deferred reorder and disposal.
