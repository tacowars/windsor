/** Public program descriptions mapped to our own parameters, not decoded factory programs. */
export const RETRO_ROOM_TABLE = [
  [0.2, 'Small', 'Bright'],
  [0.2, 'Small', 'Warm'],
  [0.2, 'Medium', 'Bright'],
  [0.3, 'Small', 'Bright'],
  [0.3, 'Small', 'Warm'],
  [0.4, 'Medium', 'Bright'],
  [0.4, 'Medium', 'Warm'],
  [0.6, 'Small', 'Bright'],
  [0.6, 'Medium', 'Warm'],
  [0.6, 'Medium', 'Dark'],
  [0.8, 'Small', 'Bright'],
  [0.8, 'Large', 'Warm'],
  [1, 'Small', 'Warm'],
  [1, 'Medium', 'Warm'],
  [1, 'Large', 'Bright'],
  [1.2, 'Medium', 'Warm'],
  [1.2, 'Small', 'Warm'],
  [1.2, 'Small', 'Bright'],
  [1.4, 'Large', 'Warm'],
  [1.4, 'Large', 'Dark'],
  [1.4, 'Medium', 'Warm'],
  [1.6, 'Small', 'Dark'],
  [1.6, 'Large', 'Bright'],
  [1.6, 'Medium', 'Bright'],
  [1.8, 'Large', 'Dark'],
  [1.8, 'Large', 'Bright'],
  [1.8, 'Medium', 'Warm'],
  [2, 'Large', 'Bright'],
  [2, 'Medium', 'Warm'],
  [2, 'Large', 'Warm'],
  [2.5, 'Medium', 'Warm'],
  [2.5, 'Large', 'Bright'],
  [2.5, 'Medium', 'Bright'],
  [2.8, 'Small', 'Bright'],
  [2.8, 'Medium', 'Bright'],
  [3, 'Large', 'Bright'],
  [3, 'Large', 'Warm'],
  [3, 'Medium', 'Dark'],
  [3.5, 'Large', 'Bright'],
  [3.5, 'Large', 'Warm'],
  [4, 'Large', 'Dark'],
  [4, 'Large', 'Bright'],
  [5, 'Large', 'Warm'],
  [8, 'Large', 'Bright'],
  [8, 'Large', 'Warm'],
  [10, 'Large', 'Bright'],
  [10, 'Large', 'Warm'],
  [16, 'Large', 'Dark'],
  [18, 'Extra large', 'Bright'],
  [20, 'Extra large', 'Dark'],
] as const;
export const RETRO_PRESET_SIZES = { Small: 0.5, Medium: 1, Large: 1.7, 'Extra large': 2.5 };
export const RETRO_PRESET_TONES = { Bright: 8500, Warm: 4800, Dark: 2200 };
export const RETRO_GATE_DURATIONS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6];
export const RETRO_REVERSE_DURATIONS = [0.3, 0.4, 0.5, 0.6];
export const RETRO_PRESET_DIFFUSION = 0.85;
export const RETRO_PRESET_CHARACTER = 0.65;
export const RETRO_GATE_FIRST = 51;
export const RETRO_REVERSE_FIRST = 60;
export const RETRO_MILLISECONDS = 1000;
