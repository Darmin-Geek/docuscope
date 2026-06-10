import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, addContributor } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const body = await request.json() as { email: string };
    const normalized = await addContributor(id, body.email);
    return NextResponse.json({ email: normalized });
  } catch (err) {
    return apiError(err);
  }
}
