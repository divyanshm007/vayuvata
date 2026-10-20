import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeviceHealthAlerts } from '../features/devices/useDeviceHealth';
import type { DeviceHealth } from '../types/api';

const h = (over: Partial<DeviceHealth>): DeviceHealth => ({
  id: 12, deviceId: 'Vayu_004', deviceName: 'Vayu_004 (UAT)', status: 'ok', message: null, readingsLastHour: 60, outerMissingLastHour: 0, outerMissingPercent: 0, lastReadingAt: null, ...over,
});
const show = (problems: DeviceHealth[]) => render(<MemoryRouter><DeviceHealthAlerts problems={problems} /></MemoryRouter>);

describe('device health warnings', () => {
  it('renders nothing when every device is healthy', () => {
    const { container } = show([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a red warning with the cause and a link to the device when the outer sensor is failing', () => {
    show([h({ status: 'failing', outerMissingPercent: 95, message: 'Outer temperature / humidity are missing in 95% of the last 60 readings.' })]);
    expect(screen.getByText(/Outer sensor failing/)).toBeInTheDocument();
    expect(screen.getByText(/missing in 95%/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vayu_004 (UAT)' })).toHaveAttribute('href', '/devices/12');
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standardError');
  });

  it('distinguishes an intermittent problem and an offline device', () => {
    show([
      h({ status: 'warning', message: 'intermittent' }),
      h({ id: 9, deviceId: 'Vayu_002', deviceName: 'Vayu_002', status: 'offline', message: 'No readings in the last hour' }),
    ]);
    expect(screen.getByText(/Outer sensor unreliable/)).toBeInTheDocument();
    expect(screen.getByText(/Device offline/)).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
