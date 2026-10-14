import { Button, Stack, Typography } from '@mui/material';

export interface TestAccount { role: string; email: string; password: string }

/**
 * Development-only quick-fill. Accounts come from VITE_TEST_ACCOUNTS (JSON array in the git-ignored .env.development.local)
 * and the panel only renders when VITE_SHOW_TEST_ACCOUNTS=true in a dev build. The caller guards with `import.meta.env.DEV`,
 * so the component and its data are removed from production bundles.
 */
export function readTestAccounts(): TestAccount[] {
  try {
    const raw = import.meta.env.VITE_TEST_ACCOUNTS;
    const list = raw ? (JSON.parse(raw) as TestAccount[]) : [];
    return list.filter((a) => a.email && a.password);
  } catch {
    return [];
  }
}

/** Deliberately tiny: one line under the form. */
export function TestAccounts({ accounts, onPick }: { accounts: TestAccount[]; onPick: (a: TestAccount) => void }) {
  if (accounts.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ mt: 1.5 }}>
      <Typography sx={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: 'warning.dark' }}>DEV LOGIN</Typography>
      {accounts.map((a) => (
        <Button key={a.email} size="small" variant="outlined" color="warning" onClick={() => onPick(a)} sx={{ py: 0.25, px: 1.25, minWidth: 0, fontSize: 12, lineHeight: 1.6, bgcolor: 'rgba(255,255,255,.7)' }}>{a.role}</Button>
      ))}
    </Stack>
  );
}
