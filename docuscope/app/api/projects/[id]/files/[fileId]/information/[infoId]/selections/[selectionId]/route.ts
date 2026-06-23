import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile, deleteSelection } from '@/lib/projects.server';
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
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId, selectionId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    await deleteSelection(id, fileId, infoId, selectionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
