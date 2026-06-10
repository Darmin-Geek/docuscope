'use client';

import { AuthProvider } from 'react-oidc-context';
import { makeOidcConfig } from '@/lib/oidc';

// AuthProvider is instantiated with the same config as the getUserManager()
// singleton in lib/oidc.ts. Both use localStorage as the state store so they
// read and write the same user entry and stay in sync.
export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider {...makeOidcConfig()}>{children}</AuthProvider>;
}
