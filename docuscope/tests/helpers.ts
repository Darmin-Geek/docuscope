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

  // Set the permanent password so the user doesn't have to change it on first sign-in.
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}
