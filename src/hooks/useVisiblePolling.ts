import { useEffect, useRef } from 'react';

export function useVisiblePolling(
  callback: (signal: AbortSignal) => Promise<unknown>,
  intervalMs: number,
  enabled = true,
  scope = '',
  delayMs = 0,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const visible = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;

    const poll = async () => {
      if (stopped || running || !visible()) return;
      if (timer) clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const started = Date.now();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      try {
        await callbackRef.current(controller.signal);
      } catch {
      } finally {
        clearTimeout(timeout);
        running = false;
        if (!stopped && visible()) {
          timer = setTimeout(poll, Math.max(500, intervalMs - (Date.now() - started)));
        }
      }
    };

    const resume = () => {
      if (timer) clearTimeout(timer);
      if (visible()) void poll();
      else controller?.abort();
    };
    if (delayMs > 0) timer = setTimeout(poll, delayMs);
    else void poll();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [intervalMs, enabled, scope, delayMs]);
}
