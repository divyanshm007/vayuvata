import { NOT_AVAILABLE } from './format';

/**
 * Display units for the Government Comparison page (display only; nothing is converted in the database).
 * The government feed reports gases in µg/m³ (CO in mg/m³); the device reports gases in ppm (TVOC in ppb). So both sides can be read together, government gas values are shown in ppm,
 * using the CPCB reference conditions (25 °C, 1 atm: one mole of gas is 24.45 litres): ppm = µg/m³ x 24.45 / (molecular weight x 1000).
 */
const MOLAR_VOLUME = 24.45;
const MOLECULAR_WEIGHT: Record<string, number> = { NO2: 46.01, SO2: 64.07, CO: 28.01, O3: 48.0, OZONE: 48.0, NH3: 17.03 };

/** Gases that are displayed in ppm. Particles (PM2.5, PM10) stay in µg/m³. */
export const isGas = (pollutant: string) => (pollutant ?? '').toUpperCase().replace('₂', '2').replace('₃', '3') in MOLECULAR_WEIGHT;

const key = (pollutant: string) => pollutant.toUpperCase().replace('₂', '2').replace('₃', '3');

/** A government value converted for display: gases to ppm, everything else unchanged. */
export function govDisplay(pollutant: string, value: number | null | undefined, unit: string): { value: number | null; unit: string; digits: number } {
  if (value === null || value === undefined) return { value: null, unit: isGas(pollutant) ? 'ppm' : unit, digits: 1 };
  const k = key(pollutant);
  const mw = MOLECULAR_WEIGHT[k];
  if (mw === undefined) return { value, unit, digits: 1 };
  const microgramsPerM3 = /mg\s*\/\s*m/i.test(unit) ? value * 1000 : value;          // CO is reported in mg/m³
  return { value: (microgramsPerM3 * MOLAR_VOLUME) / (mw * 1000), unit: 'ppm', digits: k === 'CO' ? 3 : 4 };
}

/** Number text for a converted value, "(Not Available)" when there is none. */
export const fmtDisplay = (d: { value: number | null; digits: number }): string =>
  d.value === null ? NOT_AVAILABLE : Number(d.value).toLocaleString('en-IN', { maximumFractionDigits: d.digits });

const RADII = [1, 2, 5, 10, 25, 50, 100];

/** The distance shown as a radius ring instead of kilometres: the smallest standard radius that contains it ("Within 5 km radius"). */
export function radiusLabel(km: number | null | undefined): string {
  if (km === null || km === undefined) return NOT_AVAILABLE;
  const r = RADII.find((x) => km <= x);
  return r ? `Within ${r} km radius` : `Beyond ${RADII[RADII.length - 1]} km radius`;
}
