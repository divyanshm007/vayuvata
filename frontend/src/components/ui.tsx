import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Breadcrumbs, Card, Chip, Link, Stack, Tooltip, Typography, TablePagination, Skeleton } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import { aqiCategory } from '../utils/aqi';
import { tokens } from '../theme/theme';
import type { PagedResult, Role } from '../types/api';

export interface Crumb { label: string; to?: string }

export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: string; crumbs?: Crumb[]; actions?: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      {crumbs && crumbs.length > 0 && (
        <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 0.5, fontSize: 13 }}>
          {crumbs.map((c) => c.to
            ? <Link key={c.label} component={RouterLink} to={c.to} underline="hover" color="text.secondary">{c.label}</Link>
            : <Typography key={c.label} fontSize={13} color="text.primary">{c.label}</Typography>)}
        </Breadcrumbs>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 19, md: 23 } }}>{title}</Typography>
          {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 13 }}>{subtitle}</Typography>}
        </Box>
        {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{actions}</Stack>}
      </Stack>
    </Box>
  );
}

export function AqiBadge({ aqi, status, size = 'small' }: { aqi: number | null | undefined; status?: string | null; size?: 'small' | 'medium' }) {
  const c = aqiCategory(aqi);
  const label = aqi === null || aqi === undefined ? c.label : `${aqi} · ${c.label}`;
  return (
    <Tooltip title={status && status !== c.label ? `Device reported: ${status}` : ''}>
      <Chip size={size} label={label} sx={{ bgcolor: c.bg, color: c.color, border: `1px solid ${c.color}33` }} />
    </Tooltip>
  );
}

export const ActiveChip = ({ active }: { active: boolean }) =>
  <Chip size="small" label={active ? 'Active' : 'Inactive'} color={active ? 'success' : 'default'} variant={active ? 'filled' : 'outlined'} />;

export const RoleChip = ({ role }: { role: Role }) => {
  const m: Record<Role, { bg: string; fg: string }> = {
    SuperAdmin: { bg: '#DCFCE7', fg: '#166534' }, Admin: { bg: '#ECFDF5', fg: '#047857' }, User: { bg: '#F1F5F4', fg: '#475569' },
  };
  return <Chip size="small" label={role} sx={{ bgcolor: m[role].bg, color: m[role].fg }} />;
};

export const ReportingChip = ({ reporting, known = true }: { reporting: boolean; known?: boolean }) =>
  !known ? <Chip size="small" variant="outlined" label="No readings" /> :
  <Chip size="small" variant="outlined" color={reporting ? 'success' : 'warning'} label={reporting ? 'Reporting' : 'Not reporting'} />;

export const AssignedChip = ({ name }: { name: string | null }) =>
  name ? <Chip size="small" variant="outlined" color="info" label={name} /> : <Chip size="small" variant="outlined" label="Unassigned" />;

interface StatProps {
  label: string; value: ReactNode; unit?: string; icon: SvgIconComponent; accent?: string; footer?: ReactNode; loading?: boolean;
}
export function StatCard({ label, value, unit, icon: Icon, accent = tokens.teal, footer, loading }: StatProps) {
  return (
    <Card sx={{ p: 2.25, height: '100%', transition: 'transform .15s, box-shadow .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" fontWeight={500}>{label}</Typography>
          {loading ? <Skeleton width={90} height={44} /> : (
            <Typography sx={{ fontWeight: 800, fontSize: 24, lineHeight: 1.3, letterSpacing: '-0.02em' }}>
              {value}{unit && value !== '—' && <Typography component="span" color="text.secondary" fontWeight={500} fontSize={14} sx={{ ml: 0.5 }}>{unit}</Typography>}
            </Typography>
          )}
        </Box>
        <Box sx={{ width: 42, height: 42, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: `${accent}1a`, color: accent, flexShrink: 0 }}>
          <Icon fontSize="small" />
        </Box>
      </Stack>
      {footer && <Box sx={{ mt: 1 }}>{footer}</Box>}
    </Card>
  );
}

/** Server-side pagination bar driven by the backend's PagedResult. Works with and without totalCount. */
export function PaginationBar({ page, result, pageSize, onPage, onPageSize }: {
  page: number; result: PagedResult<unknown> | null; pageSize: number; onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  const known = result?.totalCount != null;
  const count = known ? result!.totalCount! : (page - 1) * pageSize + (result?.items.length ?? 0) + (result?.hasNextPage ? 1 : 0);
  return (
    <TablePagination
      component="div" rowsPerPageOptions={[10, 20, 50, 100]} count={count} page={Math.max(0, page - 1)} rowsPerPage={pageSize}
      onPageChange={(_, p) => onPage(p + 1)} onRowsPerPageChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
      labelDisplayedRows={({ from, to }) => known ? `${from}–${to} of ${count}` : `${from}–${to}`}
      slotProps={{ actions: { nextButton: { disabled: !result?.hasNextPage } } }}
    />
  );
}
