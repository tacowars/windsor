/**
 * The console's MIDI CC state (windsor#784, record `2026-10-13-midi-cc-mapping`)
 * over a real document model and a fake host: learn commits one mapping as
 * one edit, a message plays its own part whichever part is selected, an
 * on-screen edit of a mapped target drops its CC value (last in wins), and a
 * song opened, a new system and a value the engine dropped re-arm.
 */
import { type CcTargetId, partAt } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { CcMessage } from './ccEngine';
import type { PerformanceHost } from './ccPanelEngine';
import { CcSession, watchDocument } from './ccPanelSession';
import { DocumentModel } from './documentModel';
import { addPart, newSong } from './songParts';

const LEVEL: CcTargetId = 'voice.ops.0.level';
const STRIP: CcTargetId = 'strip.level';

const cc = (value: number, o: Partial<CcMessage> = {}): CcMessage => ({
  device: 'Keys',
  channel: 1,
  cc: 74,
  value,
  ...o,
});

/** Two parts (slots 0 and 1), a jumping session, and a log of what reached the engine. */
function rig() {
  const model = new DocumentModel(newSong());
  model.open(addPart(model.doc)?.doc);
  const log: string[] = [];
  const host: PerformanceHost = {
    setPerformance: (slot, target, value) => {
      log.push(`set ${slot} ${target} ${value.toFixed(3)}`);
      return 'applied';
    },
    clearPerformance: (slot, target) => void log.push(`clear ${slot} ${target}`),
  };
  const edits: string[] = [];
  const session = new CcSession({
    doc: () => model.doc,
    host,
    commit: (partial, label) => {
      edits.push(label);
      model.merge(partial);
      return true;
    },
    takeover: 'jump',
  });
  watchDocument(model, session);
  return { model, session, log, edits };
}

/** Learn `target` on `part` from a knob moved 0 → 10. */
function learn(r: ReturnType<typeof rig>, part: number, target: CcTargetId): void {
  r.session.learn(part, target);
  r.session.hear(cc(0));
  r.session.hear(cc(10));
}

describe('CcSession', () => {
  it('commits what learn heard as one edit over the full range, and the row reads it heard', () => {
    const r = rig();
    r.session.learn(1, LEVEL);
    expect(r.session.learning).toEqual({ part: 1, target: LEVEL, added: true });
    r.session.hear(cc(0));
    expect(partAt(r.model.doc, 1)?.ccMappings).toBeUndefined();
    r.session.hear(cc(10));
    expect(r.edits).toEqual(['MIDI CC mapping']);
    expect(partAt(r.model.doc, 1)?.ccMappings).toEqual([
      {
        source: { device: 'Keys', channel: 1, cc: 74 },
        target: LEVEL,
        min: 0,
        max: 1,
        inverted: false,
      },
    ]);
    expect(r.session.learning).toBeNull();
    expect(r.session.heard?.source.cc).toBe(74);
    expect(r.session.heardFrom(1, LEVEL)).toEqual({ device: 'Keys', channel: 1 });
  });

  it('leaves nothing behind when learn is cancelled, or its part is removed', () => {
    const r = rig();
    r.session.learn(1, LEVEL);
    r.session.hear(cc(0));
    r.session.cancelLearn();
    r.session.hear(cc(20));
    expect(r.edits).toEqual([]);
    r.session.learn(1, LEVEL);
    r.model.merge({ parts: { 1: null } });
    expect(r.session.learning).toBeNull();
  });

  it('moves the mapped part, whichever part is selected, and nothing else', () => {
    const r = rig();
    learn(r, 1, LEVEL);
    r.log.length = 0;
    r.session.hear(cc(127));
    r.session.hear(cc(127, { cc: 75 }));
    expect(r.log).toEqual([`set 1 ${LEVEL} 1.000`]);
    expect(r.session.status(1, LEVEL)).toEqual({ kind: 'live', value: 1, held: true });
    expect(r.session.current(1, LEVEL)).toBe(1);
  });

  it('drops a CC value its target is turned on screen, and re-arms pickup (last in wins)', () => {
    const r = rig();
    learn(r, 0, STRIP);
    r.session.takeover = 'pickup';
    r.session.hear(cc(127));
    r.log.length = 0;
    r.model.merge({ parts: { 0: { strip: { level: 0.25 } } } });
    expect(r.log).toEqual([`clear 0 ${STRIP}`]);
    expect(r.session.status(0, STRIP)?.kind).toBe('waiting');
  });

  it('re-arms on a new system and on a value the engine dropped, and starts fresh on a song opened', () => {
    const r = rig();
    learn(r, 0, STRIP);
    r.session.takeover = 'pickup';
    r.session.hear(cc(127));
    r.session.systemBuilt();
    expect(r.session.status(0, STRIP)?.kind).toBe('waiting');
    r.session.dropped(0, STRIP);
    expect(r.session.status(0, STRIP)?.kind).toBe('waiting');
    r.model.open(r.model.doc);
    expect(r.session.heardFrom(0, STRIP)).toBeUndefined();
    expect(r.session.status(0, STRIP)).toEqual({ kind: 'waiting', marker: null });
  });
});
