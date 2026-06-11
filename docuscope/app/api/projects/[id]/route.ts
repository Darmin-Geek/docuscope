import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, updateProjectTitle } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { title: string };
    await updateProjectTitle(id, body.title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
