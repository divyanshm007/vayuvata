export interface AqiCategory { label: string; color: string; bg: string }

// Category table agreed for VayuVata.
const GOOD: AqiCategory = { label: 'Good', color: '#15803d', bg: '#dcfce7' };
const SATISFACTORY: AqiCategory = { label: 'Satisfactory', color: '#a16207', bg: '#fef9c3' };
const MODERATE: AqiCategory = { label: 'Moderate', color: '#c2410c', bg: '#ffedd5' };
const POOR: AqiCategory = { label: 'Poor', color: '#b91c1c', bg: '#fee2e2' };
const VERY_POOR: AqiCategory = { label: 'Very Poor', color: '#7e22ce', bg: '#f3e8ff' };
const SEVERE: AqiCategory = { label: 'Severe', color: '#7f1d1d', bg: '#fbd5d5' };
export const NO_DATA: AqiCategory = { label: 'No data', color: '#64748b', bg: '#f1f5f9' };

export function aqiCategory(aqi: number | null | undefined): AqiCategory {
  if (aqi === null || aqi === undefined || Number.isNaN(aqi)) return NO_DATA;
  if (aqi <= 50) return GOOD;
  if (aqi <= 100) return SATISFACTORY;
  if (aqi <= 200) return MODERATE;
  if (aqi <= 300) return POOR;
  if (aqi <= 400) return VERY_POOR;
  return SEVERE;
}

export const AQI_LEGEND: Array<{ range: string; cat: AqiCategory }> = [
  { range: '0–50', cat: GOOD },
  { range: '51–100', cat: SATISFACTORY },
  { range: '101–200', cat: MODERATE },
  { range: '201–300', cat: POOR },
  { range: '301–400', cat: VERY_POOR },
  { range: '400+', cat: SEVERE },
];
