import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Button, Card, IconButton, InputAdornment, Link, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import MoreVert from '@mui/icons-material/MoreVert';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import LockResetOutlined from '@mui/icons-material/LockResetOutlined';
import SwapHoriz from '@mui/icons-material/SwapHoriz';
import { usersApi } from '../../api/services';
import type { PagedResult, UserDto } from '../../types/api';
import { ActiveChip, PageHeader, PaginationBar, RoleChip, type Crumb } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, TableSkeleton, useToast } from '../../components/feedback';
import { fmtUtc } from '../../utils/format';
import { errorMessage } from '../../utils/errors';
import { useAsync, useDebounced } from '../../utils/useAsync';
import { useAuth } from '../auth/AuthContext';
import { CreateUserDialog, EditUserDialog, ReassignManagerDialog, ResetPasswordDialog } from './UserDialogs';

export interface ListParams { search?: string; isActive?: boolean; page: number; pageSize: number }

interface Props {
  title: string; subtitle?: string; crumbs: Crumb[];
  fetch: (p: ListParams) => Promise<PagedResult<UserDto>>;
  /** Re-fetch when these change (parent-owned filters). */
  fetchDeps?: unknown[];
  filters?: ReactNode;
  createKind?: 'Admin' | 'User'; createLabel?: string; adminId?: number; adminName?: string;
  /** Link target for a row's name. */
  rowLink?: (u: UserDto) => string;
  showRole?: boolean; showManager?: boolean;
  emptyTitle?: string; emptyHint?: string;
}

export default function UsersListView(p: Props) {
  const { role, user: me } = useAuth();
  const isSA = role === 'SuperAdmin';
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const list = useAsync(
    () => p.fetch({ search: q || undefined, isActive: status === '' ? undefined : status === 'active', page, pageSize }),
    [q, status, page, pageSize, ...(p.fetchDeps ?? [])],
  );

  const [menu, setMenu] = useState<{ el: HTMLElement; user: UserDto } | null>(null);
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<UserDto | null>(null);
  const [reset, setReset] = useState<UserDto | null>(null);
  const [reassign, setReassign] = useState<UserDto | null>(null);
  const [toggle, setToggle] = useState<UserDto | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (u: UserDto) => list.setData(list.data ? { ...list.data, items: list.data.items.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : list.data);

  const confirmToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try { patch(await usersApi.setStatus(toggle.id, !toggle.isActive)); toast(toggle.isActive ? 'Account deactivated.' : 'Account activated.'); setToggle(null); }
    catch (e) { toast(errorMessage(e), 'error'); setToggle(null); } finally { setBusy(false); }
  };

  const cols = 5 + (p.showRole ? 1 : 0) + (p.showManager ? 1 : 0);

  return (
    <>
      <PageHeader title={p.title} subtitle={p.subtitle} crumbs={p.crumbs}
        actions={p.createKind ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreate(true)}>{p.createLabel ?? 'Create'}</Button> : undefined} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }}>
          <TextField placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ maxWidth: { md: 340 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} inputProps={{ 'aria-label': 'Search accounts' }} />
          <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ maxWidth: { md: 160 } }}>
            <MenuItem value="">All</MenuItem><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
          {p.filters}
        </Stack>
        <TableContainer>
          <Table size="small" aria-label={p.title}>
            <TableHead><TableRow>
              <TableCell>Name</TableCell><TableCell>Email</TableCell>
              {p.showRole && <TableCell>Role</TableCell>}{p.showManager && <TableCell>Manager</TableCell>}
              <TableCell>Status</TableCell><TableCell>Last sign-in</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {list.data?.items.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{p.rowLink ? <Link component={RouterLink} to={p.rowLink(u)} underline="hover" fontWeight={600}>{u.name}</Link> : <b>{u.name}</b>}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  {p.showRole && <TableCell><RoleChip role={u.role} /></TableCell>}
                  {p.showManager && <TableCell>{u.role !== 'User' ? '—' : (<><Typography variant="body2">{u.managerName ?? '—'}</Typography>{u.assignmentType && <Typography variant="caption" color="text.secondary">{u.assignmentType === 'Standalone' ? 'Standalone' : 'Admin-managed'}</Typography>}</>)}</TableCell>}
                  <TableCell><ActiveChip active={u.isActive} /></TableCell>
                  <TableCell>{fmtUtc(u.lastLoginAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={u.id === me?.id ? 'You cannot manage your own account here' : ''}>
                      <span><IconButton size="small" disabled={u.id === me?.id} aria-label={`Actions for ${u.name}`} onClick={(e) => setMenu({ el: e.currentTarget, user: u })}><MoreVert fontSize="small" /></IconButton></span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {list.loading && <TableSkeleton cols={cols} />}
        {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && list.data?.items.length === 0 && (
          <EmptyState title={p.emptyTitle ?? 'No accounts found'} hint={p.emptyHint ?? 'Try different filters.'}
            action={p.createKind ? <Button onClick={() => setCreate(true)} startIcon={<AddIcon />}>{p.createLabel ?? 'Create'}</Button> : undefined} />
        )}
        <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        {menu && (() => {
          const u = menu.user; const close = () => setMenu(null);
          const canEdit = isSA || u.role === 'User';
          return [
            canEdit && <MenuItem key="e" onClick={() => { close(); setEdit(u); }}><ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon><ListItemText>Edit</ListItemText></MenuItem>,
            canEdit && <MenuItem key="r" onClick={() => { close(); setReset(u); }}><ListItemIcon><LockResetOutlined fontSize="small" /></ListItemIcon><ListItemText>Reset password…</ListItemText></MenuItem>,
            isSA && u.role === 'User' && <MenuItem key="m" onClick={() => { close(); setReassign(u); }}><ListItemIcon><SwapHoriz fontSize="small" /></ListItemIcon><ListItemText>Change manager…</ListItemText></MenuItem>,
            canEdit && <MenuItem key="s" onClick={() => { close(); setToggle(u); }}><ListItemIcon><PowerSettingsNew fontSize="small" /></ListItemIcon><ListItemText>{u.isActive ? 'Deactivate…' : 'Activate'}</ListItemText></MenuItem>,
          ].filter(Boolean);
        })()}
      </Menu>

      {p.createKind && <CreateUserDialog open={create} kind={p.createKind} adminId={p.adminId} adminName={p.adminName} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); list.reload(); }} />}
      <EditUserDialog user={edit} onClose={() => setEdit(null)} onSaved={(u) => { setEdit(null); patch(u); }} />
      <ResetPasswordDialog user={reset} onClose={() => setReset(null)} />
      <ReassignManagerDialog user={reassign} onClose={() => setReassign(null)} onSaved={() => { setReassign(null); list.reload(); }} />
      <ConfirmDialog open={!!toggle} busy={busy} danger={!!toggle?.isActive} onClose={() => setToggle(null)} onConfirm={confirmToggle}
        title={toggle?.isActive ? 'Deactivate account?' : 'Activate account?'} confirmLabel={toggle?.isActive ? 'Deactivate' : 'Activate'}
        body={toggle?.isActive
          ? <><b>{toggle.name}</b> will no longer be able to sign in. {toggle.role === 'Admin' && 'Their managed users are not affected. '}The last active SuperAdmin cannot be deactivated.</>
          : <><b>{toggle?.name}</b> will be able to sign in again.</>} />
    </>
  );
}
