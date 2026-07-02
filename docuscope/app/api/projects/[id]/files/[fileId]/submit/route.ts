import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import {
  requireContributor,
  requireCheckoutHolder,
  submitDraft,
  resolveEditorName,
} from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';
import type { FileDraftSnapshot } from '@/lib/projects';

// POST — Submit: publish the snapshot into the main tables and clear the draft.
// Requires the caller to hold the check-out. The snapshot is taken from the
// request body (the freshest client state) rather than the stored draft.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    await requireCheckoutHolder(id, fileId, uid);
    const snapshot = (await request.json()) as FileDraftSnapshot;
    const editorName = await resolveEditorName(uid, email);
    await submitDraft(id, fileId, uid, snapshot, editorName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
