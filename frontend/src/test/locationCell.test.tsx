import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocationCell } from '../features/devices/LocationCell';

const base = { latitude: 28.595768, longitude: 77.317905, recordedAt: '2026-10-25T18:26:15Z', source: 'gps' };

describe('Location column', () => {
  it('shows the place name (not the coordinates) as a map link, with the time it was recorded', () => {
    render(<LocationCell loc={{ ...base, name: 'Chilla, Noida, Uttar Pradesh' }} />);
    const link = screen.getByRole('link', { name: /Chilla, Noida, Uttar Pradesh/ });
    expect(link).toHaveTextContent('Chilla, Noida, Uttar Pradesh');
    expect(link).not.toHaveTextContent('28.59577');
    expect(link).toHaveAttribute('title', '28.59577, 77.31790');                // coordinates stay available in the tooltip
    expect(link).toHaveAttribute('href', expect.stringContaining('mlat=28.59577&mlon=77.31790'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText(/25 Oct 2026/)).toBeInTheDocument();
  });

  it('falls back to the coordinates until the name has been looked up', () => {
    render(<LocationCell loc={{ ...base, name: null }} />);
    expect(screen.getByRole('link')).toHaveTextContent('28.59577, 77.31790');
  });

  it('marks an approximate (cell tower) position', () => {
    render(<LocationCell loc={{ ...base, source: 'cell', name: 'Delhi' }} />);
    expect(screen.getByText(/approximate \(cell\)/)).toBeInTheDocument();
  });

  it('says so when the device never reported a position', () => {
    render(<LocationCell loc={null} />);
    expect(screen.getByText('No location yet')).toBeInTheDocument();
  });
});
