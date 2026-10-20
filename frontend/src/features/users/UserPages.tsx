import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, Button, Card, Grid, LinearProgress, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Link } from '@mui/material';
import { usersApi } from '../../api/services';
import { ActiveChip, PageHeader, PaginationBar, RoleChip } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback';
import { fmtUtc } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';
import { useAuth } from '../auth/AuthContext';
import UsersListView from './UsersListView';

/** SuperAdmin: every account with role / scope filters. Admin: their own users (backend-scoped). */
export function UsersPage() {
  const { role } = useAuth();
  const isSA = role === 'SuperAdmin';
  const [scope, setScope] = useState('');
  return (
    <UsersListView
      title={isSA ? 'Users' : 'My Users'}
      subtitle={isSA ? 'Regular users. Admins are managed under Admin Management.' : 'Users you manage'}
      crumbs={[{ label: 'Home', to: '/' }, { label: isSA ? 'Users' : 'My Users' }]}
      // The SuperAdmin's list is regular Users only: Admin accounts live under "Admin Management" (and the SuperAdmin account is not a "user").
      fetch={(p) => usersApi.list({ ...p, role: isSA ? 'User' : undefined, standalone: scope === '' ? undefined : scope === 'standalone' })}
      fetchDeps={[scope]}
      filters={isSA && (
        <>
          <TextField select label="Managed by" value={scope} onChange={(e) => setScope(e.target.value)} sx={{ maxWidth: { md: 200 } }}>
            <MenuItem value="">Anyone</MenuItem><MenuItem value="standalone">Me (standalone)</MenuItem><MenuItem value="admin">An admin</MenuItem>
          </TextField>
        </>
      )}
      createKind="User" createLabel="Create user"
      rowLink={(u) => `/users/${u.id}`}
      showManager={isSA}
      emptyTitle={isSA ? 'No users found' : 'You have no users yet'} emptyHint={isSA ? 'Try different filters, or create a user.' : 'Create your first user to get started.'}
    />
  );
}

/** SuperAdmin only: Admin accounts; open one to see and manage the users under it. */
export function AdminsPage() {
  return (
    <UsersListView
      title="Admin Management" subtitle="Admin accounts and the users they manage"
      crumbs={[{ label: 'Home', to: '/' }, { label: 'Admin Management' }]}
      fetch={(p) => usersApi.list({ ...p, role: 'Admin' })}
      createKind="Admin" createLabel="Create admin" rowLink={(u) => `/admins/${u.id}`}
      emptyTitle="No admins yet" emptyHint="Create an admin to delegate user management."
    />
  );
}

/** Users managed by one Admin (GET /admins/{id}/users). SuperAdmin; an Admin may only open their own id. */
export function AdminUsersPage() {
  const adminId = Number(useParams().id);
  const info = useAsync(() => usersApi.get(adminId), [adminId]);
  const name = info.data?.name ?? `Admin #${adminId}`;
  if (info.error) return <ErrorState error={info.error} onRetry={info.reload} />;
  return (
    <UsersListView
      title={name} subtitle={info.data ? `${info.data.email} · users managed by this admin` : undefined}
      crumbs={[{ label: 'Home', to: '/' }, { label: 'Admin Management', to: '/admins' }, { label: name }]}
      fetch={(p) => usersApi.byAdmin(adminId, p)} fetchDeps={[adminId]}
      createKind="User" createLabel="Add user" adminId={adminId} adminName={info.data?.name}
      rowLink={(u) => `/users/${u.id}`} showManager={false}
      emptyTitle="This admin has no users" emptyHint="Add a user to this admin."
    />
  );
}

export function UserDetailPage() {
  const id = Number(useParams().id);
  const { role } = useAuth();
  const u = useAsync(() => usersApi.get(id), [id]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const devices = useAsync(() => usersApi.devices(id, { page, pageSize: size }), [id, page, size], u.data?.role === 'User');
  if (u.error) return <ErrorState error={u.error} onRetry={u.reload} />;
  const d = u.data;
  const field = (k: string, v: React.ReactNode) => (
    <Grid item xs={12} sm={6} key={k}><Typography variant="caption" color="text.secondary">{k}</Typography><Box sx={{ fontWeight: 600, mt: 0.25 }}>{v}</Box></Grid>
  );
  return (
    <>
      <PageHeader title={d?.name ?? 'User'} subtitle={d?.email}
        crumbs={[{ label: 'Home', to: '/' }, { label: role === 'SuperAdmin' ? 'Users' : 'My Users', to: '/users' }, { label: d?.name ?? '…' }]}
        actions={d?.managerId && d.managerRole === 'Admin' && role === 'SuperAdmin' ? <Button component={RouterLink} to={`/admins/${d.managerId}`} variant="outlined">View admin</Button> : undefined} />
      {u.loading && <LinearProgress />}
      {d && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card sx={{ p: 2.5, height: '100%' }}>
              <Grid container spacing={2.5}>
                {field('Role', <RoleChip role={d.role} />)}
                {field('Status', <ActiveChip active={d.isActive} />)}
                {d.role === 'User' && field('Manager', d.managerName ? `${d.managerName} (${d.managerRole})` : '—')}
                {d.role === 'User' && field('Assignment', d.assignmentType === 'Standalone' ? 'Standalone' : 'Admin-managed')}
                {field('Created', fmtUtc(d.createdAt))}
                {field('Last updated', fmtUtc(d.updatedAt))}
                {field('Last sign-in', fmtUtc(d.lastLoginAt))}
              </Grid>
            </Card>
          </Grid>
          {d.role === 'User' && (
            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%' }}>
                <Typography fontWeight={700} sx={{ p: 2.5, pb: 1 }}>Assigned devices</Typography>
                <TableContainer>
                  <Table size="small" aria-label="Assigned devices">
                    <TableHead><TableRow><TableCell>Device</TableCell><TableCell>ID</TableCell><TableCell>Status</TableCell><TableCell>Assigned</TableCell></TableRow></TableHead>
                    <TableBody>
                      {devices.data?.items.map((x) => (
                        <TableRow key={x.id} hover>
                          <TableCell><Link component={RouterLink} to={`/devices/${x.id}`} underline="hover" fontWeight={600}>{x.deviceName}</Link></TableCell>
                          <TableCell>{x.deviceId}</TableCell><TableCell><ActiveChip active={x.isActive} /></TableCell><TableCell>{fmtUtc(x.assignedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {devices.loading && <TableSkeleton cols={4} rows={3} />}
                {!!devices.error && <ErrorState error={devices.error} onRetry={devices.reload} />}
                {!devices.loading && !devices.error && devices.data?.items.length === 0 && <EmptyState title="No devices assigned" />}
                <PaginationBar page={page} result={devices.data} pageSize={size} onPage={setPage} onPageSize={setSize} />
              </Card>
            </Grid>
          )}
        </Grid>
      )}
    </>
  );
}
