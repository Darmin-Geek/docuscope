import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFolderFileIds } from '@/lib/projects.server';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id } = await params;
    await requireContributor(id, email);
    const map = await getFolderFileIds(id);
    // Convert Map<string, Set<string>> to a plain object for JSON.
    const obj: Record<string, string[]> = {};
    for (const [folderId, fileIds] of map) {
      obj[folderId] = [...fileIds];
    }
    return NextResponse.json(obj);
  } catch (err) {
    return apiError(err);
  }
}
