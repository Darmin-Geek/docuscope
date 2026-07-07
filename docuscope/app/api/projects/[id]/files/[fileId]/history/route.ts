import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFileHistory } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

// GET — the field version history for a file's metadata, grouped by field name
// and ordered newest-first. Read-only: available to any contributor regardless
// of who holds the check-out.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const data = await getFileHistory(id, fileId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}
