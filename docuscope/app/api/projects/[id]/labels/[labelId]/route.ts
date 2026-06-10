import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, updateLabel, deleteLabel } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; labelId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, labelId } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { label: string; color: string };
    await updateLabel(id, labelId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; labelId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, labelId } = await params;
    await requireContributor(id, email);
    await deleteLabel(id, labelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
