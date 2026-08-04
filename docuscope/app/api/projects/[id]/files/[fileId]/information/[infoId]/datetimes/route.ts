import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { getDatetimes } from '@/lib/timelines.server';
import { apiError } from '@/lib/apiError';

// Read-only: a row's datetimes are seeded into the file draft on load and
// persisted back through submitDraft (Option 2). Writes no longer go through a
// dedicated endpoint, so only GET remains here.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const data = await getDatetimes(id, fileId, infoId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}
