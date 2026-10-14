import { Alert, Button, Card, Grid, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import { PageHeader, StatCard } from '../../components/ui';
import { useHealth } from './HealthIndicator';
import { fmtUtc } from '../../utils/format';
import { API_PREFIX } from '../../api/client';

export default function HealthPage() {
  const { state, check } = useHealth(false);
  const ok = state.kind === 'ok';
  return (
    <>
      <PageHeader title="System Health" subtitle="Backend and database connectivity" crumbs={[{ label: 'Home', to: '/' }, { label: 'System Health' }]}
        actions={<Button startIcon={<RefreshIcon />} variant="outlined" onClick={() => void check()}>Check again</Button>} />
      {state.kind === 'db_down' && <Alert severity="error" sx={{ mb: 2 }}>The API is running but the database is currently unavailable. Data may not load until it recovers.</Alert>}
      {state.kind === 'unreachable' && <Alert severity="error" sx={{ mb: 2 }}>{state.message}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <StatCard label="API" icon={CloudDoneOutlined} loading={state.kind === 'loading'}
            value={state.kind === 'unreachable' ? 'Unreachable' : state.kind === 'loading' ? '' : 'Online'}
            accent={state.kind === 'unreachable' ? '#dc2626' : '#16a34a'} footer={<Typography variant="caption" color="text.secondary">{API_PREFIX}</Typography>} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <StatCard label="Database" icon={StorageOutlined} loading={state.kind === 'loading'}
            value={state.kind === 'loading' ? '' : state.kind === 'unreachable' ? 'Unknown' : state.data.database}
            accent={ok ? '#16a34a' : '#dc2626'} />
        </Grid>
      </Grid>
      {(state.kind === 'ok' || state.kind === 'db_down') && (
        <Card sx={{ mt: 2, p: 2.5 }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">Status</Typography>
            <Typography fontWeight={600}>{state.data.status}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>Server time</Typography>
            <Typography fontWeight={600}>{fmtUtc(state.data.timeUtc)}</Typography>
          </Stack>
        </Card>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Health is checked on demand; a failing endpoint is not polled automatically.
      </Typography>
    </>
  );
}
