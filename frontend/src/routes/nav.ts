import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import PowerSettingsNewOutlined from '@mui/icons-material/PowerSettingsNewOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutline';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import SpeedOutlined from '@mui/icons-material/SpeedOutlined';
import HealthAndSafetyOutlined from '@mui/icons-material/HealthAndSafetyOutlined';
import PersonOutline from '@mui/icons-material/PersonOutline';
import LockResetOutlined from '@mui/icons-material/LockResetOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import VideoLibraryOutlined from '@mui/icons-material/VideoLibraryOutlined';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import type { Role } from '../types/api';

export interface NavItem { label: string; to: string; icon: SvgIconComponent; end?: boolean }

const settings: NavItem = { label: 'Device Configuration', to: '/settings/device-configuration', icon: SettingsOutlined };
const alertsNav: NavItem = { label: 'Alerts', to: '/alerts', icon: NotificationsActiveOutlined };
const alertConfig: NavItem = { label: 'Alert Configuration', to: '/settings/alert-configuration', icon: TuneOutlined };
const videos: NavItem = { label: 'Video Management', to: '/settings/video-management', icon: VideoLibraryOutlined };

const profile: NavItem[] = [
  { label: 'My Profile', to: '/profile', icon: PersonOutline },
  { label: 'Change Password', to: '/change-password', icon: LockResetOutlined },
];

export const NAV: Record<Role, NavItem[]> = {
  SuperAdmin: [
    { label: 'Dashboard', to: '/', icon: DashboardOutlined, end: true },
    { label: 'User Management', to: '/user-management', icon: ManageAccountsOutlined },
    { label: 'Users', to: '/users', icon: PeopleOutline },
    { label: 'Admin Management', to: '/admins', icon: AdminPanelSettingsOutlined },
    { label: 'Devices', to: '/devices', icon: SensorsOutlined },
    { label: 'Device Assignments', to: '/assignments', icon: LinkOutlined },
    { label: 'Shelly Switches', to: '/shelly', icon: PowerSettingsNewOutlined },
    { label: 'Live Device Map', to: '/device-map', icon: MapOutlined },
    { label: 'Sensor Readings', to: '/readings', icon: TableChartOutlined },
    { label: 'AQI Analytics', to: '/analytics', icon: InsightsOutlined },
    { label: 'Historical Reports', to: '/reports', icon: AssessmentOutlined },
    { label: 'Gov Comparison', to: '/gov-comparison', icon: CompareArrowsOutlined },
    { label: 'System Health', to: '/health', icon: HealthAndSafetyOutlined },
    alertsNav,
    alertConfig,
    settings,
    videos,
    ...profile,
  ],
  Admin: [
    { label: 'Dashboard', to: '/', icon: DashboardOutlined, end: true },
    { label: 'My Users', to: '/users', icon: PeopleOutline },
    { label: 'Devices', to: '/devices', icon: SensorsOutlined },
    { label: 'Shelly Switches', to: '/shelly', icon: PowerSettingsNewOutlined },
    { label: 'Live Device Map', to: '/device-map', icon: MapOutlined },
    { label: 'Sensor Readings', to: '/readings', icon: TableChartOutlined },
    { label: 'AQI Analytics', to: '/analytics', icon: InsightsOutlined },
    { label: 'Historical Reports', to: '/reports', icon: AssessmentOutlined },
    { label: 'Gov Comparison', to: '/gov-comparison', icon: CompareArrowsOutlined },
    { label: 'System Health', to: '/health', icon: HealthAndSafetyOutlined },
    alertsNav,
    settings,
    videos,
    ...profile,
  ],
  User: [
    { label: 'Dashboard', to: '/', icon: DashboardOutlined, end: true },
    { label: 'My Devices', to: '/devices', icon: SensorsOutlined },
    { label: 'Live Device Map', to: '/device-map', icon: MapOutlined },
    { label: 'Latest Sensor Readings', to: '/latest', icon: SpeedOutlined },
    { label: 'Reading History', to: '/readings', icon: HistoryOutlined },
    { label: 'AQI Analytics', to: '/analytics', icon: InsightsOutlined },
    { label: 'Historical Reports', to: '/reports', icon: AssessmentOutlined },
    { label: 'Gov Comparison', to: '/gov-comparison', icon: CompareArrowsOutlined },
    alertsNav,
    settings,
    videos,
    ...profile,
  ],
};
