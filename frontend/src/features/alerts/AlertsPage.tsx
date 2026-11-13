import { useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { PageHeader, PaginationBar } from '../../components/ui';
import { EmptyState, ErrorState, useToast } from '../../components/feedback';
import { alertsApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import { fmtUtc } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { CATEGORY_LABEL, StatusChip, TYPE_LABEL } from './alertLabels';
import type { AlertCategoryName, MaintenanceItem } from '../../types/api';

const CATEGORIES: AlertCategoryName[] = ['Maintenance', 'MachineError', 'AbnormalReading'];

function Filters({ category, setCategory, status, setStatus, statuses }: { category: string; setCategory: (v: string) => void; status: string; setStatus: (v: string) => void; statuses: string[] }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
      <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 200 }}>
        <MenuItem value="">All categories</MenuItem>{CATEGORIES.map((c) => <MenuItem key={c} value={c}>{CATEGORY_LABEL[c]}</MenuItem>)}
      </TextField>
      <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 200 }}>
        <MenuItem value="">All</MenuItem>{statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
      </TextField>
    </Stack>
  );
}

function ActiveTab() {
  const [category, setCategory] = useState(''); const [status, setStatus] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const list = useAsync(() => alertsApi.list({ category: category || undefined, status: status || undefined, page, pageSize }), [category, status, page, pageSize]);
  return (
    <>
      <Filters category={category} setCategory={(v) => { setCategory(v); setPage(1); }} status={status} setStatus={(v) => { setStatus(v); setPage(1); }} statuses={['Warning', 'Critical', 'Resolved']} />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <CircularProgress aria-label="Loading" /> : (list.data?.items.length ?? 0) === 0 ? <EmptyState title={status === 'Resolved' ? 'No resolved alerts' : 'No alerts need attention'} /> : (
        <TableContainer>
          <Table size="small" aria-label="Alerts">
            <TableHead><TableRow><TableCell>Status</TableCell><TableCell>Device</TableCell><TableCell>Category</TableCell><TableCell>Alert</TableCell><TableCell>Started</TableCell><TableCell>Resolved</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
            <TableBody>{list.data!.items.map((a) => (
              <TableRow key={a.id} hover>
                <TableCell><StatusChip status={a.status} /></TableCell><TableCell sx={{ fontWeight: 600 }}>{a.deviceId}</TableCell><TableCell>{CATEGORY_LABEL[a.category]}</TableCell>
                <TableCell>{TYPE_LABEL[a.alertType] ?? a.alertType}</TableCell><TableCell>{fmtUtc(a.startedAt)}</TableCell><TableCell>{a.resolvedAt ? fmtUtc(a.resolvedAt) : '—'}</TableCell><TableCell>{a.detail ?? ''}</TableCell>
              </TableRow>))}</TableBody>
          </Table>
        </TableContainer>)}
      <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

function MaintCell({ item, deviceId, label, onDone }: { item: MaintenanceItem; deviceId: string; label: string; onDone: (d: string, t: MaintenanceItem['alertType']) => Promise<void> }) {
  return (
    <TableCell>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <StatusChip status={item.status} />
        <Typography variant="body2">{item.daysLeft >= 0 ? `due ${fmtUtc(item.dueAt).split(',')[0]} (${item.daysLeft} d)` : `overdue ${-item.daysLeft} d`}</Typography>
        <Button size="small" onClick={() => void onDone(deviceId, item.alertType)} aria-label={`${label} ${deviceId}`}>{label}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">{item.lastDoneAt ? `Last done ${fmtUtc(item.lastDoneAt)}` : 'Counted from registration'}</Typography>
    </TableCell>
  );
}

function MaintenanceTab() {
  const toast = useToast();
  const m = useAsync(() => alertsApi.maintenance(), []);
  const [err, setErr] = useState<string | null>(null);
  const done = async (deviceId: string, type: MaintenanceItem['alertType']) => {
    setErr(null);
    try { await alertsApi.done(deviceId, type); toast(type === 'FilterReplacement' ? 'Filter replacement recorded.' : 'Bin cleaning recorded.', 'success'); m.reload(); }
    catch (e) { setErr(toAppError(e).message); }
  };
  if (m.error) return <ErrorState error={m.error} onRetry={m.reload} />;
  if (m.loading && !m.data) return <CircularProgress aria-label="Loading" />;
  if ((m.data?.length ?? 0) === 0) return <EmptyState title="No devices" />;
  return (
    <>
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>{err}</Alert>}
      <TableContainer>
        <Table size="small" aria-label="Maintenance">
          <TableHead><TableRow><TableCell>Device</TableCell><TableCell>Filter replacement</TableCell><TableCell>Bin cleaning</TableCell></TableRow></TableHead>
          <TableBody>{m.data!.map((d) => (
            <TableRow key={d.deviceId} hover>
              <TableCell sx={{ fontWeight: 600 }}>{d.deviceName}<Typography variant="caption" display="block" color="text.secondary">{d.deviceId}</Typography></TableCell>
              <MaintCell item={d.filter} deviceId={d.deviceId} label="Mark replaced" onDone={done} />
              <MaintCell item={d.bin} deviceId={d.deviceId} label="Mark cleaned" onDone={done} />
            </TableRow>))}</TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function HistoryTab() {
  const [category, setCategory] = useState(''); const [status, setStatus] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const h = useAsync(() => alertsApi.history({ category: category || undefined, status: status || undefined, page, pageSize }), [category, status, page, pageSize]);
  return (
    <>
      <Filters category={category} setCategory={(v) => { setCategory(v); setPage(1); }} status={status} setStatus={(v) => { setStatus(v); setPage(1); }} statuses={['Normal', 'Warning', 'Critical', 'Resolved']} />
      {h.error ? <ErrorState error={h.error} onRetry={h.reload} /> : h.loading && !h.data ? <CircularProgress aria-label="Loading" /> : (h.data?.items.length ?? 0) === 0 ? <EmptyState title="No alert history yet" /> : (
        <TableContainer>
          <Table size="small" aria-label="Alert history">
            <TableHead><TableRow><TableCell>Date and time</TableCell><TableCell>Device ID</TableCell><TableCell>Category</TableCell><TableCell>Alert type</TableCell><TableCell>Status</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
            <TableBody>{h.data!.items.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell>{fmtUtc(e.at)}</TableCell><TableCell sx={{ fontWeight: 600 }}>{e.deviceId}</TableCell><TableCell>{CATEGORY_LABEL[e.category]}</TableCell>
                <TableCell>{TYPE_LABEL[e.alertType] ?? e.alertType}</TableCell><TableCell><StatusChip status={e.status} /></TableCell><TableCell>{e.detail ?? ''}</TableCell>
              </TableRow>))}</TableBody>
          </Table>
        </TableContainer>)}
      <PaginationBar page={page} result={h.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

/** Alerts: what needs attention now, the filter / bin maintenance schedule (Super Admin and Admin), and the full history. */
export default function AlertsPage() {
  const { role } = useAuth();
  const canMaint = role === 'SuperAdmin' || role === 'Admin';
  const [tab, setTab] = useState<'active' | 'maintenance' | 'history'>('active');
  return (
    <>
      <PageHeader title="Alerts" subtitle={role === 'User' ? 'Serious air-quality changes on your devices.' : 'Maintenance reminders, machine errors and abnormal readings, kept separate.'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Alerts' }]}
        actions={role === 'SuperAdmin' ? <Button variant="outlined" href="/settings/alert-configuration">Alert configuration</Button> : undefined} />
      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Alert sections">
          <Tab value="active" label="Alerts" />
          {canMaint && <Tab value="maintenance" label="Maintenance" />}
          <Tab value="history" label="History" />
        </Tabs>
        <Box sx={{ p: 2 }}>
          {tab === 'active' && <ActiveTab />}
          {tab === 'maintenance' && canMaint && <MaintenanceTab />}
          {tab === 'history' && <HistoryTab />}
        </Box>
      </Card>
    </>
  );
}
