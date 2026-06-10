import type { Page } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.COGNITO_ENDPOINT
    ? { endpoint: process.env.COGNITO_ENDPOINT }
    : {}),
});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

/**
 * Creates a user directly via the Cognito Admin API, bypassing the UI.
 * Use this to seed an existing account for login tests.
 *
 * Requires AWS credentials with cognito-idp:AdminCreateUser and
 * cognito-idp:AdminSetUserPassword permissions. In local development, point
 * COGNITO_ENDPOINT at a running `cognito-local` instance.
 */
export async function createEmulatorUser(
  email: string,
  password: string,
): Promise<void> {
  await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
      TemporaryPassword: password,
    }),
  );

  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}

/**
 * Injects a fake OIDC user into the browser's localStorage so the app treats
 * the given uid/email as signed in — without going through Cognito's hosted UI.
 *
 * The injected id_token uses the TEST_AUTH_SECRET bypass format understood by
 * verifyAuth.ts, so API calls succeed against the real server.
 *
 * Call this at the start of any test that needs an authenticated user.
 */
export async function injectOidcUser(
  page: Page,
  uid: string,
  email: string,
): Promise<void> {
  // Navigate first so localStorage is scoped to the right origin.
  await page.goto('/');

  const region = process.env.NEXT_PUBLIC_AWS_REGION ?? 'us-east-1';
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? 'us-east-1_TEST';
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? 'test-client-id';
  const authority = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  // Key format used by oidc-client-ts WebStorageStateStore
  const storageKey = `oidc.user:${authority}:${clientId}`;

  const secret = process.env.TEST_AUTH_SECRET ?? 'local-test-secret';
  // This token format is accepted by verifyAuth.ts when TEST_AUTH_SECRET is set.
  const fakeIdToken = `test:${secret}:${uid}:${email}`;
  const now = Math.floor(Date.now() / 1000);

  const oidcUser = {
    id_token: fakeIdToken,
    access_token: 'fake-access-token',
    token_type: 'Bearer',
    scope: 'openid email profile',
    profile: {
      sub: uid,
      email,
      email_verified: true,
      iss: authority,
      aud: clientId,
      exp: now + 3600,
      iat: now,
    },
    expires_at: now + 3600,
    session_state: null,
  };

  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: oidcUser },
  );

  // Reload so the app boots with the injected user already in localStorage.
  await page.reload();
}
