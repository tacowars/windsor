# MIDI CC mapping: a controller's knobs move a part's parameters as a performance

- **Date:** 2026-10-13
- **Status:** proposed, accepted when tacowars approves the mockup
- **Links:** this record's issue, windsor#778 · the mockup,
  `docs/research/2026-10-13-midi-cc-mapping-mockup/mockup.html` · song lanes
  `2026-10-01-song-automation-lanes` · macros `2026-10-04-patch-macro-knobs` ·
  clip envelopes `2026-10-11-clip-envelope-slots-are-relative` · the house
  style and the sibling MIDI record `2026-10-09-roll-recording` · format rules
  in `2026-09-28-format-versions-refuse-never-destroy`

## Context

tacowars plays the console from a MIDI controller. Its keys reach the
selected part through `MidiPerformer`. Its knobs and faders do nothing: the
decoder (`packages/app/src/midiMessage.ts`) keeps CC 1 (the mod wheel) and
CC 64 (sustain) and drops every other controller. A DAW's MIDI learn maps a
controller's knob to a soft synth's parameter, and this record does the same
for Windsor: a knob on the controller moves one parameter of one part.

A CC move is a **performance**. It changes the sound live, held notes
included, and is never written into the patch, the song or the undo history.
Close and reopen the song, and it starts from the same sound. What is saved
is the mapping itself (which knob moves which parameter, over what range).

What the engine and the console had, read from the code on 2026-10-13:

- **A catalog of targets** (`automation/automationTargets.ts` and its
  tables): the part's strip (Level, Pan, Send A, Send B), each insert's
  fields by stable insert id, 42 voice rows (`worklet/fm/voiceTargetTables.ts`,
  the last 8 the macros) and the sequencer rows. Song lanes, step lanes,
  clip envelopes and the Parts tab's knobs all read it.
- **Eight voice slots per part** (`FM_LANES_MAX`). A slot is a k-rate
  parameter the worklet maps to one voice row. `AudioPart.takeVoiceSlot`
  hands out the first free one. A part keeps one handle per voice target
  (`synth/voiceAutomation.ts`), so a lane and a clip envelope on the same
  target write the same slot.
- **Offsets, never patch messages.** A song lane is absolute. The main thread
  turns its value into an offset against the patch (`voiceOffset`): the
  difference on an `add` row, octaves (`log2(value / patch)`) on a `ratio`
  row, each end raised to the row's floor. A clip envelope's value `v` in
  −1..1 is the offset `v × span` in the row's own curve, added to the lane's
  offset where both play (`clipEnvelopeTracks.ts`). The worklet plays
  `patch + offset` or `max(patch, floor) × 2^offset`, clamps to the row,
  then adds a step's push in the same curve and clamps again
  (`bindLiveValues`, `worklet/fm/voiceOffsets.ts`). Macro bases resolve after
  that (`applyMacroBases`).
- **Strip and insert targets have no offset.** A lane writes their
  AudioParams through the strip's `knobHandle` or the insert stage's
  `param(field)`. While a lane holds a strip knob, the knob only records its
  value.
- **An ENV ring.** A knob a clip envelope moves keeps its pin on the patch's
  value and draws a second ring outside the track, from that value to the one
  playing, with a dot on it and an ENV tag (`knob.ts`, `knobEnvelope.ts`,
  `console.css` "the env ring").
- **MIDI input.** `midiInputs.ts` lets the keyboard bar's selector listen to
  every input or one device by name. Every channel is accepted.

## Decisions

The decisions were agreed with tacowars on 2026-10-12 and 2026-10-13. The
mockup draws the parts that show. Where the brief's wording and the code
differ, the difference is stated under the decision.

