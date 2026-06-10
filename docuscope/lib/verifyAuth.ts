import { CognitoJwtVerifier } from 'aws-jwt-verify';

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      tokenUse: 'id',
    });
  }
  return verifier;
}

export type AuthPayload = { uid: string; email: string };

export async function verifyAuth(request: Request): Promise<AuthPayload> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = authHeader.slice(7);

  // Test bypass: Bearer test:<TEST_AUTH_SECRET>:<uid>:<email>
  // Only active when TEST_AUTH_SECRET is set (never set in production).
  if (process.env.TEST_AUTH_SECRET) {
    const prefix = `test:${process.env.TEST_AUTH_SECRET}:`;
    if (token.startsWith(prefix)) {
      const rest = token.slice(prefix.length);
      const colonIdx = rest.indexOf(':');
      const uid = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
      const email = colonIdx === -1 ? `${uid}@test.com` : rest.slice(colonIdx + 1);
      return { uid, email };
    }
  }

  const payload = await getVerifier().verify(token);
  return {
    uid: payload.sub,
    email: (payload['email'] as string) ?? '',
  };
}
