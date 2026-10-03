/* eslint-disable no-magic-numbers -- DSP: the parameter ranges, the pan spread and the 128-frame budget are the part's contract; the tunables are fmConstants.ts (#654) */
/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */
/**
 * fmProcessor.js -- the FM part processor, the entry that
 * `scripts/build-worklets.mjs` bundles into `../generated/fm-processor.js`,
 * the one script every consumer reads (#643). One node == one timbral part;
 * instantiate several for multi-timbral use.
 *
 * Runs on the audio thread. The rules for every line under `fm/` are stated
 * in full in ../CLAUDE.md; the two that govern most edits:
 *   1. No allocation in process(): a GC pause is an audible dropout.
 *   2. Bit-identity by construction: the same IEEE operations in the same
 *      order, on every path (#548). `fmProcessorGolden.test.ts` is the gate.
 *
 * What this file owns: the parameter descriptors, the message port (patch,
 * notes, live retune, load sampling, the song lanes' slot map), the
 * fader's ramp across a quantum (windsor#346), the frame-stamped event queue, the
 * note map, and `renderBlock`, which admits the notes posted since the last
 * quantum, reads each message as it takes it (windsor#270), and walks each
 * active voice up to the next event or control boundary, each voice's
 * control interval its own (windsor#326). Which voice a note
 * takes is `voiceAllocation.ts`. Everything a voice does is
 * `voice.js` and the modules beside it; the patch schema and algorithm
 * tables are mirrored in ../../patch.ts (`patch.test.ts`, until #656).
 */

import type { NoteMessage, ProcessorOptions, WorkletMessage } from '../../synth/workletMessages';
import type { WorkletPatch } from './patchNormalise';
import { EventQueue } from './eventQueue';
import { normalisePatch, num } from './patchNormalise';
import { makeRandom } from './prng';
import { LoadSampler } from '../loadSampler';
import type { Voice } from './voice';
import { allocateVoice } from './voiceAllocation';
import { buildVoicePool } from './voiceSteal';
import type { ControlIntervalOverrides, ControlIntervalTable } from './voiceControlInterval';
import { controlIntervalTable } from './voiceControlInterval';
import { PART_BEND, PART_CONTROL_COUNT, PART_WHEEL } from './voiceControl';
import {
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  latchVoiceOffsets,
  mapVoiceSlots,
} from './voiceOffsets';
import { VOICE_TARGET_COUNT } from './voiceTargetTables';
import { WAVE } from './waveIds';
import { getMips } from './waveTables';

/** `processorOptions` as the part reads them: the contract's, plus the harness-only switches (#547, #548, windsor#326). */
interface FmProcessorOptions extends Partial<ProcessorOptions> {
  dormancy?: boolean;
  specialise?: boolean;
  /** The control intervals' table over the shipped one (windsor#326): a test sets `long` to 32 to render as before. */
  controlIntervals?: ControlIntervalOverrides;
}

/**
 * The note-on being started, in `noteIn`: the render copies the message's
 * numbers here as it takes the event, so `noteOn` reads no message
 * (windsor#270). A missing or non-number velocity or mod is NaN.
 */
const NOTE_IN_NOTE = 0,
  NOTE_IN_VELOCITY = 1,
  NOTE_IN_MOD = 2,
  NOTE_IN_COUNT = 3;

/* ------------------------------------------------------------------ *
 * The processor — one timbral part
 * ------------------------------------------------------------------ */

