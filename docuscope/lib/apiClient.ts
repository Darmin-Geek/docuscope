import { getUserManager } from './oidc';

async function getToken(): Promise<string> {
  const user = await getUserManager().getUser();
  // id_token is the JWT verifyAuth.ts checks; access_token is for resource servers.
  const token = user?.expired === false ? user.id_token : null;
  if (!token) throw new Error('Not authenticated');
  return token;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
