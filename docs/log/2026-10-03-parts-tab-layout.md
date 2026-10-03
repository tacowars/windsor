# The Parts tab's layout: top bars, operator rows and a modulation deck

- **Date:** 2026-10-03
- **Status:** accepted (tacowars, 2026-10-03), built: PRs #527, #531, #532,
  #539 and #541, all on 2026-10-03
- **Links:** the mockup `docs/research/2026-10-03-parts-page-layout/mockup.html`
  (layout B is the approved one; A and C are the alternatives it was
  chosen over) · the epic windsor#519 · the children windsor#520 (header
  and part strip), windsor#521 (part + patch bar and search popover),
  windsor#522 (full patch browser), windsor#523 (operator rows),
  windsor#524 (rail order and deck)

## Context

The Parts tab grew out of a four-part console. It now edits up to 16
parts, each with a four-operator patch, and its frame never changed.
It was three fixed columns, 230 px, flexible and 272 px.

- **The left rail** began with the part buttons, Add/Remove, the name, the
  sequencer picker, the preset list with three filters, and eight library
  buttons. That section alone was about 1,000 px tall, and it pushed
  Algorithm, Global and the scope below the fold on every screen.
- **The right column** stacked Drive, Filter, Filter Env, two LFOs and the
  Pitch Env at 272 px wide. It was about 2,200 px tall and set the page
  height: 2,362 px at 1440×800, and 2,326 px at 2560×1300.
- **The four operator cards** wrapped wherever 330 px fitted. At 2560 they
  sat in one short row with about 1,000 px of empty space under them.

tacowars uses the console on three screens: a 27" 4K (about 2560×1300 CSS
px in the browser, usually at 125% zoom in other apps), a 2020 MacBook Air
(1440×800) and a 12.9" iPad Pro (1366×960). Phones and smaller screens are
out of scope.

## Decision

1. **The tabs join the transport row.** The WINDSOR label goes, and the
   tabs take its place at the left of the first header row.
2. **A part strip is the second header row, on every tab.**
   - It has one chip per part, in the Song tab's order. Each chip shows the
     name, then `n · kind`, and an activity dot. The selected chip is
     filled in `--carrier`.
   - A pick selects the shared part (`ctx.parts.pick`).
   - **+** adds a part, and **−** removes the selected part with today's
     confirm.
   - The 16 chips fit with no scrolling on all three screens at 100%.
3. **When the parts don't fit, the strip overflows like browser tabs.** The
   chips stop shrinking at 70 px, and the row scrolls sideways (trackpad or
   shift + wheel). While it overflows it shows ‹ › buttons, faded edges and
   a ▾ list of every part, and the selected chip is kept in view.
4. **The part + patch bar** sits at the top of the Parts tab: the part's
   name and its sequencer as a select, then the patch with Save, Save as…
   (today's Copy to new), Init and a ⋯ menu. The menu holds Rename, Revert,
   Delete, the library folder actions and Patch JSON.
5. **Patches are found in three tiers.**
   - ◀ ▶ step through the filtered list.
   - A search popover holds the three filters and the results, with
     keyboard navigation.
   - ⤢ opens a full-pane browser with facets (source, category, tags),
     a results table, and an info pane that loads, saves as, renames and
     deletes.
6. **The operators are four rows** of the same knob cells.
   - Each row reads: the identity column (letter, badge, Adv, Wave,
     Ratio/Fixed), then Coarse to Vel, then Attack to Release, then the
     envelope.
   - Attack–Release sit before the envelope, so every knob column lines up
     across A–D whatever each row's Adv state.
   - The envelope takes the row's leftover width with no cap; on a big
     screen the extra length helps fine edits.
7. **Adv stays per operator.** Its group (the advanced envelope knobs, the
   loop picker, Start and Phase) sits to the right of the row when it
   fits, and on a line under the row when it doesn't. The flex wrap
   decides, with no breakpoint, and there is no Adv-all switch.
8. **The rail runs Output, Algorithm, Global.** The right column goes: its
   sections become a Shape & modulation deck under the operators, wrapping
   by width, in the order Filter + Filter Env, LFO, LFO 2, Pitch Env and
   Drive last.
9. **The new pieces are zoom-safe, ahead of a UI zoom.** An Ableton-style
   zoom is planned but is a later change. Until then:
   - layout follows the container's width (flex, `minmax`), not new
     screen-width media queries;
   - overflow is measured, not assumed;
   - canvases size from their box × `devicePixelRatio` and redraw when the
     box changes.

   The mockup's zoom switch shows the effect of the CSS `zoom` property
   the feature would likely use.
10. **The mockup draws three things that don't exist yet: they come later as
    their own tickets.** They are a part ⋯ menu (duplicate, move), ★
    favourite patches (a persistence change) and auditioning a patch from
    the browser before loading it. The children leave them out rather than
    show dead controls.
11. **Controls the mockup doesn't draw keep today's rules.** Fixed pitch,
    the Noise colour knobs and Start Locked's Phase show where today's card
    shows them, inside the row. The User wave's harmonic editor takes its
    own line under its row.

## As built

- **Knobs:** the operator rows keep today's knob, a 38 px dial, so a row is
  87 px tall against the mockup's 72 px. tacowars approved it as built
  (PR #531).
- **Chip lights, not yet built:** as merged, each chip has one activity
  dot that lights only on the Song tab. tacowars has chosen to replace it
  with the Song mixer's two lights on every chip, on every tab, fed by one
  engine node that meters every part: windsor#540, then windsor#528. The
  research measured that node at about 3.3 % of the audio budget at 16 parts
  (`docs/research/2026-10-03-always-on-part-meters/`).
- **Keyboard, in progress:** windsor#537 does the keyboard pass for the bar, the ⋯ menu,
  the popover and the browser, instead of more fix rounds on PR #532.
- **The patch browser's facet badges** show each facet's own count, whether
  or not it is selected.

## Consequences

- With the operator rows and the deck, the 4K screen shows the whole tab
  without scrolling. The Air and the iPad scroll once, for the lower deck
  cards, instead of scrolling two tall columns. The fold figures are read
  from the mockup, which prints each layout's content height. The children
  check them in the real tab.
- At 4K and 100% each envelope is about 1,000 px wide. That is intended
  (decision 6).
- At 125% on the Air, the transport row wraps onto a second line and the
  part strip overflows (decision 3). That combination isn't a target.
- The Song tab's lanes and the strip select the same part, so a pick on
  either tab shows on both.
- The algorithm diagrams in the mockup are approximate stand-ins; the build
  keeps today's algorithm tiles.