class FmPartProcessor extends AudioWorkletProcessor {
  maxVoices: number;
  random: () => number;
  voices: Voice[];
  patch: WorkletPatch;
  waveSets: (Float32Array[] | null)[];
  events: EventQueue;
  partControls: Float64Array;
  partOffsets: Float64Array;
  partFloors: Float64Array;
  slotTargets: Int32Array;
  slotsMapped: boolean;
  gainFrom: number;
  noteIn: Float64Array;
  slideIn: boolean;
  stepModIn: readonly number[] | null;
  lastNote: number;
  running: boolean;
  liveRetune: boolean;
  slideSeconds: number;
  dormancy: boolean;
  intervals: ControlIntervalTable;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'pitchBend', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'modWheel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      // The song lanes' slots (windsor#346, `voiceOffsets.ts`): each an offset
      // on the target the slot map gives it, 0 for none. No declared range,
      // so Web Audio's float32 bounds, which no offset between two catalog
      // values reaches: the voice clamps the sum to the row's bounds.
      ...VOICE_SLOT_PARAMS.map((name): AudioParamDescriptor => ({
        name,
        defaultValue: 0,
        automationRate: 'k-rate',
      })),
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const opts: FmProcessorOptions = (options && options.processorOptions) || {};
    const maxVoices = Math.max(1, Math.min(128, opts.maxVoices || 16));
    this.maxVoices = maxVoices;

    // One random source for the whole part. Absent `seed` this is Math.random,
    // which is what live playback gets; see "Randomness" in `prng.ts`.
    this.random = makeRandom(opts.seed);

    // Rule 7: each double field is born a double (NaN), before its start value
    // (windsor#233). `gainFrom`, the last quantum's gain, stays NaN until the
    // first quantum gives it one.
    this.lastNote = this.slideSeconds = this.gainFrom = NaN;

    // The k-rate parameters for this quantum, one slot each (`PART_BEND`, …):
    // `renderBlock` writes them, and every voice's control update reads them,
    // so no double is passed to a call (windsor#233).
    this.partControls = new Float64Array(PART_CONTROL_COUNT);

    // The song lanes' offsets by target code, which every voice reads, the
    // floors a mapped decay time plays at least (windsor#347), and the slot
    // map, from construction so an offline render's lanes play from its first
    // sample (windsor#346).
    this.partOffsets = new Float64Array(VOICE_TARGET_COUNT);
    this.partFloors = new Float64Array(VOICE_TARGET_COUNT);
    this.slotTargets = new Int32Array(VOICE_SLOT_COUNT);
    this.slotsMapped = mapVoiceSlots(this.slotTargets, this.partFloors, opts.voiceSlots);

    // The note-on the render is starting (`NOTE_IN_*`), its slide flag and its
    // step's offsets, copied from the message as the render takes it (windsor#270).
    this.noteIn = new Float64Array(NOTE_IN_COUNT);
    this.slideIn = false;
    this.stepModIn = null;

    // Reserve slots above the sounding limit so a stolen voice can fade out
    // while its replacement is already sounding (`voiceSteal.ts`, windsor#410).
    this.voices = buildVoicePool(this, maxVoices, sampleRate);

    this.patch = normalisePatch(opts.patch);
    this.waveSets = [null, null, null, null];
    this.rebuildWaves();

    this.events = new EventQueue(); // frame-stamped, kept sorted
    // The note map is each voice's `keyed` flag and `voiceId` (windsor#233):
    // a `Map` of lists allocated a list per note and grew its table.
    this.lastNote = NaN; // for legato glide; NaN until the first note
    this.running = true;
    // Off by default; the console turns it on so a knob retunes ringing voices.
    this.liveRetune = false;
    // Seconds a slid note glides when the patch's `glide` is 0 (#602).
    this.slideSeconds = num(opts.slideSeconds, 0);
    // Skipping silent held voices (#547). Always on in live playback;
    // `dormancy: false` exists so a test can render the same part without it and
    // prove the two renders agree.
    this.dormancy = opts.dormancy !== false;
    // The fixed-index voice kernel and per-note constants (#548), always on in
    // live playback; `specialise: false` renders every voice through the
    // generic loop, so a test can prove the two agree bit for bit.
    const specialise = opts.specialise !== false;
    for (let i = 0; i < this.voices.length; i++) this.voices[i].specialise = specialise;
    // Each voice's control interval, 32 or 128 samples, chosen from its state
    // at each control boundary (windsor#326); a test may set the table.
    this.intervals = controlIntervalTable(opts.controlIntervals);

    // Audio-load sampler (#445, `../loadSampler.ts`), off until a `reportLoad`
    // message turns it on, so an offline render and the Node harness time
    // nothing and post nothing. See workletMessages.ts for why this counts
    // millisecond boundaries rather than timing the call.
    this.load = new LoadSampler(sampleRate, this.port);

    // Events supplied at construction. port.postMessage() is delivered
    // asynchronously and can lose the race against OfflineAudioContext's
    // startRendering(), so offline renders must pass their notes this way.
    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) this.schedule(ev);
    }

    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onMessage(e.data);
  }

  rebuildWaves(): void {
    const p = this.patch;
    for (let i = 0; i < 4; i++) {
      const op = p.ops[i];
      if (op.wave === WAVE.NOISE || op.wave === WAVE.SAW_D || op.wave === WAVE.SQUARE_D) {
        this.waveSets[i] = null;
      } else {
        this.waveSets[i] = getMips(op.wave, sampleRate, p.tone, op.userPartials);
      }
    }
  }

  onMessage(msg: WorkletMessage): void {
    switch (msg.type) {
      case 'patch': {
        this.patch = normalisePatch(msg.patch);
        this.rebuildWaves();
        // By default live voices keep their old patch reference until they
        // finish, which avoids clicks when a preset swaps under a ringing note.
        // The console opts into hearing the knob as it turns instead.
        if (this.liveRetune) {
          const slots = this.slotTargets;
          for (const v of this.voices) if (v.active) v.rebind(this.patch, this.waveSets, slots);
        }
        break;
      }
      case 'liveRetune':
        this.liveRetune = !!msg.enabled;
        break;
      case 'noteOn':
        this.schedule(msg);
        break;
      case 'noteOff':
        this.schedule(msg);
        break;
      case 'allNotesOff':
        // Queued future events are cancelled too: a mute or a live rebuild
        // (#69) must not let the scheduler's look-ahead keep sounding. Unlike
        // panic, voices already sounding still release with their tails.
        for (const v of this.voices) this.releaseVoice(v);
        this.unkeyAll();
        this.events.clear();
        break;
      case 'panic':
        for (const v of this.voices) v.kill();
        this.unkeyAll();
        this.events.clear();
        break;
      case 'stop':
        this.running = false;
        break;
      case 'reportLoad':
        // #445: start (or restart) the duty-cycle sampler.
        this.load.start(msg.quanta);
        break;
      case 'voiceSlots':
        // windsor#346: a lane added, moved or removed. A free slot offsets nothing.
        this.slotsMapped = mapVoiceSlots(this.slotTargets, this.partFloors, msg.slots);
        if (!this.slotsMapped) this.partOffsets.fill(0);
        break;
    }
  }

  /**
   * Queue `ev` at its frame, or, without one, at the quantum that admits it.
   * It is posted, reading nothing of the message, and `renderBlock` admits it
   * at the start of the next quantum (windsor#270, `eventQueue.ts`): a
   * function run once a message is left in V8's baseline tier when the first
   * frame past 2^31 deprecates the message's map, and there it would box
   * the frame it read.
   */
  schedule(ev: NoteMessage): void {
    this.events.post(ev);
  }

  /** Drop every voice from the note map: a later note-off for any of them finds nothing. */
  unkeyAll(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) vs[i].keyed = false;
  }

  /**
   * Mono (#453): fade out every voice the part has sounding -- the 4 ms
   * `Voice.steal`, so the cut never clicks -- and drop the note map
   * with them, so a later noteOff for a cut note finds nothing and cannot
   * release the note that replaced it. Allocates nothing.
   */
  cutSounding(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && !v.fading) v.steal();
    }
    this.unkeyAll();
  }

  /**
   * Start the note-on in `noteIn`, `slideIn` and `stepModIn` under handle
   * `id`. It reads no message: the render copied it there (windsor#270).
   */
  noteOn(id: number): void {
    const p = this.patch;
    const input = this.noteIn;
    const note = input[NOTE_IN_NOTE];
    // `num(v, d)` with no call: `v - v` is 0 only for a finite v, and NaN
    // stands for a missing or non-number field.
    const velocity = input[NOTE_IN_VELOCITY];
    const vel = velocity - velocity === 0 ? velocity : 1;
    const modIn = input[NOTE_IN_MOD];
    const mod = modIn - modIn === 0 ? modIn : 0;
    const count = p.spread > 0 ? 2 : 1;
    // Where a glide starts: the last note, NaN for none (`lastNote` is NaN until the first).
    const glideFrom = p.glide > 0 ? this.lastNote : NaN;

    // One note at a time, with retrigger: the cut happens before the new note
    // allocates, so the fading voices are in reserve slots and the new note
    // starts fresh. `spread` still runs its detuned pair for the one note, and
    // `glide` still slides from `lastNote`.
    // A slide in mono (#602): the sounding voice takes the new note legato.
    if (this.slideIn && p.mono && this.slideTo(id, vel, mod)) return;
    if (p.mono) this.cutSounding();

    // A handle already held is released first, as a new note under it.
    this.noteOffId(id);

    for (let u = 0; u < count; u++) {
      const v = allocateVoice(this.voices, this.maxVoices, this.dormancy);
      const sign = u === 0 ? -1 : 1;
      const detune = count === 1 ? 0 : (sign * p.spread) / 100;
      let pan = p.pan + p.panKey * ((note - 60) / 48) + p.panRandom * (this.random() * 2 - 1);
      if (count > 1) {
        // `Math.min(1, spread / 50)`, NaN and -0 alike, with no builtin call.
        const width = p.spread / 50;
        pan += sign * 0.35 * (width > 1 ? 1 : width);
      }
      // The note's doubles go to the voice in its fields, not as arguments (windsor#233).
      v.note = note;
      v.velocity = vel;
      v.detune = detune;
      v.pan = pan;
      v.glideFrom = glideFrom;
      v.start(p, this.waveSets, id, this.stepModIn);
      v.mod = mod;
      v.keyed = true;
    }
    this.lastNote = note;
  }

  /**
   * Retarget the held note's voices to the note-on's note and step offsets
   * (`noteIn`, `stepModIn`, windsor#17) under handle `id` (#602). In mono
   * at most one handle is gated, so the first gated voice names it. False when nothing is
   * sounding: the caller starts a fresh voice instead. The slide takes the
   * handle `id` over: a voice still keyed to it leaves the note map without a
   * release, as it did when the map was a `Map` whose entry for `id` the
   * slide replaced. Allocates nothing.
   */
  slideTo(id: number, velocity: number, mod: number): boolean {
    const note = this.noteIn[NOTE_IN_NOTE];
    const vs = this.voices;
    let heldId: number | null = null;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.gate && !v.fading) {
        heldId = v.voiceId;
        break;
      }
    }
    if (heldId === null || heldId === id || !this.isKeyed(heldId)) return false;
    const p = this.patch;
    const glide = p.glide > 0 ? p.glide : this.slideSeconds;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.keyed && v.voiceId === id) v.keyed = false;
    }
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.keyed || v.voiceId !== heldId) continue;
      v.retarget(note, velocity, mod, glide, this.stepModIn);
      v.voiceId = id;
    }
    this.lastNote = note;
    return true;
  }

  /** Whether the note map holds any voice under handle `id`. */
  isKeyed(id: number): boolean {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) if (vs[i].keyed && vs[i].voiceId === id) return true;
    return false;
  }

  /** Release every voice the note map holds under handle `id`, and drop them from it. */
  noteOffId(id: number): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.keyed || v.voiceId !== id) continue;
      v.keyed = false;
      this.releaseVoice(v);
    }
  }

  /** Note-off for one voice: a dormant voice's release is silence, so it just ends (#547). */
  releaseVoice(v: Voice): void {
    if (this.dormancy && v.active && v.dormant) v.kill();
    else v.release();
  }

  /**
   * The render. `renderBlock` is the whole of it; `process` is the sampler
   * wrapper (#445) and nothing else, so the hot loop reads exactly as it did
   * and a page that never turns the sampler on pays one branch per quantum.
   */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const load = this.load;
    if (load.quanta === 0) return this.renderBlock(inputs, outputs, params);
    load.begin();
    const running = this.renderBlock(inputs, outputs, params);
    load.end(128);
    return running;
  }

  /**
   * This quantum's bend and wheel into `partControls`, and the song
   * lanes' slots into `partOffsets` while any is mapped (windsor#346), where
   * every voice's control update reads them. Passed to the update as
   * arguments, each was a new heap number wherever V8 did not inline it
   * (windsor#233).
   */
  latchControls(params: Record<string, Float32Array>): void {
    const controls = this.partControls;
    controls[PART_BEND] = params.pitchBend[0];
    controls[PART_WHEEL] = params.modWheel[0];
    if (this.slotsMapped) latchVoiceOffsets(this.partOffsets, this.slotTargets, params);
  }

  // One quantum read top to bottom: admit, apply the events due, render each
  // segment. The message reads stay in it because it runs every quantum
  // (windsor#270, see the admission below).
  // eslint-disable-next-line max-lines-per-function -- the render is the one function that reads messages, so they stay in V8's top tiers
  renderBlock(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return this.running;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const n = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    this.latchControls(params);
    const gain = params.gain[0];
    // The fader moves from the last quantum's gain to this one's across the
    // block (windsor#346); NaN before the first quantum, which starts on its own.
    const gainFrom = this.gainFrom;
    this.gainFrom = gain;

    const blockStart = currentFrame;
    const dormancy = this.dormancy;
    const intervals = this.intervals;
    const q = this.events;
    let cursor = 0;

    // Admit what the port posted since the last quantum, in arrival order, at
    // its frame or, without one, at this quantum's. This reads messages, so it
    // is written here and not in a method called once a message: the render
    // runs every quantum, and V8 optimises it again within a few hundred
    // quanta of the first frame past 2^31 deprecating the message's map, where
    // a method run per message stayed in its baseline tier, boxing (windsor#270).
    const posted = q.posted;
    for (let i = 0; i < q.postedCount; i++) {
      const ev = posted[i]!;
      posted[i] = undefined;
      q.incoming[0] = typeof ev.frame === 'number' ? ev.frame : blockStart;
      q.insert(ev);
    }
    q.postedCount = 0;

    while (cursor < n) {
      // Apply every event landing on this frame.
      // The next event's frame is read in place, never returned from a call:
      // past 2^31 it is a double, which a return can box (rule 2).
      while (!q.empty && q.frames[q.head] <= blockStart + cursor) {
        const ev = q.take();
        const id = ev.id != null ? ev.id : ev.note!;
        if (ev.type === 'noteOn') {
          // The note-on's numbers, copied here for the same reason as the
          // frames above: `noteOn` reads no message.
          const input = this.noteIn;
          input[NOTE_IN_NOTE] = ev.note;
          input[NOTE_IN_VELOCITY] = typeof ev.velocity === 'number' ? ev.velocity : NaN;
          input[NOTE_IN_MOD] = typeof ev.mod === 'number' ? ev.mod : NaN;
          this.slideIn = !!ev.slide;
          this.stepModIn = ev.stepMod || null;
          this.noteOn(id);
          this.stepModIn = null; // the message's array, not kept alive (windsor#262)
        } else if (ev.type === 'noteOff') this.noteOffId(id);
      }

      // Render up to the next event, the next control boundary, or block end.
      let seg = n - cursor;
      if (!q.empty) {
        const untilEvent = q.frames[q.head] - (blockStart + cursor);
        // In (0, seg), so `| 0` is exact; it keeps `seg` a small integer when
        // the frames are doubles (past 2^31), and `voice.age` with it.
        if (untilEvent > 0 && untilEvent < seg) seg = untilEvent | 0;
      }

      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v.active) continue;

        let done = 0;
        while (done < seg) {
          // A steal fade that ends inside the segment kills the voice (and
          // `kill` resets `fade` to 1): rendering on would bring the filter's
          // ring back at full level, then cut it at the segment end (windsor#7).
          if (!v.active) break;
          // A dormant voice is skipped to the end of the segment and re-read at
          // the next one (#547); `ctrlCount` stays 0 so that check is a control
          // boundary. Age still runs, so stealing order holds.
          if (v.ctrlCount === 0 && dormancy && v.dormant) {
            v.age += seg - done;
            break;
          }
          // Each voice's interval from its state (windsor#326): 32 while
          // anything fast is happening, 128 while nothing is.
          if (v.ctrlCount === 0) v.ctrlCount = v.updateControlBlock(intervals);
          const chunk = Math.min(seg - done, v.ctrlCount);
          v.render(outL, outR, cursor + done, chunk);
          v.ctrlCount -= chunk;
          done += chunk;
        }

        // A held End level fades from the quantum's end alone (windsor#323).
        v.settle(cursor + seg === n);
      }

      cursor += seg;
    }

    if (gainFrom === gain || gainFrom !== gainFrom) {
      if (gain !== 1) {
        for (let i = 0; i < n; i++) outL[i] *= gain;
        if (outR !== outL) for (let i = 0; i < n; i++) outR[i] *= gain;
      }
    } else {
      // `a + (b − a) · t`, reaching this quantum's gain on its last sample.
      const span = gain - gainFrom;
      for (let i = 0; i < n; i++) outL[i] *= gainFrom + span * ((i + 1) / n);
      if (outR !== outL) for (let i = 0; i < n; i++) outR[i] *= gainFrom + span * ((i + 1) / n);
    }

    return this.running;
  }
}

registerProcessor('fm-part', FmPartProcessor);
