import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, addLabelToFile } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { labelId: string };
    await addLabelToFile(id, fileId, body.labelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
