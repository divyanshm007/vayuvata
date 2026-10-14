import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Button, Card, IconButton, InputAdornment, ListItemIcon, ListItemText, Menu, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography, Link,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import MoreVert from '@mui/icons-material/MoreVert';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import LinkIcon from '@mui/icons-material/Link';
import LinkOff from '@mui/icons-material/LinkOff';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { devicesApi } from '../../api/services';
import type { DeviceDto, DeviceWithKeyDto } from '../../types/api';
import { ActiveChip, AqiBadge, AssignedChip, PageHeader, PaginationBar, ReportingChip } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, TableSkeleton, useToast } from '../../components/feedback';
import { fmtWallClock, isRecentlyReporting } from '../../utils/format';
import { errorMessage } from '../../utils/errors';
import { useAsync, useDebounced } from '../../utils/useAsync';
import { useAuth } from '../auth/AuthContext';
import { useLatest } from '../sensor-data/useLatest';
import { ApiKeyDialog, AssignDeviceDialog, EditDeviceDialog, KeyHashDialog, RegisterDeviceDialog } from './DeviceDialogs';

type Pending = { kind: 'status' | 'rotate' | 'unassign'; device: DeviceDto } | null;

export default function DevicesPage() {
  const { role } = useAuth();
  const isSA = role === 'SuperAdmin';
  const canAssign = role === 'SuperAdmin' || role === 'Admin';
  const toast = useToast();

  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const list = useAsync(
    () => devicesApi.list({
      search: q || undefined, page, pageSize,
      isActive: status === '' ? undefined : status === 'active', assigned: assigned === '' ? undefined : assigned === 'assigned',
    }),
    [q, status, assigned, page, pageSize],
  );
  const latest = useLatest(list.data?.items ?? [], !list.loading);
  const latestFor = (id: number) => latest.items.find((i) => i.device.id === id)?.latest;

  const [menu, setMenu] = useState<{ el: HTMLElement; device: DeviceDto } | null>(null);
  const [register, setRegister] = useState(false);
  const [edit, setEdit] = useState<DeviceDto | null>(null);
  const [assign, setAssign] = useState<DeviceDto | null>(null);
  const [hashDevice, setHashDevice] = useState<DeviceDto | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [keyDevice, setKeyDevice] = useState<{ d: DeviceWithKeyDto; title: string } | null>(null);

  const patch = (d: DeviceDto) => list.setData(list.data ? { ...list.data, items: list.data.items.map((x) => (x.id === d.id ? d : x)) } : list.data);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'status') { patch(await devicesApi.setStatus(pending.device.id, !pending.device.isActive)); toast(pending.device.isActive ? 'Device deactivated.' : 'Device activated.'); }
      if (pending.kind === 'unassign') { patch(await devicesApi.unassign(pending.device.id)); toast('Device unassigned.'); }
      if (pending.kind === 'rotate') { const d = await devicesApi.rotateKey(pending.device.id); setKeyDevice({ d, title: 'New device API key' }); }
      setPending(null);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  const title = role === 'User' ? 'My Devices' : 'Devices';
  const colSpan = 8;

  return (
    <>
      <PageHeader title={title}
        subtitle={role === 'User' ? 'Devices assigned to you' : 'Registered devices and their status'}
        crumbs={[{ label: 'Home', to: '/' }, { label: title }]}
        actions={isSA ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setRegister(true)}>Register device</Button> : undefined} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField placeholder="Search name or device ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} inputProps={{ 'aria-label': 'Search devices' }} sx={{ maxWidth: { md: 340 } }} />
          {role !== 'User' && (
            <>
              <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ maxWidth: { md: 170 } }}>
                <MenuItem value="">All</MenuItem><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem>
              </TextField>
              <TextField select label="Assignment" value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1); }} sx={{ maxWidth: { md: 190 } }}>
                <MenuItem value="">All</MenuItem><MenuItem value="assigned">Assigned</MenuItem><MenuItem value="unassigned">Unassigned</MenuItem>
              </TextField>
            </>
          )}
        </Stack>
        <TableContainer>
          <Table size="small" aria-label="Devices">
            <TableHead><TableRow>
              <TableCell>Device</TableCell><TableCell>Device ID</TableCell><TableCell>Status</TableCell><TableCell>Reporting</TableCell>
              <TableCell>Assigned to</TableCell><TableCell>Last reading</TableCell><TableCell>Latest AQI</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {list.data?.items.map((d) => {
                const r = latestFor(d.id);
                const loadingLatest = latest.loading;
                return (
                  <TableRow key={d.id} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/devices/${d.id}`} underline="hover" fontWeight={600}>{d.deviceName}</Link>
                      {d.description && <Typography variant="caption" display="block" color="text.secondary" noWrap sx={{ maxWidth: 240 }}>{d.description}</Typography>}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}>{d.deviceId}</TableCell>
                    <TableCell><ActiveChip active={d.isActive} /></TableCell>
                    <TableCell>{loadingLatest ? <Skeleton width={80} /> : <ReportingChip known={!!r} reporting={isRecentlyReporting(r?.recordedAt)} />}</TableCell>
                    <TableCell><AssignedChip name={d.assignedUserName} /></TableCell>
                    <TableCell>{loadingLatest ? <Skeleton width={90} /> : fmtWallClock(r?.recordedAt)}</TableCell>
                    <TableCell>{loadingLatest ? <Skeleton width={70} /> : r ? <AqiBadge aqi={r.aqi} status={r.aqiStatus} /> : '—'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Open"><IconButton size="small" component={RouterLink} to={`/devices/${d.id}`} aria-label={`Open ${d.deviceName}`}><OpenInNew fontSize="small" /></IconButton></Tooltip>
                      {canAssign && <IconButton size="small" aria-label={`Actions for ${d.deviceName}`} onClick={(e) => setMenu({ el: e.currentTarget, device: d })}><MoreVert fontSize="small" /></IconButton>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {list.loading && <TableSkeleton cols={colSpan} />}
        {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && list.data?.items.length === 0 && (
          <EmptyState title={role === 'User' ? 'No devices assigned to you yet' : 'No devices found'} hint={role === 'User' ? 'Ask your administrator to assign a device.' : 'Try different filters.'} />
        )}
        <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && (() => {
          const d = menu.device; const close = () => setMenu(null);
          return [
            isSA && <MenuItem key="e" onClick={() => { close(); setEdit(d); }}><ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon><ListItemText>Edit</ListItemText></MenuItem>,
            d.isActive && <MenuItem key="a" onClick={() => { close(); setAssign(d); }}><ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon><ListItemText>{d.assignedUserId ? 'Reassign…' : 'Assign…'}</ListItemText></MenuItem>,
            d.assignedUserId && <MenuItem key="u" onClick={() => { close(); setPending({ kind: 'unassign', device: d }); }}><ListItemIcon><LinkOff fontSize="small" /></ListItemIcon><ListItemText>Unassign</ListItemText></MenuItem>,
            isSA && <MenuItem key="s" onClick={() => { close(); setPending({ kind: 'status', device: d }); }}><ListItemIcon><PowerSettingsNew fontSize="small" /></ListItemIcon><ListItemText>{d.isActive ? 'Deactivate' : 'Activate'}</ListItemText></MenuItem>,
            isSA && <MenuItem key="h" onClick={() => { close(); setHashDevice(d); }}><ListItemIcon><BadgeOutlined fontSize="small" /></ListItemIcon><ListItemText>Show device key (hash)</ListItemText></MenuItem>,
            isSA && <MenuItem key="k" onClick={() => { close(); setPending({ kind: 'rotate', device: d }); }}><ListItemIcon><VpnKeyOutlined fontSize="small" /></ListItemIcon><ListItemText>Rotate API key…</ListItemText></MenuItem>,
          ].filter(Boolean);
        })()}
      </Menu>

      <RegisterDeviceDialog open={register} onClose={() => setRegister(false)} onCreated={(d) => { setRegister(false); setKeyDevice({ d, title: 'Device registered' }); list.reload(); }} />
      <EditDeviceDialog device={edit} onClose={() => setEdit(null)} onSaved={(d) => { setEdit(null); patch(d); }} />
      <AssignDeviceDialog device={assign} onClose={() => setAssign(null)} onDone={(d) => { setAssign(null); patch(d); }} />
      <KeyHashDialog device={hashDevice} onClose={() => setHashDevice(null)} />
      <ApiKeyDialog device={keyDevice?.d ?? null} title={keyDevice?.title ?? ''} onClose={() => setKeyDevice(null)} />

      <ConfirmDialog
        open={!!pending} busy={busy} onClose={() => setPending(null)} onConfirm={confirm} danger={pending?.kind !== 'status' || !!pending?.device.isActive}
        title={pending?.kind === 'rotate' ? 'Rotate API key?' : pending?.kind === 'unassign' ? 'Unassign device?' : pending?.device.isActive ? 'Deactivate device?' : 'Activate device?'}
        confirmLabel={pending?.kind === 'rotate' ? 'Rotate key' : pending?.kind === 'unassign' ? 'Unassign' : pending?.device.isActive ? 'Deactivate' : 'Activate'}
        body={pending && (
          pending.kind === 'rotate' ? <>A new key will be issued for <b>{pending.device.deviceName}</b> and shown once. <b>The previous key and its hash stop working immediately</b>, so the device cannot send data until it is reflashed.</>
          : pending.kind === 'unassign' ? <><b>{pending.device.deviceName}</b> will no longer be assigned to {pending.device.assignedUserName}. The assignment history is kept.</>
          : pending.device.isActive ? <>An inactive device cannot ingest readings or be assigned. <b>{pending.device.deviceName}</b> will stop reporting until reactivated.</>
          : <><b>{pending.device.deviceName}</b> will be able to ingest readings and be assigned again.</>
        )}
      />
    </>
  );
}
