/** Fixed windsor#188 experiment, not product parameters or audibility limits.
 * Only this table differs from windsor#178: the knee system, core, gates,
 * windows, caps and stage instrumentation are #183's, imported unchanged.
 */
import { BOUNDARY } from '../2026-09-30-tape-boundary-reference/boundaryConstants';
export { CORE, CONDITIONING, cases } from '../2026-09-30-tape-boundary-reference/boundaryConstants';
export const OVERLOAD = {
  ...BOUNDARY,
  /** RK4 steps per 48 kHz host sample, visited ascending, both cases per level. */
  levels: [1024, 2048, 4096, 8192],
  /** One control triple (drive/width/saturation), signed host levels +100 and -100. */
  controls: [[1, 0, 0]],
  amplitudes: [100],
  signs: [1, -1],
  /** Magnetization units: maximum absolute raw and full-output difference. */
  tolerance: 1e-7,
  /** Wall-clock milliseconds for the whole numerical child. */
  budgetMs: 900000,
  /** #183's saved rows that the first level must reproduce exactly (M units). */
  anchor: { factor: 1024, final: 1.6944522861437017e-5 },
};
export type Overload = typeof OVERLOAD;
