import { useMemo, useState } from 'react';
import { Box, Card, Chip, InputAdornment, List, ListItemButton, Skeleton, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import LocationOffOutlined from '@mui/icons-material/LocationOffOutlined';
import type { SensorDataDto } from '../../../types/api';
import { AqiBadge } from '../../../components/ui';
import { EmptyState } from '../../../components/feedback';
import { tokens } from '../../../theme/theme';
import type { DeviceLocation } from '../types';
import { fmtAge } from '../utils/locations';

interface Props {
  locations: DeviceLocation[];
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  readingFor: (loc: DeviceLocation) => SensorDataDto | null | undefined;
  showAssignment: boolean;
  loading?: boolean;
  maxHeight?: number | string;
}

function availability(l: DeviceLocation): { label: string; color: string; bg: string } {
  if (!l.position) {
    return l.latest ? { label: 'No GPS fix', color: '#92400E', bg: '#FEF3C7' } : { label: 'No GPS data', color: '#475569', bg: '#F1F5F4' };
  }
  return l.stale ? { label: 'Stale', color: '#92400E', bg: '#FEF3C7' } : { label: 'Located', color: '#166534', bg: '#DCFCE7' };
}

/** Searchable device list. Selecting a device with a position centres the map on it; devices without GPS stay listed. */
export function DeviceListPanel({ locations, selectedId, onSelect, readingFor, showAssignment, loading, maxHeight = 560 }: Props) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? locations.filter((l) => l.device.deviceId.toLowerCase().includes(needle) || (l.device.deviceName ?? '').toLowerCase().includes(needle))
      : locations;
    // devices with a position first, then by name
    return [...filtered].sort((a, b) => Number(!!b.position) - Number(!!a.position) || (a.device.deviceName ?? a.device.deviceId).localeCompare(b.device.deviceName ?? b.device.deviceId));
  }, [locations, q]);

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight, overflow: 'hidden' }}>
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search device ID or name" inputProps={{ 'aria-label': 'Search devices' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.75, pb: 0.75 }}>
        {loading ? (
          <Box sx={{ p: 1 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={64} sx={{ mb: 1 }} />)}</Box>
        ) : rows.length === 0 ? (
          <EmptyState title={q ? 'No matching devices' : 'No devices'} hint={q ? 'Try another ID or name.' : undefined} />
        ) : (
          <List disablePadding aria-label="Devices">
            {rows.map((l) => {
              const a = availability(l);
              const reading = readingFor(l);
              const selected = l.device.deviceId === selectedId;
              const located = !!l.position;
              return (
                <ListItemButton
                  key={l.device.deviceId} selected={selected} onClick={() => onSelect(l.device.deviceId)} aria-label={`Select device ${l.device.deviceId}`}
                  sx={{
                    alignItems: 'flex-start', gap: 1.25, borderRadius: '10px', mb: 0.5, border: '1px solid transparent', py: 1,
                    '&.Mui-selected': { bgcolor: '#E3F6EA', borderColor: '#86C99C' }, '&.Mui-selected:hover': { bgcolor: '#D6F3E1' },
                  }}
                >
                  <Box sx={{ mt: 0.25, color: located ? tokens.action : '#94a3b8' }}>{located ? <PlaceOutlined fontSize="small" /> : <LocationOffOutlined fontSize="small" />}</Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Typography sx={{ fontWeight: 700, fontSize: 13 }} noWrap>{l.device.deviceName || l.device.deviceId}</Typography>
                      <Chip size="small" label={a.label} sx={{ bgcolor: a.bg, color: a.color, height: 20 }} />
                    </Stack>
                    <Typography sx={{ fontSize: 11.5, color: tokens.muted, fontFamily: 'ui-monospace, Consolas, monospace' }}>{l.device.deviceId}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      <Typography sx={{ fontSize: 11.5, color: tokens.muted }}>
                        {l.position ? `GPS ${fmtAge(l.ageMs)}` : l.latest ? `No fix ${fmtAge(Math.max(0, Date.now() - l.latest.recordedMs))}` : 'Never reported'}
                      </Typography>
                      {reading && reading.aqi !== null && <AqiBadge aqi={reading.aqi} status={reading.aqiStatus} />}
                      {showAssignment && <Typography sx={{ fontSize: 11.5, color: tokens.muted }}>· {l.device.assignedUserName ?? 'Unassigned'}</Typography>}
                    </Stack>
                  </Box>
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Box>
    </Card>
  );
}
