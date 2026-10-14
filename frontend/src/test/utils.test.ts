import { AxiosError } from 'axios';
import { aqiCategory } from '../utils/aqi';
import { fmtWallClock, isRecentlyReporting } from '../utils/format';
import { toAppError } from '../utils/errors';
import { passwordSchema } from '../utils/schemas';

describe('aqiCategory', () => {
  it.each([[0, 'Good'], [50, 'Good'], [51, 'Satisfactory'], [100, 'Satisfactory'], [101, 'Moderate'], [200, 'Moderate'],
    [201, 'Poor'], [300, 'Poor'], [301, 'Very Poor'], [400, 'Very Poor'], [401, 'Severe'], [999, 'Severe']])('%i -> %s', (v, l) => {
    expect(aqiCategory(v).label).toBe(l);
  });
  it('does not invent a category for missing values', () => {
    expect(aqiCategory(null).label).toBe('No data');
    expect(aqiCategory(undefined).label).toBe('No data');
  });
});

describe('format', () => {
  it('shows zone-less reading timestamps exactly as stored', () => {
    expect(fmtWallClock('2026-10-11T14:05:00')).toContain('14:05');
  });
  it('flags stale or missing readings as not reporting', () => {
    expect(isRecentlyReporting('2020-01-01T00:00:00')).toBe(false);
    expect(isRecentlyReporting(null)).toBe(false);
    const istNow = new Date(Date.now() + 330 * 60_000 - 60_000).toISOString().slice(0, 19);
    expect(isRecentlyReporting(istNow)).toBe(true);
  });
});

describe('password policy (mirrors backend)', () => {
  it('rejects weak and accepts strong passwords', () => {
    expect(passwordSchema.safeParse('short1A').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('NoDigitsHereAtAll').success).toBe(false);
    expect(passwordSchema.safeParse('GoodPassw0rd').success).toBe(true);
  });
});

describe('toAppError', () => {
  const mk = (status: number, data: unknown = {}) => {
    const e = new AxiosError('x');
    e.response = { status, data, headers: {}, statusText: '', config: {} as never };
    return e;
  };
  it('uses the server message and field errors', () => {
    const e = toAppError(mk(400, { message: 'bad', code: 'validation', errors: { Email: ['x'] } }));
    expect(e.message).toBe('bad');
    expect(e.fieldErrors.Email).toEqual(['x']);
  });
  it('hides 500 internals', () => {
    expect(toAppError(mk(500, { message: 'stack trace' })).message).not.toContain('stack');
  });
  it('reports network failures', () => {
    expect(toAppError(new AxiosError('Network Error')).status).toBe(0);
  });
});
