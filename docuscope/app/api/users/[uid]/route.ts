import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { getUserProfile, setUserName } from '@/lib/users.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    await verifyAuth(request);
    const { uid } = await params;
    const profile = await getUserProfile(uid);
    return NextResponse.json(profile ?? { name: '' });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const { uid: authUid } = await verifyAuth(request);
    const { uid } = await params;
    if (authUid !== uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json() as { name?: string };
    if (body.name !== undefined) await setUserName(uid, body.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
