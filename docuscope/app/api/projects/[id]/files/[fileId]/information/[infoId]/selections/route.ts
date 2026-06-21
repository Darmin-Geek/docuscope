import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile, getSelections, addSelection } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';
import type { SelectionFields } from '@/lib/projects';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const data = await getSelections(id, fileId, infoId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
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
    const fields = await request.json() as SelectionFields[];
    const ids = await addSelection(id, fileId, infoId, fields);
    return NextResponse.json({ ids });
  } catch (err) {
    return apiError(err);
  }
}
