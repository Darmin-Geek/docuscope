import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile, updateFileMetadata } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    return NextResponse.json(file);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const body = await request.json() as {
      author: string | null;
      createdDate: number | null;
      overallBias: string | null;
      source: string | null;
      fileReliability: string | null;
      fileCredibility: string | null;
    };
    await updateFileMetadata(id, fileId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
