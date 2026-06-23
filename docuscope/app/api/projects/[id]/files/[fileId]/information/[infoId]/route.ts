import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile, updateInformation, deleteInformation } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    const fields = await request.json() as {
      informationTitle: string;
      informationText: string | null;
      overallBias: string | null;
      informationReliability: string | null;
      informationCredibility: string | null;
    };
    await updateInformation(id, fileId, infoId, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    await deleteInformation(id, fileId, infoId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
