import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import AppLayout from '../layouts/AppLayout';
import { useAuth } from '../features/auth/AuthContext';
import LoginPage from '../features/auth/LoginPage';
import type { Role } from '../types/api';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const DevicesPage = lazy(() => import('../features/devices/DevicesPage'));
const AssignmentsPage = lazy(() => import('../features/devices/AssignmentsPage'));
const LiveDeviceMapPage = lazy(() => import('../features/device-map/pages/LiveDeviceMapPage'));
const DeviceDetailPage = lazy(() => import('../features/devices/DeviceDetailPage'));
const ReadingsPage = lazy(() => import('../features/sensor-data/ReadingsPage'));
const LatestPage = lazy(() => import('../features/sensor-data/LatestPage'));
const AnalyticsPage = lazy(() => import('../features/analytics/AnalyticsPage'));
const ReportsPage = lazy(() => import('../features/analytics/ReportsPage'));
const GovComparisonPage = lazy(() => import('../features/government/GovComparisonPage'));
const HealthPage = lazy(() => import('../features/health/HealthPage'));
const UsersPage = lazy(() => import('../features/users/UserPages').then((m) => ({ default: m.UsersPage })));
const AdminsPage = lazy(() => import('../features/users/UserPages').then((m) => ({ default: m.AdminsPage })));
const AdminUsersPage = lazy(() => import('../features/users/UserPages').then((m) => ({ default: m.AdminUsersPage })));
const UserDetailPage = lazy(() => import('../features/users/UserPages').then((m) => ({ default: m.UserDetailPage })));
const ProfilePage = lazy(() => import('../features/auth/AccountPages').then((m) => ({ default: m.ProfilePage })));
const ChangePasswordPage = lazy(() => import('../features/auth/AccountPages').then((m) => ({ default: m.ChangePasswordPage })));

const Spinner = () => <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}><CircularProgress aria-label="Loading" /></Box>;

export function StatusScreen({ code, title, text }: { code: string; title: string; text: string }) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 10, textAlign: 'center' }}>
      <Typography sx={{ fontWeight: 800, fontSize: 72, lineHeight: 1, color: 'primary.main' }}>{code}</Typography>
      <Typography variant="h5">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 420 }}>{text}</Typography>
      <Button component={RouterLink} to="/" variant="contained">Back to dashboard</Button>
    </Stack>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Spinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** UX guard only: the backend enforces authorization on every call regardless. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) {
    return <StatusScreen code="403" title="Access denied" text="You do not have permission to view this page." />;
  }
  return <>{children}</>;
}

const SA: Role[] = ['SuperAdmin'];
const OPS: Role[] = ['SuperAdmin', 'Admin'];
const User: Role[] = ['User'];

export default function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<RequireRole roles={OPS}><UsersPage /></RequireRole>} />
          <Route path="users/:id" element={<RequireRole roles={OPS}><UserDetailPage /></RequireRole>} />
          <Route path="admins" element={<RequireRole roles={SA}><AdminsPage /></RequireRole>} />
          <Route path="admins/:id" element={<RequireRole roles={OPS}><AdminUsersPage /></RequireRole>} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/:id" element={<DeviceDetailPage />} />
          <Route path="device-map" element={<LiveDeviceMapPage />} />
          <Route path="assignments" element={<RequireRole roles={SA}><AssignmentsPage /></RequireRole>} />
          <Route path="readings" element={<ReadingsPage />} />
          <Route path="latest" element={<RequireRole roles={User}><LatestPage /></RequireRole>} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="gov-comparison" element={<GovComparisonPage />} />
          <Route path="health" element={<RequireRole roles={OPS}><HealthPage /></RequireRole>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route path="*" element={<StatusScreen code="404" title="Page not found" text="The page you are looking for does not exist." />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
