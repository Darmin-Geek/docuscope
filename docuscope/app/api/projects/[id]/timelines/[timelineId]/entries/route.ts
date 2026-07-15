import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { getTimelineEntries, addTimelineEntry } from '@/lib/timelines.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; timelineId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, timelineId } = await params;
    await requireContributor(id, email);
    const data = await getTimelineEntries(id, timelineId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; timelineId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, timelineId } = await params;
    await requireContributor(id, email);
    const { datetimeId } = (await request.json()) as { datetimeId: string };
    if (!datetimeId) throw new Error('Invalid');
    await addTimelineEntry(id, timelineId, datetimeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
