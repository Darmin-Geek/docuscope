import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getLabels, createLabel } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const data = await getLabels(id);
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
    const body = await request.json() as { label: string; color: string };
    const label = await createLabel(id, body.label, body.color);
    return NextResponse.json(label);
  } catch (err) {
    return apiError(err);
  }
}
