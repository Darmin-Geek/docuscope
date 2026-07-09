import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor } from '@/lib/projects.server';
import { getTimelines, createTimeline } from '@/lib/timelines.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const data = await getTimelines(id);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const body = (await request.json()) as {
      title: string;
      description?: string | null;
    };
    const timeline = await createTimeline(id, {
      title: body.title,
      description: body.description ?? null,
    });
    return NextResponse.json(timeline);
  } catch (err) {
    return apiError(err);
  }
}
