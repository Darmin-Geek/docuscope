import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import {
  requireContributor,
  requireCheckoutHolder,
  getDraft,
  saveDraft,
  discardDraft,
} from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';
import type { FileDraftSnapshot } from '@/lib/projects';

// GET — return this user's staged draft for the file, or null. Reading is
// allowed for any contributor (no check-out required) so the editor can detect
// a pre-existing draft on open.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    const snapshot = await getDraft(id, fileId, uid);
    return NextResponse.json(snapshot);
  } catch (err) {
    return apiError(err);
  }
}

// PUT — Save: stage the snapshot. Requires the caller to hold the check-out.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    await requireCheckoutHolder(id, fileId, uid);
    const snapshot = (await request.json()) as FileDraftSnapshot;
    await saveDraft(id, fileId, uid, snapshot);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

// DELETE — discard the stored draft. Requires the caller to hold the check-out.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId } = await params;
    await requireContributor(id, email);
    await requireCheckoutHolder(id, fileId, uid);
    await discardDraft(id, fileId, uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
