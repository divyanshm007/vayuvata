import { Link, Typography } from '@mui/material';
import { fmtWallClock } from '../../utils/format';
import type { DeviceLastLocation } from '../../types/api';

/**
 * "Location" column: the place name of the device's newest reported position (area, city, state), opening in a map, with when it was recorded.
 * Until the name has been looked up the coordinates are shown instead; they are always in the tooltip. Same for every role.
 */
export function LocationCell({ loc }: { loc: DeviceLastLocation | null | undefined }) {
  if (!loc) return <Typography variant="body2" color="text.secondary">No location yet</Typography>;
  const lat = loc.latitude.toFixed(5), lon = loc.longitude.toFixed(5);
  return (
    <>
      <Link href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`} target="_blank" rel="noopener noreferrer" underline="hover" variant="body2" fontWeight={600}
        title={`${lat}, ${lon}`} aria-label={`Open ${loc.name ?? `${lat}, ${lon}`} on the map`}>{loc.name ?? `${lat}, ${lon}`}</Link>
      <Typography variant="caption" display="block" color="text.secondary">{fmtWallClock(loc.recordedAt, true)}{loc.source === 'cell' ? ' · approximate (cell)' : ''}</Typography>
    </>
  );
}
