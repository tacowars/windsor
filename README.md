# Windsor

A browser-based sequencer and DAW built on a custom four-operator FM engine:

- **Synthesis:** FM, harmonic waveforms and subtractive filtering in
  AudioWorklets.
- **Sequencers:** Euclidean, grid, chord, arpeggiator, bass/drone and
  figure, driven by a harmony timeline, and a piano roll whose notes keep
  their pitch. Bounce to Roll turns a generated part into notes you can
  edit.
- **Mixer:** channel strips with up to eight inserts each (compressor,
  classic and advanced drive, tape, filter, parametric EQ, chorus, ensemble,
  phaser, dub delay, echo, plate and retro reverbs, and bloom, a harmonic
  pad generator), two send buses with their own insert chains, and a song
  master. Song automation lanes move the knobs over time.

Everything runs in the browser, and the app deploys as static files. Try it
at <https://tacowars.github.io/windsor/>. Chrome is the tested browser.

Windsor began as the audio engine for a web-based game I was building, but
I soon became more interested in the synthesizer and sequencer than in the
game itself, so I forked it and Windsor was born. The synth takes its
influences from some of my favourites, like the Korg opsix and Ableton
Live's Operator. The sequencer draws on many sources, but I want to call
out Plugin Boutique's Scaler and Elektron as general influences.

The plate reverb is based on the Dattorro algorithm, which is my favourite,
and I think it pairs well with the harmonically rich sounds the synth can
make. If you enjoy Windsor, let me know.

The name comes from Windsor, Ontario, where kids grew up listening to radio
broadcasts by the seminal techno artists from Detroit. Windsor can be used
to make any kind of electronic music, but the techno mentality is at the
heart of its design: step sequencing, polymeter, groove, acid and rhythm.

## Getting started

```bash
nvm use            # Node 24
npm ci
npm run dev        # http://localhost:5173
```

Click **Enable audio**, pick a sequencer for Part 1 and press ▶. Audition
with the QWERTY keys, the on-screen keyboard or a MIDI controller.

## Building and deploying

```bash
npm run build      # writes packages/app/dist/
npm run preview    # serves it locally
```

`packages/app/dist/` is a plain static site: HTML, the hashed app bundle and
one file per DSP worklet. Serve it from any static host over http(s); worklets
don't load from `file://`. The build uses a relative base, so it works under a
sub-path such as a GitHub Pages project site. Set `WINDSOR_BASE` to override
it.

CI (`.github/workflows/ci.yml`) runs `npm run verify` on every pull request
and every push to `main`. GitHub Pages serves the `gh-pages` branch:

- **Live:** a push to `main` that passes publishes the build to the branch
  root, <https://tacowars.github.io/windsor/>.
- **Previews:** a pull request from this repo that touches code publishes
  its build to `https://tacowars.github.io/windsor/pr-preview/pr-<N>/` and
  comments the link on the PR. Closing or merging removes it.

## Repository layout

- `packages/engine/`: `@windsor/engine`, the audio engine and its patch
  library.
- `packages/app/`: `@windsor/app`, the browser UI, plus the patch-library
  scripts.
- `scripts/`: the worklet bundler and the patch-library index.
- `docs/`: the design docs, decision records and research.

`npm run verify` is the gate every change passes. `CLAUDE.md` holds the
engineering rules.

## Licence

[GNU Affero General Public License v3.0](LICENSE).
