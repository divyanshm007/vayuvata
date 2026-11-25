import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { AUTO_REFRESH_MS, useAsync } from '../utils/useAsync';

afterEach(() => vi.useRealTimers());

describe('auto refresh', () => {
  it('re-fetches every 2 minutes without showing the spinner, and keeps the old data if a refresh fails', async () => {
    vi.useFakeTimers();
    expect(AUTO_REFRESH_MS).toBe(120_000);
    let n = 0; let fail = false;
    const fn = vi.fn(async () => { if (fail) throw new Error('x'); return ++n; });
    const { result } = renderHook(() => useAsync(fn, [], true, AUTO_REFRESH_MS));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS); });
    expect(result.current.data).toBe(2); expect(result.current.loading).toBe(false);
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS); });
    expect(result.current.data).toBe(2); expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
