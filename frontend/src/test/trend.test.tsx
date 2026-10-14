import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme/theme';
import { InteractiveTrendChart } from '../features/dashboard/InteractiveTrendChart';
import { toSeries } from '../features/analytics/charts';
import type { SensorDataDto } from '../types/api';

// Real-shaped readings, one per minute, so the window can move through a known timeline. Test data only.
const reading = (i: number): SensorDataDto => {
  const t = new Date(Date.UTC(2026, 9, 12, 0, 0, 0) + i * 60_000);
  return {
    id: i, deviceId: 'T-1', dataDate: '2026-10-12', dataTime: '00:00:00', recordedAt: t.toISOString().slice(0, 19),
    aqi: 30 + (i % 20), aqiStatus: null, pm10: 20 + (i % 5), pm25: 15 + (i % 4), no2Ppm: null, so2Ppm: null, coPpm: null, tvocPpb: null,
    humidity: 60, temperature: 30, outerTemperature: null, outerHumidity: null, createdAt: t.toISOString().slice(0, 19),
  };
};

const mount = (n: number, truncated = false) =>
  render(<ThemeProvider theme={theme}><InteractiveTrendChart data={toSeries(Array.from({ length: n }, (_, i) => reading(i)))} truncated={truncated} /></ThemeProvider>);

describe('InteractiveTrendChart', () => {
  it('starts on the latest readings and shows a fixed-size window', () => {
    mount(200, true);
    expect(screen.getByText(/Showing 96 of 200 loaded readings/)).toBeInTheDocument();
    expect(screen.getByText(/the latest 300 in this range/)).toBeInTheDocument();
    expect(screen.getByText(/Latest in view/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to later readings/i })).toBeDisabled();
  });

  it('moves through time: earlier readings change the readout, Latest brings it back', async () => {
    mount(200);
    const user = userEvent.setup();
    const before = screen.getByText(/Latest in view/).nextElementSibling!.textContent;
    await user.click(screen.getByRole('button', { name: /move to earlier readings/i }));
    const after = screen.getByText(/Latest in view/).nextElementSibling!.textContent;
    expect(after).not.toBe(before);                      // different time now shown
    expect(screen.getByRole('button', { name: /move to later readings/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^latest$/i }));
    expect(screen.getByText(/Latest in view/).nextElementSibling!.textContent).toBe(before);
  });

  it('zooms the visible window without changing the chart size', async () => {
    mount(200);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(screen.getByText(/Showing 67 of 200/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(screen.getByText(/Showing 94 of 200/)).toBeInTheDocument();
  });

  it('shows a clear empty state instead of inventing data', () => {
    mount(0);
    expect(screen.getByText(/No readings available/)).toBeInTheDocument();
  });
});
