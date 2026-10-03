/** The meter bundle's entry (windsor#540): `generated/peak-meter-processor.js`
 * registers both meters, so the one `addModule` the engine already makes for
 * the strip meter (`PEAK_METER_WORKLET_URL`) loads the part meter bank too.
 * Each module registers its own processor; a harness picks one by name.
 */
import './peakMeterProcessor';
import './partMeterBankProcessor';
