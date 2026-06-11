import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, removeLabelFromFile } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; labelId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, labelId } = await params;
    await requireContributor(id, email);
    await removeLabelFromFile(id, fileId, labelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