1. **A mapping binds a source to one part's target.**
   - The source is a device (a name, or Any), a channel (1–16, or Any) and a
     CC number.
   - The device is matched by name, as the input selector matches it
     (`listensTo` in `midiInputs.ts`), because Web MIDI ids are not promised
     stable across sessions. So two connected inputs with the same name are
     one source to a mapping: a row cannot tell them apart, and only a
     different channel separates them.
   - The target is one row of the automation catalog, named by the lane
     target id it already has: the part's strip (`strip.level`), an
     insert's continuous field by stable insert id
     (`insert.<id>.<field>`), a voice target (`voice.ops.0.level`) or a
     macro (`voice.macros.1.value`). Switch rows (an insert's On,
     `2026-10-06-insert-switch-lanes`), stepped and enum fields and the
     sequencer's `seq.` rows are not offered.
   - The part, not the channel, keeps the parts apart. Most controllers send
     everything on channel 1, and the console takes every channel today. A
     mapping names its part and keeps driving that part whichever part is
     selected. With a mapping on part A, selecting part B (which then
     receives the keys) leaves the CC moving A, and it never moves B.
   - A new mapping's device and channel default to Any. The panel shows what
     learn heard, and a row can narrow either.
2. **Performance, not an edit.**
   - A CC never changes the patch, the song or the undo history. Its value
     lives only in the console while the song is open. Reloading or
     reopening the song starts from the patch's own values.
   - The on-screen knob keeps its position. A ring shows the live value, as
     the Roll's clip envelopes do today: the ENV ring's geometry and
     behaviour, with a `CC 74` tag in the tag slot instead of `ENV`.
   - The ring shows what plays: the CC's value with any clip envelope
     playing over it (decision 3). The panel's live value shows the CC's own
     value.
3. **The value path.** The CC value sets the target's performance base, in
   the target's own units, through the mapping's range and invert
   (decision 5).
   - **Voice targets and macros.** The base reaches the voice the way a
     clip envelope does: as an offset from the patch's value on one of the
     part's voice slots, through the target's handle, so held notes change.
     The offset is reckoned as a lane's is, by `voiceOffset` against the
     patch at the moment of the move, so its floors are a lane's: a CC
     that sets a decay time to 0 plays 1 ms, as a lane at 0 does and as a
     macro at its bottom does (`2026-10-04-patch-macro-knobs` decision 4).
     For the same reason, a slot that a CC alone writes is absolute
     (floored), not `relative`.
   - **Strip and insert targets.** The base is written to the target's
     AudioParams directly, through the same params a lane writes. These
     targets have no offset and take no slot.
   - **Precedence on one target**, checked against the engine's order:
     - A **song lane that is on** wins, and the CC is ignored. An automated
       knob is locked today (`2026-10-01-song-automation-lanes` decision 6).
       The lane holds the slot as an absolute value and writes it every
       tick. The mapping's row in the panel says **Automated**. A lane that
       is off locks nothing, and the CC plays.
     - A **clip envelope** is relative. It applies on top of the CC's base,
       as it applies on top of the patch's value today: the slot carries the
       CC's offset plus the envelope's. `ClipEnvelopeTracks` adds the
       lane's offset there today. It adds the CC's where no lane plays.
     - A **step-mod push** stacks on top, as today. The worklet adds it over
       the slot's clamped value, in the row's curve, and clamps again.
   - **The formula.** Let `x = cc / 127`, inverted `x = 1 − cc / 127`.
     - A **ratio row**, the cutoff:
       - the CC's value is `min × (max / min)^x`;
       - its offset is `c = log2(value / max(patch, floor))`;
       - the slot carries `c + e`, where `e` is the envelope's offset
         (`v × span`, in octaves);
       - the voice plays `clamp(max(patch, floor) × 2^(c + e))`, and then the
         step push, `× 2^(push × span)`, clamped again.
     - A **linear row**, an operator level:
       - the CC's value is `min + x × (max − min)`;
       - its offset is `c = value − patch`;
       - the voice plays `clamp(patch + c + e)`, then `+ push × span`, clamped
         again.

     **Worked example, the cutoff** (row `filter.cutoff`: `ratio`, 30 Hz to
     18 kHz, floor 0, span 4.5 octaves). The patch's cutoff is 1 kHz. The
     mapping's range is 2–6 kHz. A clip envelope plays +1 octave, which is
     `v = 1 / 4.5 ≈ 0.222`. The CC reads 64.
     - `x = 64 / 127 = 0.50394`.
     - The CC's value is `2000 × 3^0.50394 = 3479.1 Hz`. The panel shows
       3.48 kHz.
     - Its offset is `log2(3479.1 / 1000) = 1.7987` octaves.
     - The slot carries `1.7987 + 1 = 2.7987` octaves.
     - The voice plays `1000 × 2^2.7987 = 6958.2 Hz`. That is inside the row
       (30 Hz–18 kHz), so it is not clamped, and the ring's dot sits at
       6.96 kHz.
     - The mapping's range bounds the CC's base, not the sum. The envelope
       takes the sound past the mapping's 6 kHz top, as an envelope over a
       lane can take it past the lane's value. Only the row's own range
       clamps the sum.
     - At CC 0 the value is 2 kHz (offset 1 octave). At CC 127 it is 6 kHz
       (offset `log2 6 = 2.585` octaves).

     **Worked example, an operator level, inverted** (row `ops.0.level`:
     `add`, 0 to 1, span 0.5). The patch's level is 0.80. The mapping has the
     full range, 0–1, inverted.
     - At **CC 0**, `x = 1`. The value is 1.00, the offset is `+0.20`, and the
       voice plays `0.80 + 0.20 = 1.00`. A step push on top is clamped
       to 1.00.
     - At **CC 127**, `x = 0`. The value is 0.00, the offset is `−0.80`, and
       the voice plays 0.00.
   - **Not dB.** The operator level row is linear, with no unit
     (`OPERATOR_LOOKS.level` is `linear`). The decibel scale belongs to the
     strip's **Level** (`strip.level`, scale `db`, −60 dB floor to +6.02 dB).
     So "dB for a level" in decision 5 is true of the strip's Level, and an
     operator level spreads linearly.
