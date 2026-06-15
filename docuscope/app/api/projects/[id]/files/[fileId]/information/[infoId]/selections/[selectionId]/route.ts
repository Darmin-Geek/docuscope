import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, deleteSelection } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      fileId: string;
      infoId: string;
      selectionId: string;
    }>;
  },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId, selectionId } = await params;
    await requireContributor(id, email);
    await deleteSelection(id, fileId, infoId, selectionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
