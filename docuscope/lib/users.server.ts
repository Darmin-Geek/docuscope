import { getCognitoProfile, setCognitoName, getCognitoUidForEmail } from './cognito';
import type { UserProfile } from './users';

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  return getCognitoProfile(uid);
}

export async function setUserName(uid: string, name: string): Promise<void> {
  await setCognitoName(uid, name);
}

export async function getUidForEmail(email: string): Promise<string | null> {
  return getCognitoUidForEmail(email);
}
