import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, updateInformation, deleteInformation } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
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
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    await deleteInformation(id, fileId, infoId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
