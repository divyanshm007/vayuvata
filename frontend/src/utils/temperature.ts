import { useMaybeAuth } from '../features/auth/AuthContext';

/**
 * Temperature rule. SuperAdmin sees BOTH the inner and the outer temperature. Admin and User see only the outer temperature, shown under the name
 * "Temperature" (the server already replaces the value, so the inner reading never reaches them; the UI only has to hide the extra column).
 * Outside a signed-in session the safe view (outer only) is used.
 */
export function useTempView() {
  const isSA = useMaybeAuth()?.role === 'SuperAdmin';
  return { isSA, tempLabel: isSA ? 'Inner temperature' : 'Temperature', tempShort: isSA ? 'Inner temp' : 'Temp' };
}
