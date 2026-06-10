import './cognito';

import {
  signUp as amplifySignUp,
  signIn,
  signOut,
  fetchAuthSession,
  resetPassword as amplifyResetPassword,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import type { CognitoUser } from 'amazon-cognito-identity-js';

export type { CognitoUser };

export type User = {
  uid: string;
  email: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signUp(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const result = await amplifySignUp({
    username: normalized,
    password,
    options: {
      userAttributes: { email: normalized },
      autoSignIn: true,
    },
  });
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload;
  return {
    uid: (payload?.sub as string) ?? result.userId ?? normalized,
    email: normalized,
  };
}

export async function logIn(email: string, password: string): Promise<User> {
  const normalized = normalizeEmail(email);
  await signIn({ username: normalized, password });
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload;
  return {
    uid: payload?.sub as string,
    email: normalized,
  };
}

export async function logOut(): Promise<void> {
  await signOut();
}

export function resetPassword(email: string): Promise<void> {
  return amplifyResetPassword({ username: normalizeEmail(email) }).then(() => {});
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  fetchAuthSession()
    .then((session) => {
      const payload = session.tokens?.idToken?.payload;
      if (payload?.sub) {
        callback({
          uid: payload.sub as string,
          email: (payload.email as string) ?? null,
        });
      } else {
        callback(null);
      }
    })
    .catch(() => callback(null));

  const { remove } = Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signedIn') {
      fetchAuthSession()
        .then((session) => {
          const p = session.tokens?.idToken?.payload;
          if (p?.sub) {
            callback({ uid: p.sub as string, email: (p.email as string) ?? null });
          }
        })
        .catch(() => {});
    } else if (payload.event === 'signedOut') {
      callback(null);
    }
  });

  return remove;
}
