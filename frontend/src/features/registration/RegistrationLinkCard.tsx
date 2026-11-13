import { useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import { useToast } from '../../components/feedback';
import { userMgmtApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';

/** Copies text to the clipboard; falls back to a hidden textarea where the Clipboard API is unavailable (plain http, older browsers). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** Super Admin: the public registration link, a button to copy it, and a box to email it to any address. */
export function RegistrationLinkCard() {
  const toast = useToast();
  const link = useAsync(() => userMgmtApi.link(), []);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const copy = async () => {
    if (!link.data) return;
    toast((await copyText(link.data.url)) ? 'Registration link copied.' : 'Could not copy. Select the link and copy it manually.', 'success');
  };
  const send = async () => {
    setSending(true); setMsg(null);
    try { await userMgmtApi.sendLink(email.trim()); setMsg({ ok: true, text: `The registration link was sent to ${email.trim()}.` }); setEmail(''); }
    catch (e) { setMsg({ ok: false, text: toAppError(e).message }); }
    finally { setSending(false); }
  };

  return (
    <Card sx={{ p: 2.5 }}>
      <Typography fontWeight={800}>Registration link</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>One link for Admins and Users. Every registration waits for your approval.</Typography>
      {link.error ? <Alert severity="warning">{toAppError(link.error).message}</Alert> : (
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField size="small" fullWidth value={link.data?.url ?? ''} placeholder={link.loading ? 'Loading…' : ''} inputProps={{ readOnly: true, 'aria-label': 'Registration link' }} />
            <Button variant="contained" startIcon={<ContentCopyOutlined />} onClick={() => void copy()} disabled={!link.data} sx={{ whiteSpace: 'nowrap' }}>Copy link</Button>
          </Stack>
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField size="small" fullWidth type="email" label="Email the link to" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && valid && !sending) void send(); }} inputProps={{ 'aria-label': 'Email address to send the link to' }} />
              <Button variant="outlined" startIcon={sending ? <CircularProgress size={16} /> : <SendOutlined />} onClick={() => void send()} disabled={!valid || sending || !link.data} sx={{ whiteSpace: 'nowrap' }}>Send link</Button>
            </Stack>
            {msg && <Alert severity={msg.ok ? 'success' : 'error'} sx={{ mt: 1 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
          </Box>
        </Stack>
      )}
    </Card>
  );
}
