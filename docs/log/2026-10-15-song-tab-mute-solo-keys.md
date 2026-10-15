# M and S mute and solo the selected part on the Song tab

- **Date:** 2026-10-15
- **Status:** accepted (tacowars, 2026-10-15, windsor#810)
- **Links:** windsor#810 · the mixer column record
  `2026-09-30-mixer-on-the-song-tab` · the region keys record
  `2026-10-06-song-region-move-copy-paste` · windsor#349 decision 6 and
  windsor#708 decision 6 (retired here)

## Context

tacowars toggles a part's mute and solo far more often than switching
automation tools. The mixer column's M and S buttons are small targets in
the frozen column, and while the Roll is expanded they are under the
overlay. Meanwhile E, D and S picked the Song lanes' automation tools
(windsor#349 decision 6), and the Roll's Envelopes tab took the same keys in
the capture phase (windsor#708 decision 6), so S already meant Shape in two
places.

## Decision

1. **M toggles the selected part's mute, S its solo**, wherever the Song
   tab shows: the lanes, the detail pane with any sequencer card, the Roll
   (Expand included) and its Envelopes tab. Each press goes through
   `toggleStripSwitch`, the write the mixer column's buttons make, so it is
   one undo step named "Mute <part>" or "Solo <part>". There is no second
   write path.
2. **The target is the selected part**, with or without a region. With a
   chord event or nothing selected the key does nothing and goes on to the
   page.
3. **A plain press only.** Cmd, Ctrl or Alt means the key is someone
   else's; the match ignores case, so Shift or Caps Lock still counts. A
   held key acts once and its repeats are swallowed. Nothing happens while
   a field or a dialog has focus, or while the Song tab is hidden, so the
   Parts tab's audition keyboard still plays S.
4. **A sidechain-only part** refuses an off switch, as its disabled
   button does: the key is swallowed and an `info` toast reads
   `<part> only feeds a sidechain: it has no output to mute` (or `solo`),
   the button's title. A lit switch on such a part still turns off.
5. **The column shows the change at once**, collapsed or expanded, and
   the enabled buttons' titles name the key: `Mute <part> (M)`,
   `Solo <part> (S)`.
6. **The automation tool keys are retired.** E, D and S pick no tool on
   the Song tab or on the Roll's Envelopes tab; the tools are picked by
   their buttons, whose titles carry no key. This supersedes windsor#349
   decision 6 and windsor#708 decision 6.

## Consequences

- The rule is pure (`songStripKeys.ts`'s `stripKeyAction` and
  `pressStripKey`) and tested; the listener sits on `document` beside the
  region keys, so it runs before the window's listeners.
- `rollEnvelopeKeys.ts`, `toolForKey`, `wireToolKeys` and the tool table's
  `key` field are gone.