4. **Storing CC state as a relative offset is deliberate.** A voice target's
   CC state is the offset of decision 3, in the row's own curve. A later
   ticket records CC moves into the Roll as clip envelope points, which are
   relative too, so the recording is a copy. That ticket is not part of this
   work.
   - **What the code says.** An envelope point is `v` in −1..1 times the
     row's span, so it reaches only ±span. A CC's offset can reach the
     row's whole travel. For the cutoff over a 1 kHz patch, that is −5.06 to
     +4.17 octaves against a span of ±4.5. For the level of decision 3's
     example, that is −0.80 against a span of ±0.5. The recording is a
     copy only inside ±span. The recording ticket has to clip, or widen the
     envelope's scale, and its record must say which.
5. **Range and invert per mapping.**
   - Each mapping carries `min` and `max` in the target's own units, and
     `inverted`. These are the same fields a macro mapping has
     (`2026-10-04-patch-macro-knobs` decision 2).
   - CC 0–127 spreads across min..max in the knob's own scale, as a lane is
     drawn (`automationDisplay.ts`): geometrically on a `log`, `octaves` or
     `db` row (octaves for the cutoff, dB for the strip's Level), and
     linearly on a `linear` row (an operator level, a send, a macro).
   - A decay time's knob ends on exact 0, and its row is a log row from 0
     with a 1 ms display floor. A mapping whose `min` is that 0 sweeps
     geometrically from 1 ms, and its CC 0 is the knob's 0, which plays
     1 ms (decision 3).
   - A new mapping's range is the target's full range. There is no curve in
     v1.
6. **Macros are targets.**
   - A CC on a macro sets the macro's value: an offset on the macro's row
     (`add`, 0..1). The patch's macro then fans the value out to its mapped
     targets, through `applyMacroBases`, after the slots and the pushes have
     resolved.
   - A CC on a macro takes one slot, however many targets the macro moves.
   - A target that one of the patch's macros maps is not offered, as the
     lane picker does not offer it (`offersVoicePath` in `macroTargets.ts`).
     The voice has no handle on that target (`voiceAutomationHandle` returns
     none), so a CC there could not move it.
7. **Takeover.**
   - **Pickup** is the default. After a song opens, a preset changes, or a
     range changes, a CC does nothing until it picks up. It picks up when
     its value reaches or crosses the target's current value. The current
     value is the CC's base where one is held, else the patch's (or the
     strip's or insert's) own value. A clip envelope's offset is not part of
     it.
   - A **Jump** toggle in the panel's header applies each value at once.
   - Takeover is a console preference, held in `localStorage` (wrapped in
     try/catch, with Pickup when storage is empty or fails). It is not song
     data.
   - Until a mapping picks up, the ring shows the hardware position as a
     hollow marker. A mapping that has heard no value since the song opened
     shows no marker: the hardware position is not known.
8. **The slot budget.**
   - **What the code does today.**
     - Lanes take their slots first. They hold them from the player's load
       or a lane edit (`AutomationPlayer.setLanes`, `resolveOwner`). The song
       normaliser keeps at most 8 voice lanes per part
       (`automationNormalise.ts`).
     - Clip envelopes come after the lanes. At an envelope's first tick,
       `admittedEnvelopes` counts one slot per voice lane and one per held
       envelope target that no lane holds. It then admits envelopes in the
       roll's order while a slot is free. An envelope on a lane's target
       shares that lane's slot. One that finds no slot is skipped and asked
       again next tick.
     - At a resync, `ClipEnvelopeTracks.refresh` gives the slots the lanes
       leave to the envelopes in the roll's order.
     - The pickers keep a part inside 8 slots by construction. Both read
       one count (`partVoiceSlots.ts`): the distinct voice targets across
       the part's lanes and every roll pattern's envelopes. The Song tab's
       picker shows it as "Voice n/8".
   - **The CC's place.** A CC mapping on a voice target or a macro takes one
     slot. Strip and insert mappings take none. A mapping counts against
     the 8 **when it is made**: its target joins the `partVoiceSlots` union,
     so the panel's picker shows the count (for example "Voice 5/8") and
     both existing pickers count it too. A target already in the union
     shares its slot. That covers a lane's target, an envelope's, or one
     already mapped.
   - **When the engine takes it.** The slot is taken at the mapping's first
     applied value, after pickup or at once under Jump. The CC holds it until
     Reset performance, the mapping's removal, a preset change or the song's
     close. A mapping that has applied no value writes nothing, so a song
     with mappings and no CC moves plays bit for bit as it does without them.
   - **Order:** lanes, then CC mappings holding a value, then clip
     envelopes in the roll's order. A lane is the song's and plays the same
     on every pass. A CC is what the performer is touching now, and it must
     not fail silently while an envelope plays. An envelope is asked again
     every tick, so it already degrades gracefully. `slotsInUse` and
     `refresh` therefore count the CC's held targets after the lanes'.
   - **When the 8 slots are full.**
     - In the panel's picker and in a knob's "Learn MIDI CC…", a voice
       target or macro outside the union is disabled once the union holds 8.
       Its picker head reads "Voice 8/8" in the hot colour, and the knob's
       menu item reads "Voice slots full (8/8)". Targets already in the union
       stay open.
     - In the engine, the cap can be passed only by a document built
       outside the pickers: one edited by hand, or one where a preset change
       re-opened targets. There, a CC that finds no free slot does nothing.
       Its row reads **No voice slot** until a slot frees, and nothing
       throws.
9. **Saved in the song, as setup.**
   - The mappings are saved on their part, beside its `automation`, as
     `DocumentPart.ccMappings`. Each holds its source (device name or null
     for Any, channel or null for Any, CC), its target id, `min`, `max` and
     `inverted`.
   - The CC values are never saved.
   - The normaliser drops a mapping whose target the catalog does not hold,
     or whose CC is on the ignored list (decision 11). It clamps `min` and
     `max` to the target's row. It keeps the first mapping on a target and
     reports the rest. It keeps mappings past the voice cap, which decision
     8 orders.
   - The format is additive: a song without `ccMappings` plays exactly as
     before, so `ARRANGEMENT_VERSION` is not bumped
     (`2026-09-28-format-versions-refuse-never-destroy`).
10. **Lifecycle.**
    - Deleting a part or an insert deletes its mappings, and undo brings
      them back, as with lanes (`2026-10-01-song-automation-lanes` decision
      14).
    - Swapping a part's preset keeps its voice mappings, each range clamped
      to the target's range.
      - A macro mapping whose macro the new patch does not define stays,
        inert, and its row says so ("Inert · no Macro 2 in this patch").
      - So does a mapping whose target the new patch's macros now map
        ("Inert · mapped by Accent").
      - Both play again when the patch allows.
    - Duplicating a part does not copy its mappings, so one knob never moves
      two parts by accident.
    - Adding, removing and editing a mapping are song edits, with one undo
      step each. A CC move is never an undo step.
    - One CC may drive several targets. A target has at most one mapping:
      learning a mapped target again replaces its source.
11. **Learn.**
    - Learn takes the first CC whose value moves by at least 3 steps from
      the first value heard for it, so a controller's value dump on connect,
      or a resting knob, does not map.
    - It ignores these CCs, which keep their jobs or are not knobs:
      - CC 1 (mod wheel) and CC 64 (sustain);
      - bank select (0, 32);
      - data entry and RPN/NRPN (6, 38, 96–101);
      - the channel mode messages (120–127).
    - While listening, the panel shows "Move a knob on your controller…"
      with Cancel. Once a CC moves far enough, it shows "Heard CC 74 · ch 1 ·
      <device>" and commits. Escape or Cancel leaves nothing behind.
    - Learn listens to the inputs the MIDI selector listens to
      (`listensTo` in `midiInputs.ts`). So do the mappings while they play,
      as the keys do. If MIDI is not enabled, the panel offers the keyboard
      bar's Enable MIDI button.
    - Two constants join `midiConstants.ts`: `CC_LEARN_MIN_MOVE = 3`, and
      `CC_LEARN_IGNORED`, the list above, beside the existing
      `CC_MOD_WHEEL` and `CC_SUSTAIN`. `decodeMidi` gains a `cc` event for
      every other controller.
12. **Two ways in.**
    - **The panel.**
      - A **MIDI CC** button sits on the Parts tab's part bar, next to the
        sequencer picker. It shows the selected part's mapping count.
      - It opens a panel of mappings with the columns Part, Parameter,
        Source (device · ch · CC), Range (min–max with units), Inv, Live
        value or status, Learn and Delete. Learn remaps the source.
      - The statuses are **Waiting for pickup**, **Automated**, **Inert**
        and, past the cap, **No voice slot**.
      - A filter switches between **This part** (the default) and **All
        parts**.
      - **+ Add mapping** opens the lane picker's target list, then goes
        straight into learn. The list is grouped Mixer, Inserts, Voice and
        Macros, with the voice count against 8.
      - The header holds **Pickup | Jump** and **Reset performance**. Reset
        drops every CC value, returns each target to its patch (or strip, or
        insert) value, gives back the CCs' slots, and re-arms pickup.
    - **Right-click on a knob whose target is in the catalog**, on any tab:
      - **Learn MIDI CC…** starts learn for this target, with the knob
        highlighted while listening.
      - On a mapped knob, the menu also has **Edit mapping…**, which opens
        the panel at its row, and **Remove CC 74**.
      - A mapped knob shows a small `CC 74` tag under its value.
      - A knob outside the catalog (Coarse, Detune, Vel) keeps the
        browser's own menu.
      - A knob a macro maps is locked today, with the macro's name as its
        tag. Its menu offers "Learn MIDI CC…" disabled, with the reason.
13. **Out of scope.** These are listed under Later.

## Boundary cases

The issue asked for these. Each answer is recommended here and drawn where
it shows.

- **`min` equal to `max`.** Allowed. Every CC value maps to that one value,
  so the mapping is a "set to" knob. The range has nothing to cross, so
  pickup does not apply: the first move applies the value, and later moves
  re-apply it. The Range cell shows the one value.
- **A part deleted while learn listens.** Learn is cancelled, as Cancel
  cancels it, and nothing is written. The panel drops the part's rows.
  Undoing the delete brings back the part's saved mappings, not the
  learn.
- **A device unplugged mid-gesture.** The last value holds, and the sound
  does not jump back. The mapping stays. A row that names the device shows
  it as "(disconnected)", as the selector does. When the device returns,
  its mappings re-arm pickup, since the knob may have moved meanwhile. Under
  Jump, the next value applies.
- **Two inputs sending the same CC.** With the selector on All inputs, a
  mapping whose device is Any hears both. Pickup is tracked per device name,
  so a second controller with another name, its knob at another position,
  must pick up on its own before it moves the target. Under Jump, the last
  value wins. Narrowing the row's device to one name stops an input with
  another name. Two inputs that share a name are one source (decision 1):
  narrowing cannot stop either, they share one pickup state, and only
  setting them to different channels and narrowing the row's channel
  separates them.
- **Pickup on a target outside the mapping's range.** The current value is
  clamped into the range first. A 1 kHz cutoff under a 2–6 kHz mapping picks
  up when the CC reaches CC 0 (2 kHz), and the cutoff steps up an octave
  there. That step is the range's own bottom, and it cannot be avoided
  without a value the range excludes. Inverted, the same mapping picks up at
  CC 127.
- **An on-screen edit of a mapped target** (recommended; the brief did not
  say). Turning the knob, or a preset change, drops that target's CC value
  and re-arms pickup. The knob and the patch agree again, and the hardware
  must pick up from there. This is the same for all three kinds of target,
  including strip and insert ones, which have no offset to keep.
- **A lane switched off under a mapping.** The lane's release gives the
  slot back at the patch's value. The mapping re-arms pickup.

## The mockup

The mockup is today's Parts tab, captured from the dev build in the
project's headless Chrome on 2026-10-13 at a 1440 px window. The song has
one part, Acid (Acid Saw, a Grid sequencer, three macros, a Dub delay
insert, lanes on the delay's Feedback and on LFO 1 Amt). The capture shows
the part bar around the sequencer picker and operator A's row of knobs, with
their markup and styles taken from that build. It proposes:

- the **MIDI CC** button after the sequencer picker, with the part's
  mapping count;
- the **panel**, as a popover under the button, in This part and All parts,
  with the six rows the issue lists;
- the **add flow**: the target picker, listening, then "Heard CC 74 · ch 1";
- **Pickup | Jump** and **Reset performance** in the panel's header;
- the **right-click menu** on an unmapped knob (Width) and a mapped one
  (Level);
- operator A's **Level** knob mapped to CC 71: at rest (the tag only), moved
  (the ring at the live value, the pin unmoved), waiting for pickup (the
  hollow marker), and highlighted while learning;
- the panel with **MIDI not enabled**.

Two questions are left open in the mockup's notes, each with a
recommendation: whether the panel is a popover or a docked pane, and where on
the knob the CC tag sits.

## Consequences

- The build tickets, written once the mockup is approved, cover:
  - the decoder's `cc` event and learn;
  - the console's performance state (values, pickup, the slot's handle);
  - the clip envelope tracks' sum with a CC's offset;
  - the schema field and its normaliser;
  - the panel, the knob tag and ring, and the right-click menu.
  The build tickets that touch the schema and the controls are `reviewed`.
- `partVoiceSlots.ts` becomes the count of lanes, envelopes and CC mappings.
  The Song tab's lane picker and the Roll's envelope picker then count the
  mappings without further change.
- The engine's admission order gains the CC between the lanes and the
  envelopes (decision 8). A song with no mappings, or with mappings and no
  CC moves, takes no slot it did not take before, and the goldens do not
  move.

## Later

- Recording CC moves into the Roll as clip envelope points (decision 4),
  with its answer to the span limit.
- Mappings that follow the selected part.
- Relative (endless) encoders, and 14-bit CC or NRPN.
- MIDI out (LED rings), program change to switch parts, and per-part receive
  channels.
- A response curve per mapping.
- A **modulation matrix**: a separate epic that generalises macro mappings
  into rows whose source is an LFO, an envelope, velocity, key, the mod
  wheel, aftertouch or a macro. A CC mapping's fields match a macro
  mapping's, so a matrix row can absorb it later. The matrix is not a
  prerequisite. It is per voice, inside the patch and the worklet, and it is
  saved with the sound. This record is per part, on the main thread, and a
  performance that is never saved.
