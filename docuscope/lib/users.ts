import { api } from './apiClient';

export type UserProfile = {
  name: string;
};

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const profile = await api<{ name: string }>(`/api/users/${uid}`);
    return { name: profile.name };
  } catch {
    return null;
  }
}

export async function setUserName(uid: string, name: string): Promise<void> {
  await api(`/api/users/${uid}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function recordUserEmail(uid: string, email: string): Promise<void> {
  await api(`/api/users/${uid}`, {
    method: 'PUT',
    body: JSON.stringify({ email }),
  });
}
