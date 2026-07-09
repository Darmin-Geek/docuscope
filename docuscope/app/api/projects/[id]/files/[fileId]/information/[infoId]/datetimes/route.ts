import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/verifyAuth';
import { requireContributor, getFile } from '@/lib/projects.server';
import { getDatetimes, addDatetime } from '@/lib/timelines.server';
import type { DatetimeInputPayload } from '@/lib/timelines';
import { apiError } from '@/lib/apiError';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const data = await getDatetimes(id, fileId, infoId);
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string; infoId: string }> },
) {
  try {
    const { uid, email } = await verifyAuth(request);
    const { id, fileId, infoId } = await params;
    await requireContributor(id, email);
    const file = await getFile(id, fileId);
    if (file.checkedOutBy && file.checkedOutBy !== uid) {
      return NextResponse.json(
        { error: 'File is checked out by another user' },
        { status: 409 },
      );
    }
    const payload = (await request.json()) as DatetimeInputPayload;
    const datetime = await addDatetime(id, fileId, infoId, payload);
    return NextResponse.json(datetime);
  } catch (err) {
    return apiError(err);
  }
}
