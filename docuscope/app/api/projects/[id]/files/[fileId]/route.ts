import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile, updateFileMetadata, deleteFile } from '@/lib/projects.server';
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
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    // The file must be checked out by this user (or no one) before its metadata
    // can change; otherwise reject so a stale client can't clobber the holder.
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    const body = await request.json() as {
      author: string | null;
      createdDate: number | null;
      overallBias: string | null;
      source: string | null;
      fileReliability: string | null;
      fileCredibility: string | null;
      fileReliabilityCode: string | null;
      fileCredibilityCode: string | null;
    };
    await updateFileMetadata(id, fileId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

// Soft-delete a file (issue #100). Only the user who currently holds the file's
// checkout may delete it; deleteFile enforces that and throws 'Conflict' (→ 409
// via apiError) otherwise.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    await deleteFile(id, fileId, uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
