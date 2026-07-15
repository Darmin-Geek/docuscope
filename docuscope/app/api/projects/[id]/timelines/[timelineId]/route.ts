import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { updateTimeline, deleteTimeline } from '@/lib/timelines.server';
import { apiError } from '@/lib/apiError';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; timelineId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, timelineId } = await params;
    await requireContributor(id, email);
    const body = (await request.json()) as {
      title?: string;
      description?: string | null;
      defaultStartMs?: number | null;
      defaultSpanMs?: number | null;
    };
    await updateTimeline(id, timelineId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; timelineId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, timelineId } = await params;
    await requireContributor(id, email);
    await deleteTimeline(id, timelineId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
