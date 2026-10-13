/**
 * The CC router's engine (windsor#784, record `2026-10-13-midi-cc-mapping`):
 * `CcEngine` over the open document and the host's performance API. A
 * target's row and its own value are read from the document as the Song
 * tab's lanes read them (`laneRow`, `currentValue`), so a mapping sees the
 * patch, strip or insert value its knob shows. A value is played through
 * `EngineHost.setPerformance`, and this file keeps what it holds, so the
 * panel can tell a held CC base from the target's own value.
 */
import type { ArrangementDocument, CcTargetId, DocumentPart, Patch } from '@windsor/engine';
import { partAt } from '@windsor/engine';

import type { CcApplyResult, CcEngine, CcTargetNow } from './ccEngine';
import type { PerformanceResult } from './host';
import { currentValue, laneRow } from './songAutomationModel';

/** What the engine needs of the host: the performance calls, null while audio is off. */
export interface PerformanceHost {
  setPerformance(slot: number, target: CcTargetId, value: number): PerformanceResult | null;
  clearPerformance(slot: number, target: CcTargetId): void;
}

const key = (part: number, target: CcTargetId): string => `${part}|${target}`;

/** The patch `part` plays in `doc`, by its preset id. */
export const partPatch = (doc: ArrangementDocument, part: DocumentPart): Patch | undefined =>
  doc.patches?.[part.preset];

export class DocumentCcEngine implements CcEngine {
  /** The CC base each target holds in the engine, in its units. */
  private readonly held = new Map<string, number>();

  constructor(
    private readonly doc: () => ArrangementDocument,
    private readonly host: PerformanceHost,
  ) {}

  target(part: number, target: CcTargetId): CcTargetNow | undefined {
    const doc = this.doc();
    const owner = partAt(doc, part);
    if (!owner) return undefined;
    const patch = partPatch(doc, owner);
    const row = laneRow(owner, target, patch);
    return row && { row, own: currentValue(owner, patch, target) };
  }

  patch(part: number): Patch | undefined {
    const doc = this.doc();
    const owner = partAt(doc, part);
    return owner && partPatch(doc, owner);
  }

  automated(part: number, target: CcTargetId): boolean {
    const lanes = partAt(this.doc(), part)?.automation ?? [];
    return lanes.some((lane) => lane.target === target && lane.on);
  }

  /**
   * Play `value`, passing the engine's result through. Only a value the
   * engine applied is held as the CC's base; a full voice, a lane, a target
   * it cannot play now and audio off (`null`) hold nothing.
   */
  apply(part: number, target: CcTargetId, value: number): CcApplyResult {
    const result = this.host.setPerformance(part, target, value);
    if (result === 'applied') this.held.set(key(part, target), value);
    if (result === null) return 'off';
    return result === 'no-slot' ? 'noSlot' : result;
  }

  clear(part: number, target: CcTargetId): void {
    this.held.delete(key(part, target));
    this.host.clearPerformance(part, target);
  }

  /**
   * Forget every held base without telling the host: another song opened, or a
   * new live system stands, and neither holds a CC value.
   */
  forget(): void {
    this.held.clear();
  }

  /** The CC base `target` of `part` holds, or undefined when it plays its own value. */
  heldValue(part: number, target: CcTargetId): number | undefined {
    return this.held.get(key(part, target));
  }
}
