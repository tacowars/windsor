/**
 * The offset the main thread sends for a voice lane (windsor#495): the
 * `voiceOffset` of `path` at `value` over `patch`, through `path`'s own
 * catalog row. The `fmProcessorAutomation*` tests hold the worklet to it.
 */
import { requireCatalogRow, voiceTargetId } from '../automation/automationTargets';
import type { Patch } from '../patch/patch';
import { voiceOffset } from '../synth/voiceAutomation';

export const voiceLaneOffset = (patch: Patch, path: string, value: number): number =>
  voiceOffset(patch, path, requireCatalogRow(voiceTargetId(path)), value);
