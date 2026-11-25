import { Chip } from '@mui/material';
import type { AlertCategoryName, AlertStatusName } from '../../types/api';

export const CATEGORY_LABEL: Record<AlertCategoryName, string> = { Maintenance: 'Maintenance', MachineError: 'Machine error', AbnormalReading: 'Abnormal reading' };

export const TYPE_LABEL: Record<string, string> = {
  FilterReplacement: 'Filter replacement', BinCleaning: 'Bin cleaning', DeviceOffline: 'Device offline', OuterSensorFailure: 'Outer sensor not delivering', SensorNoData: 'Sensor not sending data',
  AqiAbnormal: 'Abnormal AQI', TemperatureAbnormal: 'Abnormal temperature',
};

const COLOR: Record<AlertStatusName, 'success' | 'warning' | 'error' | 'default'> = { Normal: 'default', Warning: 'warning', Critical: 'error', Resolved: 'success' };

export function StatusChip({ status }: { status: AlertStatusName | 'Normal' | 'Warning' | 'Critical' }) {
  return <Chip size="small" color={COLOR[status as AlertStatusName] ?? 'default'} label={status} sx={{ fontWeight: 700 }} />;
}
