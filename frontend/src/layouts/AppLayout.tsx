import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import LogoutIcon from '@mui/icons-material/Logout';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import { Brand, LogoMark, APP_VERSION, BRAND_NAME } from '../components/Brand';
import { useAuth } from '../features/auth/AuthContext';
import { NAV } from '../routes/nav';
import { RoleChip } from '../components/ui';
import { HealthIndicator } from '../features/health/HealthIndicator';
import { tokens } from '../theme/theme';

const WIDE = 252;
const NARROW = 74;
const STORE = 'vv.nav.collapsed';

const readCollapsed = (): boolean => {
  try {
    const v = localStorage.getItem(STORE);
    if (v !== null) return v === '1';
  } catch { /* storage unavailable */ }
  return typeof window !== 'undefined' && window.innerWidth < 1200; // smaller desktops and tablets start collapsed
};

/** Sidebar: the supplied forest photo under a deep-green overlay so labels always have contrast. */
function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { role, logout } = useAuth();
  const items = role ? NAV[role] : [];
  const itemSx = {
    borderRadius: '10px', mb: 'clamp(1px, 0.4dvh, 4px)', minHeight: `clamp(30px, calc((100dvh - 214px) / ${items.length} - 4px), 42px)`, py: 0, color: 'rgba(255,255,255,.8)', px: collapsed ? 0 : 1.5, justifyContent: collapsed ? 'center' : 'flex-start',
    border: '1px solid transparent', transition: 'background-color .18s, color .18s, border-color .18s',
    '& .MuiListItemIcon-root': { color: 'inherit', minWidth: collapsed ? 0 : 36, justifyContent: 'center' },
    '&:hover': { bgcolor: 'rgba(255,255,255,.08)', color: '#fff' },
  } as const;

  return (
    <Box sx={{
      height: '100%', display: 'flex', flexDirection: 'column', color: '#fff', bgcolor: tokens.sidebar, position: 'relative', overflow: 'hidden',
      backgroundImage: 'linear-gradient(180deg, rgba(5,28,17,.82) 0%, rgba(6,32,19,.7) 45%, rgba(5,26,16,.88) 100%), url(/sidebar.jpg)',
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      <Box sx={{ px: collapsed ? 0 : 2, py: 'clamp(8px, 2dvh, 16px)', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        {collapsed ? <LogoMark size={38} /> : <Brand />}
      </Box>

      <List component="nav" aria-label="Main navigation" sx={{ px: collapsed ? 1 : 1.25, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pt: 0.5, scrollbarWidth: 'none', msOverflowStyle: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        {items.map((it) => {
          const btn = (
            <ListItemButton
              key={it.to} component={NavLink} to={it.to} end={it.end} onClick={onNavigate} aria-label={collapsed ? it.label : undefined}
              sx={{ ...itemSx, '&.active': { color: '#fff', bgcolor: '#16A34A', borderColor: 'rgba(255,255,255,.12)', boxShadow: '0 6px 16px -8px rgba(22,163,74,.9)', '&:hover': { bgcolor: '#16A34A' }, '& .MuiListItemIcon-root': { color: '#fff' } } }}
            >
              <ListItemIcon><it.icon fontSize="small" /></ListItemIcon>
              {!collapsed && <ListItemText primary={it.label} primaryTypographyProps={{ fontSize: 13, fontWeight: 500, noWrap: true }} />}
            </ListItemButton>
          );
          return collapsed ? <Tooltip key={it.to} title={it.label} placement="right" arrow>{btn}</Tooltip> : btn;
        })}
      </List>

      {/* logout is visually separate from the navigation */}
      <Divider sx={{ borderColor: 'rgba(255,255,255,.14)', mx: 1.5 }} />
      <Box sx={{ p: collapsed ? 1 : 1.25 }}>
        <Tooltip title={collapsed ? 'Logout' : ''} placement="right" arrow>
          <ListItemButton onClick={() => { onNavigate?.(); void logout(); }} aria-label="Logout" sx={{ ...itemSx, mb: 0, '&:hover': { bgcolor: 'rgba(248,113,113,.18)', color: '#fff' } }}>
            <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
            {!collapsed && <ListItemText primary="Logout" primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }} />}
          </ListItemButton>
        </Tooltip>
        {!collapsed && <Typography variant="caption" sx={{ display: 'block', px: 1.5, pt: 0.5, color: 'rgba(255,255,255,.45)', '@media (max-height: 640px)': { display: 'none' } }}>{BRAND_NAME} v{APP_VERSION}</Typography>}
      </Box>
    </Box>
  );
}

export default function AppLayout() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { user, role, logout } = useAuth();
  const nav = useNavigate();
  const initials = (user?.name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const width = collapsed ? NARROW : WIDE;

  const toggle = () => {
    if (!desktop) { setOpen(true); return; }
    setCollapsed((c) => {
      try { localStorage.setItem(STORE, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: tokens.bg }}>
      <Box component="a" href="#main" sx={{ position: 'absolute', left: -999, '&:focus': { left: 8, top: 8, zIndex: 3000, bgcolor: '#fff', p: 1, borderRadius: 1 } }}>Skip to content</Box>

      {desktop ? (
        <Drawer variant="permanent" open PaperProps={{ sx: { width, border: 0, overflowX: 'hidden', transition: 'width .22s ease' } }} sx={{ width, flexShrink: 0, transition: 'width .22s ease', '& .MuiDrawer-paper': { boxSizing: 'border-box' } }}>
          <SidebarContent collapsed={collapsed} />
        </Drawer>
      ) : (
        <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} PaperProps={{ sx: { width: WIDE, border: 0 } }}>
          <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* top bar: clean white surface; the landscape photo is used on the dashboard banner */}
        <AppBar position="sticky" elevation={0} sx={{ color: tokens.text, bgcolor: '#fff', borderBottom: `1px solid ${tokens.border}` }}>
          <Toolbar sx={{ gap: 1.25, minHeight: { xs: 60, md: 68 }, px: { xs: 1.5, md: 3 } }}>
            <Tooltip title={desktop ? (collapsed ? 'Expand menu' : 'Collapse menu') : 'Open menu'}>
              <IconButton onClick={toggle} aria-label={desktop ? (collapsed ? 'Expand navigation' : 'Collapse navigation') : 'Open navigation'}
                sx={{ border: `1px solid ${tokens.border}`, borderRadius: '10px', '&:hover': { bgcolor: tokens.mint } }}>
                {desktop && !collapsed ? <MenuOpenIcon /> : <MenuIcon />}
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <HealthIndicator />
            {role && <Box sx={{ display: { xs: 'none', sm: 'block' } }}><RoleChip role={role} /></Box>}
            <Tooltip title="Account">
              <Box component="button" type="button" onClick={(e) => setMenu(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu"
                sx={{ display: 'flex', alignItems: 'center', gap: 1.25, border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0.5, pr: 1, borderRadius: '12px', font: 'inherit', color: 'inherit', textAlign: 'left', '&:hover': { bgcolor: tokens.mint } }}>
                <Avatar sx={{ width: 36, height: 36, fontSize: 13, fontWeight: 700, bgcolor: tokens.forest }}>{initials}</Avatar>
                <Box sx={{ display: { xs: 'none', md: 'block' }, lineHeight: 1.2, maxWidth: 190 }}>
                  <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700 }}>{user?.name}</Typography>
                  <Typography noWrap sx={{ fontSize: 11, color: tokens.muted }}>{user?.email}</Typography>
                </Box>
                <KeyboardArrowDown sx={{ color: tokens.muted, display: { xs: 'none', md: 'block' } }} />
              </Box>
            </Tooltip>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              <Box sx={{ px: 2, py: 1 }}>
                <Typography fontWeight={600}>{user?.name}</Typography>
                <Typography variant="body2" color="text.secondary">{user?.email}</Typography>
                {role && <Box sx={{ mt: 0.75 }}><RoleChip role={role} /></Box>}
              </Box>
              <Divider />
              <MenuItem onClick={() => { setMenu(null); nav('/profile'); }}>My Profile</MenuItem>
              <MenuItem onClick={() => { setMenu(null); nav('/change-password'); }}>Change Password</MenuItem>
              <MenuItem onClick={() => { setMenu(null); void logout(); }}>Logout</MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" id="main" tabIndex={-1} sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, width: '100%', mx: 'auto', flex: 1, outline: 'none', boxSizing: 'border-box' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
