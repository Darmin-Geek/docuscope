import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

let _client: CognitoIdentityProviderClient | null = null;

function client() {
  if (!_client) {
    _client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION ?? 'us-east-2',
    });
  }
  return _client;
}

const poolId = () => process.env.COGNITO_USER_POOL_ID!;

export async function getCognitoProfile(uid: string): Promise<{ name: string } | null> {
  try {
    const res = await client().send(
      new AdminGetUserCommand({ UserPoolId: poolId(), Username: uid }),
    );
    const name =
      res.UserAttributes?.find((a) => a.Name === 'name')?.Value ?? '';
    return { name };
  } catch {
    return null;
  }
}

export async function setCognitoName(uid: string, name: string): Promise<void> {
  await client().send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: poolId(),
      Username: uid,
      UserAttributes: [{ Name: 'name', Value: name }],
    }),
  );
}

export async function getCognitoUidForEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const res = await client().send(
    new ListUsersCommand({
      UserPoolId: poolId(),
      Filter: `email = "${normalized}"`,
      Limit: 1,
    }),
  );
  const user = res.Users?.[0];
  if (!user) return null;
  return user.Attributes?.find((a) => a.Name === 'sub')?.Value ?? null;
}
