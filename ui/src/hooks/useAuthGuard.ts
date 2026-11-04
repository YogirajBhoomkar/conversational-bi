import { useEffect } from 'react';

/** In OAuth mode, send an anonymous visitor to the Databricks login. In shared-token (dev) mode this does nothing. */
export function useAuthGuard(): void {
  useEffect(() => {
    let cancelled = false;
    fetch('/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((me) => {
        if (!cancelled && me && me.authenticated === false && me.mode === 'oauth') window.location.href = '/auth/login';
      })
      .catch(() => {
        /* server unreachable: the first chat request will show the error */
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
