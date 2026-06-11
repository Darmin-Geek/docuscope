import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, moveFile } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { toFolderId: string | null };
    await moveFile(id, fileId, body.toFolderId ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
