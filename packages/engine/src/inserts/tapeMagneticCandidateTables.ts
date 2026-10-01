/**
 * The magnetic core's allowed control points (windsor#276): the rows a tape
 * model may carry, and the only rows the developer picker may audition.
 *
 * Provenance: the control points that windsor#204's dynamic-survival record
 * sampled (`docs/research/2026-09-30-tape-dynamic-survival/`, README
 * "Control schedule" and `program.ts`'s `controlSchedule`): the eight corners
 * of the [0, 1]³ cube, the centre 0.5 / 0.5 / 0.5, and the twenty interior
 * points of its edits schedule, drawn from `mulberry32` with seed 204, one
 * after each block's shuffle of the nine. Of those, only the points whose
 * origin susceptibility is above `TAPE_MAGNETIC.susceptibilityFloor` are
 * listed (design decision 6 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`), which drops the
 * four corners at width 1. The values are written in full, so each is the
 * double the schedule drew.
 *
 * Each row is `[drive, width, saturation]`, the order of `TAPE_MODELS`'
 * `magnetic`. Order: the centre, the four width-0 corners, then the interior
 * points in the order they were drawn. Pinned by
 * `tapeMagneticCandidateTables.test.ts`, which regenerates the schedule and
 * checks every row against the floor.
 */

/** One magnetic row: the core's drive, width and saturation controls, each in [0, 1]. */
export type TapeMagneticRow = readonly [drive: number, width: number, saturation: number];

export const TAPE_MAGNETIC_CANDIDATES: readonly TapeMagneticRow[] = [
  [0.5, 0.5, 0.5],
  [0, 0, 0],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 1],
  [0.4599172961898148, 0.009801548207178712, 0.4154249094426632],
  [0.8196274454239756, 0.0817043730057776, 0.778554642572999],
  [0.8362328263465315, 0.7688039047643542, 0.9715575405862182],
  [0.15938492002896965, 0.2784419672098011, 0.32353375502862036],
  [0.33866089140065014, 0.48996011330746114, 0.13382563437335193],
  [0.15452090534381568, 0.9428394944407046, 0.09700964391231537],
  [0.74230687180534, 0.8311155559495091, 0.5280546580906957],
  [0.17490537511184812, 0.4290957539342344, 0.6310650843661278],
  [0.8436590381897986, 0.6549362002406269, 0.5531720269937068],
  [0.11599483573809266, 0.3561722687445581, 0.9819804928265512],
  [0.3361578288022429, 0.1319972772616893, 0.5640697486232966],
  [0.051820434629917145, 0.24033764540217817, 0.947828893084079],
  [0.3587754589971155, 0.8107975705061108, 0.9907863077241927],
  [0.08266638754867017, 0.8797813723795116, 0.3754573264159262],
  [0.7231755261309445, 0.5094192686956376, 0.5937485755421221],
  [0.5451831214595586, 0.5887099420651793, 0.5555956494063139],
  [0.6983990175649524, 0.9390630819834769, 0.9613987696357071],
  [0.21711818035691977, 0.4111330793239176, 0.864755772985518],
  [0.7921781756449491, 0.6281396539416164, 0.8311862065456808],
  [0.872949532000348, 0.11943741305731237, 0.6809091235045344],
];
