import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, removeContributor } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contributorEmail: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, contributorEmail } = await params;
    await requireContributor(id, email);
    await removeContributor(id, decodeURIComponent(contributorEmail));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
