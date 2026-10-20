import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { theme } from './theme/theme';
import { AuthProvider } from './features/auth/AuthContext';
import { ToastProvider } from './components/feedback';
import AppRoutes from './routes/AppRoutes';

// Login route only: start fetching the hero photo while the app boots, so it is ready when the page paints.
// (This lived in an inline <script> in index.html; it is here so the server's Content-Security-Policy can forbid inline scripts.)
if (location.pathname === '/login') {
  const l = document.createElement('link');
  l.rel = 'preload'; l.as = 'image'; l.href = '/login-bg.jpg';
  l.setAttribute('imagesrcset', '/login-bg-sm.jpg 900w, /login-bg.jpg 1672w'); l.setAttribute('imagesizes', '100vw');
  document.head.appendChild(l);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
