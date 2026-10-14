import axios from 'axios';
import type { ApiErrorBody } from '../types/api';

export interface AppError {
  status: number; code: string; message: string; fieldErrors: Record<string, string[]>; traceId?: string | null;
}

const DEFAULTS: Record<number, string> = {
  400: 'The request was not valid. Please check the entered values.',
  401: 'Your session is not valid. Please sign in again.',
  403: 'You do not have permission to do this.',
  404: 'The requested item was not found.',
  409: 'This conflicts with existing data.',
  413: 'The request is too large.',
  429: 'Too many requests. Please wait a moment and try again.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
};

export function toAppError(err: unknown): AppError {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      return { status: 0, code: 'network', message: 'Cannot reach the LIVVAir server. Check your connection and try again.', fieldErrors: {} };
    }
    const status = err.response.status;
    const body = (err.response.data ?? {}) as Partial<ApiErrorBody>;
    let message = typeof body.message === 'string' && body.message ? body.message : DEFAULTS[status] ?? 'Something went wrong. Please try again.';
    if (status >= 500) message = status === 503 ? DEFAULTS[503] : 'Something went wrong on the server. Please try again later.';
    const retry = err.response.headers?.['retry-after'];
    if (status === 429 && retry) message += ` (retry in ${retry}s)`;
    return { status, code: body.code ?? String(status), message, fieldErrors: body.errors ?? {}, traceId: body.traceId };
  }
  return { status: -1, code: 'unknown', message: err instanceof Error ? err.message : 'Unexpected error.', fieldErrors: {} };
}

export const errorMessage = (err: unknown) => toAppError(err).message;
