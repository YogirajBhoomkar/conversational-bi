import { useEffect, useState } from 'react';
import { getClientConfig } from '../api/chatApi';
import type { ClientConfig } from './types';

// Read once per page load and shared by every answer on the page.
let loading: Promise<ClientConfig | null> | undefined;
export const loadClientConfig = () => (loading ??= getClientConfig());
export const resetClientConfigForTests = () => (loading = undefined);

export function useClientConfig(): ClientConfig | null {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadClientConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
