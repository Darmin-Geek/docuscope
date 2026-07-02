import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getInformationHistory } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

// GET — the field version history for a single piece of information, grouped by
// field name and ordered newest-first. Read-only: available to any contributor
// regardless of who holds the check-out.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const data = await getInformationHistory(id, fileId, infoId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}
