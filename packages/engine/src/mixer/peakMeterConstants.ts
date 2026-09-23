/** Sample-peak metering: audio-thread reporting and the console scale (#666). */
export const PEAK_METER_NAME = 'a204-peak-meter';
export const PEAK_METER = {
  reportHz: 30,
  holdSeconds: 1,
  floorDb: -60,
  ceilingDb: 6,
  overload: 1,
} as const;
export interface PeakReport {
  type: 'peaks';
  left: number;
  right: number;
  holdLeft: number;
  holdRight: number;
  overload: boolean;
}
