# Stereo and dub delay insert

Ticket: #698. tacowars requested an Echo-inspired delay workflow for trance and
dub: independent synced delays, stereo/ping-pong/mid-side routing, HP/LP
filtering, dry/wet and output gain. Reverb is explicitly out of scope.

1. Add **Dub delay** (`kind: delay`) to the existing track/Master registry.
   This is original TypeScript DSP, not an Ableton emulation or source port.
   No dependency, patch migration or song-version change is needed.
2. Each lane independently selects sync or milliseconds. Sync offers
   straight/dotted/triplet divisions from 1/32 through 1/2 and a whole note.
   Free time is 1–8000 ms; sync saturates at 12 seconds at very slow imported
   tempos. Song tempo is runtime context, never duplicated into insert
   settings. `tempoInsertRegistry` initializes new stages and updates live
   stages, including stages created by a deferred chain edit. Rejected song
   edits do not change the delay's tempo.
3. Stereo keeps lanes separate. Ping pong sums stereo excitation at half
   gain into the left lane, then cross-feeds the two lanes; each echo waits
   for the receiving lane's time. Mid/Side encodes `(L+R)/2`, `(L-R)/2`,
   delays them independently, then decodes to stereo. Mono input has no Side.
4. Two HP poles followed by two LP poles filter each read inside the loop.
   They also color the first repeat. The filters are independently adjustable;
   crossing their cutoffs deliberately narrows/attenuates the band. Feedback
   reaches 120%; a tanh write stage bounds regeneration. Drive lowers its
   saturation threshold with compensated gain, allowing clean quiet repeats
   at zero drive and stronger compression/color at higher settings.
5. Linear dry/wet precedes output gain. Bypass fades to unity dry and stops
   exciting the loop while its history continues. Other controls smooth over
   30 ms; times glide over 60 ms and bend pitch. Mode changes blend routing
   using the same history. Removing an insert follows existing chain disposal
   semantics and cuts its tail. There is no separate freeze or modulation LFO.
6. Two fixed delay buffers and filter state are allocated at construction;
   the render path allocates nothing. All worklet consumers load the same
   generated processor. Existing load telemetry counts each instance for its
   lifetime. No CPU or target-machine performance claim is made.
7. Four original starting points write settings and preserve dry/wet, output
   gain and enabled: Stereo trance, Dotted ping pong, Long dub, Mid / side
   space. Settings, not preset identifiers, are saved into the song.

Reference: [Ableton's Echo manual](https://www.ableton.com/en/manual/live-audio-effect-reference/#echo)
for the requested workflow only. No plugin code, measured response, graphics
or factory preset data was used. Verification and audition instructions:
`docs/research/2026-09-25-698-delay/README.md`.
