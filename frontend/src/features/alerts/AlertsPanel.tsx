import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { alertsApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { fmtUtc } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { CATEGORY_LABEL, StatusChip, TYPE_LABEL } from './alertLabels';

const Tile = ({ label, value, color }: { label: string; value: number | string; color: string }) => (
  <Box sx={{ flex: '1 1 120px', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', borderLeft: `4px solid ${color}` }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="h5" fontWeight={800}>{value}</Typography>
  </Box>
);

/**
 * Dashboard section: how many devices are Normal, how many alerts are Warning or Critical, what was Resolved lately, and the alerts that need attention.
 * Maintenance reminders, machine errors and abnormal readings stay separate (each row names its category). The server decides what each role may see:
 * Super Admin everything, Admin their devices (abnormal readings once escalated), User only escalated abnormal readings of their devices.
 */
export function AlertsPanel() {
  const { role } = useAuth();
  const summary = useAsync(() => alertsApi.summary(), []);
  const list = useAsync(() => alertsApi.list({ page: 1, pageSize: 6 }), []);
  const s = summary.data;
  const items = list.data?.items ?? [];
  return (
    <Card sx={{ p: 2.5, mb: 2 }} aria-label="Alerts">
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1} sx={{ mb: 1.5 }}>
        <Box>
          <Typography fontWeight={800}>Alerts</Typography>
          <Typography variant="body2" color="text.secondary">{role === 'User' ? 'Serious air-quality changes on your devices.' : 'Maintenance reminders, machine errors and abnormal readings.'}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" component={RouterLink} to="/alerts">View all alerts</Button>
          {role === 'SuperAdmin' && <Button size="small" variant="outlined" component={RouterLink} to="/settings/alert-configuration">Configure</Button>}
        </Stack>
      </Stack>
      {summary.loading && !s && <CircularProgress size={22} aria-label="Loading alerts" />}
      {s && (
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 2 }}>
          <Tile label="Normal devices" value={`${s.normalDevices} / ${s.totalDevices}`} color="#16A34A" />
          <Tile label="Warning" value={s.warningAlerts} color="#F59E0B" />
          <Tile label="Critical" value={s.criticalAlerts} color="#DC2626" />
          <Tile label="Resolved (7 days)" value={s.resolvedLast7Days} color="#0EA5E9" />
        </Stack>
      )}
      {s && role !== 'User' && (s.maintenanceOpen + s.machineErrorsOpen + s.abnormalReadingsOpen > 0) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Open: {s.maintenanceOpen} maintenance · {s.machineErrorsOpen} machine error(s) · {s.abnormalReadingsOpen} abnormal reading(s)
        </Typography>)}
      {!list.loading && items.length === 0 && <Typography color="text.secondary">No alerts need attention.</Typography>}
      {items.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="Active alerts">
            <TableHead><TableRow><TableCell>Status</TableCell><TableCell>Device</TableCell><TableCell>Category</TableCell><TableCell>Alert</TableCell><TableCell>Since</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell><StatusChip status={a.status} /></TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{a.deviceId}</TableCell>
                  <TableCell>{CATEGORY_LABEL[a.category]}</TableCell>
                  <TableCell>{TYPE_LABEL[a.alertType] ?? a.alertType}</TableCell>
                  <TableCell>{fmtUtc(a.startedAt)}</TableCell>
                  <TableCell>{a.detail ?? ''}</TableCell>
                </TableRow>))}
            </TableBody>
          </Table>
        </TableContainer>)}
    </Card>
  );
}
