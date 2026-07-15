import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { removeTimelineEntry } from '@/lib/timelines.server';
import { apiError } from '@/lib/apiError';

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; timelineId: string; datetimeId: string }>;
  },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, timelineId, datetimeId } = await params;
    await requireContributor(id, email);
    await removeTimelineEntry(id, timelineId, datetimeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
