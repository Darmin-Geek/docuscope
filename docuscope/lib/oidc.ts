import { UserManager, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

export function makeOidcConfig(): UserManagerSettings {
  const region = process.env.NEXT_PUBLIC_AWS_REGION ?? 'us-east-1';
  return {
    authority: `https://cognito-idp.${region}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`,
    client_id: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
    redirect_uri: process.env.NEXT_PUBLIC_APP_URL!,
    post_logout_redirect_uri: process.env.NEXT_PUBLIC_APP_URL!,
    response_type: 'code',
    scope: 'openid email profile',
    // Use localStorage so the session survives page refreshes.
    // Guard for SSR: client components still render server-side in Next.js.
    ...(typeof window !== 'undefined' && {
      userStore: new WebStorageStateStore({ store: window.localStorage }),
    }),
  };
}

// Singleton used by apiClient.ts for imperative token access outside React.
// react-oidc-context creates its own UserManager from the same config; both
// share state through localStorage so they stay in sync.
let _manager: UserManager | null = null;
export function getUserManager(): UserManager {
  if (!_manager) _manager = new UserManager(makeOidcConfig());
  return _manager;
}
