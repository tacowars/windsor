# Song master evidence (#666)

2026-09-23, Apple M1, Darwin 25.5.0, Chrome 153.0.8010.53,
headless Web Audio / AudioWorklet. Development-machine UI observations;
no target-performance or sonic-equivalence claim.

Run `node docs/research/2026-09-23-666-song-master/collect.mjs` with Node 24.
The retained script opens this checkout's generated standalone `file://`
editor, imports a one-part Init song with room/echo sends, enables audio,
and adds a compressor to Master through its insert picker. It changes ratio
and threshold, plays a QWERTY note, and asserts stereo signal plus real
compressor gain reduction. It captures `editor.png`, turns the Master Level
fully down and asserts meter silence while the note is held, resets level,
and exports the edited song. The song is a test fixture, not a soundtrack.

The probe hides Mixer and checks that every old meter processor received
Stop, then returns and checks exactly one active meter delivers reports.
`browser.json` records the page SHA-256, parent commit (dirty checkout), live
AudioParams, actual sample-meter report, exported master, and node lifetime.
`console.json` has zero warnings/errors; `network.json` retains all completed
and failed request events. The screenshot is for tacowars; the assertions and
processor data establish behavior. No game-world collector is relevant to
this standalone console scenario (decision 6 in the ticket's record).

## Build size

`build-size.json`: clean detached baseline `8b1fa82a` versus the implementation,
Node 24.20.0/Vite production builds on this machine. Client index:
717,879 → 723,285 bytes (+5,406); Python gzip: 206,468 → 208,785 (+2,317).
Total emitted assets excluding maps: 21,615,136 → 21,620,542 (+5,406).
The small meter worklet is inlined into the client URL by Vite. Its processor
is instantiated only when the console's Master meter is visible.
