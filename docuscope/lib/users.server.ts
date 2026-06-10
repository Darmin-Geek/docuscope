import { db } from './drizzle/db';
import { eq } from 'drizzle-orm';
import { users } from './drizzle/schema';
import type { UserProfile } from './users';

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.uid, uid))
    .limit(1);
  return row ? { name: row.name } : null;
}

export async function setUserName(uid: string, name: string): Promise<void> {
  await db
    .insert(users)
    .values({ uid, name, email: '' })
    .onConflictDoUpdate({
      target: users.uid,
      set: { name },
    });
}

export async function recordUserEmail(uid: string, email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await db
    .insert(users)
    .values({ uid, email: normalized, name: '' })
    .onConflictDoUpdate({
      target: users.uid,
      set: { email: normalized },
    });
}

export async function getUidForEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ uid: users.uid })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.uid ?? null;
}
