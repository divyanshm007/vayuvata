import { describe, expect, it } from 'vitest';
import { fmtDisplay, govDisplay, isGas, radiusLabel } from '../utils/units';

describe('government units (display only)', () => {
  it('shows gases in ppm: SO2 and NO2 from µg/m³, CO from mg/m³', () => {
    const so2 = govDisplay('SO2', 10, 'µg/m³');                       // 10 µg/m³ x 24.45 / (64.07 x 1000) = 0.003816 ppm
    expect(so2.unit).toBe('ppm'); expect(so2.value!).toBeCloseTo(0.003816, 5);
    const no2 = govDisplay('NO2', 46.01, 'µg/m³'); expect(no2.value!).toBeCloseTo(0.02445, 5);
    const co = govDisplay('CO', 1.2, 'mg/m³');                         // 1.2 mg/m³ = 1200 µg/m³ -> 1200 x 24.45 / (28.01 x 1000) = 1.0475 ppm
    expect(co.unit).toBe('ppm'); expect(co.value!).toBeCloseTo(1.0475, 3);
  });

  it('keeps particles in µg/m³ and shows a missing value as (Not Available)', () => {
    expect(govDisplay('PM2.5', 154, 'µg/m³')).toEqual({ value: 154, unit: 'µg/m³', digits: 1 });
    expect(isGas('PM10')).toBe(false); expect(isGas('SO₂')).toBe(true); expect(isGas('OZONE')).toBe(true);
    expect(fmtDisplay(govDisplay('SO2', null, 'µg/m³'))).toBe('(Not Available)');
    expect(govDisplay('SO2', null, 'µg/m³').unit).toBe('ppm');
  });

  it('shows a distance as a radius ring, not as kilometres', () => {
    expect(radiusLabel(0.4)).toBe('Within 1 km radius');
    expect(radiusLabel(1)).toBe('Within 1 km radius');
    expect(radiusLabel(1.01)).toBe('Within 2 km radius');
    expect(radiusLabel(7.3)).toBe('Within 10 km radius');
    expect(radiusLabel(48)).toBe('Within 50 km radius');
    expect(radiusLabel(250)).toBe('Beyond 100 km radius');
    expect(radiusLabel(null)).toBe('(Not Available)');
  });
});
