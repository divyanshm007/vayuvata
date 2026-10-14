import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Card, Grid, InputAdornment, Link, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LinkIcon from '@mui/icons-material/Link';
import LinkOff from '@mui/icons-material/LinkOff';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import { devicesApi } from '../../api/services';
import type { DeviceDto } from '../../types/api';
import { ActiveChip, PageHeader, PaginationBar, StatCard } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, TableSkeleton, useToast } from '../../components/feedback';
import { fmtUtc } from '../../utils/format';
import { errorMessage } from '../../utils/errors';
import { useAsync, useDebounced } from '../../utils/useAsync';
import { AssignDeviceDialog } from './DeviceDialogs';

type Tab_ = 'all' | 'assigned' | 'unassigned';

/** Assignment-focused view: who has which device, since when, and quick assign / reassign / release. Device admin lives on Devices. */
export default function AssignmentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab_>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [assign, setAssign] = useState<DeviceDto | null>(null);
  const [release, setRelease] = useState<DeviceDto | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useAsync(
    () => devicesApi.list({ search: q || undefined, assigned: tab === 'all' ? undefined : tab === 'assigned', page, pageSize }),
    [q, tab, page, pageSize],
  );
  const counts = useAsync(async () => {
    const c = (assigned?: boolean) => devicesApi.list({ page: 1, pageSize: 1, assigned }).then((r) => r.totalCount ?? 0);
    const [all, assigned, unassigned] = await Promise.all([c(), c(true), c(false)]);
    return { all, assigned, unassigned };
  }, []);

  const refresh = () => { list.reload(); counts.reload(); };

  const confirmRelease = async () => {
    if (!release) return;
    setBusy(true);
    try { await devicesApi.unassign(release.id); toast('Device unassigned.'); setRelease(null); refresh(); }
    catch (e) { toast(errorMessage(e), 'error'); setRelease(null); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Device Assignments" subtitle="Who has which device. Assign, reassign or release devices; history is kept."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Device Assignments' }]} />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={4}><StatCard label="Total devices" icon={SensorsOutlined} loading={counts.loading} value={counts.data?.all ?? '—'} accent="#0ea5e9" /></Grid>
        <Grid item xs={4}><StatCard label="Assigned" icon={LinkIcon} loading={counts.loading} value={counts.data?.assigned ?? '—'} accent="#16a34a" /></Grid>
        <Grid item xs={4}><StatCard label="Unassigned" icon={LinkOff} loading={counts.loading} value={counts.data?.unassigned ?? '—'} accent="#d97706" /></Grid>
      </Grid>

      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ px: 2, pt: 1 }}>
          <Tabs value={tab} onChange={(_, v: Tab_) => { setTab(v); setPage(1); }} aria-label="Assignment filter">
            <Tab value="all" label="All" /><Tab value="assigned" label="Assigned" /><Tab value="unassigned" label="Unassigned" />
          </Tabs>
          <TextField placeholder="Search device or ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ maxWidth: { md: 300 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} inputProps={{ 'aria-label': 'Search devices' }} />
        </Stack>
        <TableContainer>
          <Table size="small" aria-label="Device assignments">
            <TableHead><TableRow>
              <TableCell>Device</TableCell><TableCell>Assigned to</TableCell><TableCell>Assigned since</TableCell><TableCell>Device status</TableCell><TableCell align="right">Assignment</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {list.data?.items.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/devices/${d.id}`} underline="hover" fontWeight={600}>{d.deviceName}</Link>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{d.deviceId}</Typography>
                  </TableCell>
                  <TableCell>{d.assignedUserName
                    ? <Box><Typography fontWeight={600} variant="body2">{d.assignedUserName}</Typography></Box>
                    : <Typography variant="body2" color="warning.main" fontWeight={600}>Unassigned</Typography>}</TableCell>
                  <TableCell>{d.assignedUserId ? fmtUtc(d.assignedAt) : '—'}</TableCell>
                  <TableCell><ActiveChip active={d.isActive} /></TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button size="small" variant={d.assignedUserId ? 'outlined' : 'contained'} startIcon={<LinkIcon />} disabled={!d.isActive}
                        title={d.isActive ? undefined : 'Inactive devices cannot be assigned'} onClick={() => setAssign(d)}>
                        {d.assignedUserId ? 'Reassign' : 'Assign'}
                      </Button>
                      {d.assignedUserId && <Button size="small" color="inherit" startIcon={<LinkOff />} onClick={() => setRelease(d)}>Unassign</Button>}
                      <Button size="small" color="inherit" component={RouterLink} to={`/devices/${d.id}`} startIcon={<HistoryOutlined />} aria-label={`History for ${d.deviceName}`}>History</Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {list.loading && <TableSkeleton cols={5} />}
        {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && list.data?.items.length === 0 && (
          <EmptyState title={tab === 'unassigned' ? 'Every device is assigned' : tab === 'assigned' ? 'No devices are assigned yet' : 'No devices found'} hint="Try another tab or search." />
        )}
        <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <AssignDeviceDialog device={assign} onClose={() => setAssign(null)} onDone={() => { setAssign(null); refresh(); }} />
      <ConfirmDialog open={!!release} busy={busy} danger onClose={() => setRelease(null)} onConfirm={confirmRelease} title="Unassign device?" confirmLabel="Unassign"
        body={release && <><b>{release.deviceName}</b> will no longer be assigned to {release.assignedUserName}. The assignment history is kept.</>} />
    </>
  );
}
