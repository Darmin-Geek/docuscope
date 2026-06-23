import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, addLabelToInformation } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { labelId: string };
    await addLabelToInformation(id, fileId, infoId, body.labelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
