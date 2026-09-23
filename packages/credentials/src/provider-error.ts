import type { SafeProviderError } from '@vian/core';

// Do not carry upstream messages or response bodies across this boundary.
export function safeProviderError(error: unknown): SafeProviderError {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (record.name === 'AbortError') return { code: 'cancelled', message: 'Generation was cancelled.' };
    const status = typeof record.statusCode === 'number' ? record.statusCode : record.status;
    if (status === 401 || status === 403) return { code: 'auth-required', message: 'Provider authentication is required.' };
    if (status === 429) return { code: 'rate-limited', message: 'Provider rate limit reached.' };
    if (typeof status === 'number' && status >= 500) return { code: 'retryable-transport', message: 'Provider is temporarily unavailable.' };
    if (status === 400 || status === 415 || status === 422) return { code: 'unsupported-input', message: 'Provider rejected this input.' };
  }
  return { code: 'terminal-provider', message: 'Provider request failed.' };
}
