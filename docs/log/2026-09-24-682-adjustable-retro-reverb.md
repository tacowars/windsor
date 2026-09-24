# An adjustable ROM-free retro reverb insert

For #682, Pat chose a freely adjustable MIDIVerb-inspired reverb rather than
BarrVerb or hardware equivalence, with ordinary, gated and reverse-style
presets approximating the original range. Factory ROM redistribution permission
is unknown; Pat authorized local inspection of the supplied U51/U54 firmware
to understand it, while keeping firmware out of shipped assets.

Implement an original TypeScript AudioWorklet and expose it through the shared
track/master insert registry. The reference emulator is small enough that
WASM is an option rather than a prerequisite. The selected adjustable network
does not execute or compile factory microcode. Gate/reverse use finite reflection
envelopes, separate from the ordinary decaying field.

Keep preset selection as a write of sound parameters, preserving Mix and bypass.
Songs store the resulting values and need no external preset bank to reproduce
their settings. There are 63 approximation entries; bypass covers Defeat.
Do not label them measured matches: initial values follow public program
descriptions, and Pat's listening verdict remains pending.

CPU claims must name the measured backend and machine. Retain the development
measurements, implementation options, firmware identification, validation and
audition steps in [the research record](../research/2026-09-24-682-retro-reverb/README.md).
No target-machine or WASM-speedup claim was established.
