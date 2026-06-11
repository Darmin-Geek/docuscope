import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, checkOutFile, checkInFile } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const claimed = await checkOutFile(id, fileId, uid);
    return NextResponse.json({ claimed });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    await checkInFile(id, fileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
